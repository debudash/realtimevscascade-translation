using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Workbench.Core.Events;

namespace Workbench.Tests.Api;

public class CascadeSocketTests
{
    private static WebApplicationFactory<Program> Factory(Dictionary<string, string?>? config = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(config ?? [])));

    private static async Task<WebSocket> Connect(WebApplicationFactory<Program> app)
    {
        var client = app.Server.CreateWebSocketClient();
        return await client.ConnectAsync(new Uri(app.Server.BaseAddress, "/ws/cascade"), CancellationToken.None);
    }

    private static Task Send(WebSocket ws, object msg) =>
        ws.SendAsync(JsonSerializer.SerializeToUtf8Bytes(msg, EventJson.Options), WebSocketMessageType.Text, true, CancellationToken.None);

    private static async Task<WorkbenchEvent> Receive(WebSocket ws, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        var buffer = new byte[1 << 20];
        var count = 0;
        WebSocketReceiveResult r;
        do
        {
            r = await ws.ReceiveAsync(new ArraySegment<byte>(buffer, count, buffer.Length - count), cts.Token);
            count += r.Count;
        } while (!r.EndOfMessage);
        return EventJson.Deserialize(Encoding.UTF8.GetString(buffer, 0, count))!;
    }

    private static async Task<List<WorkbenchEvent>> ReceiveUntil<T>(WebSocket ws, int maxEvents = 2000) where T : WorkbenchEvent
    {
        var events = new List<WorkbenchEvent>();
        while (events.Count < maxEvents)
        {
            var e = await Receive(ws, TimeSpan.FromSeconds(10));
            events.Add(e);
            if (e is T) return events;
        }
        throw new InvalidOperationException($"No {typeof(T).Name} in {maxEvents} events");
    }

    private static readonly object AllFake = new { stt = "fake", translation = "fake", tts = "fake" };

    [Fact]
    public async Task A_cascade_turn_works_end_to_end_over_the_socket_with_fakes()
    {
        await using var app = Factory();
        using var ws = await Connect(app);

        await Send(ws, new { type = "session.configure", pairId = "en-es", strategy = "segment", providers = AllFake });
        var ready = Assert.IsType<SessionReadyEvent>(await Receive(ws, TimeSpan.FromSeconds(10)));
        Assert.Equal("fake", ready.Providers.Stt);
        Assert.Equal("fake-deepl", ready.Providers.TranslationFallback);

        await Send(ws, new { type = "turn.start", turnId = "t1", speaker = "en", source = "en", target = "es" });
        var frame = new byte[640];
        for (var i = 0; i < 40; i++) await ws.SendAsync(frame, WebSocketMessageType.Binary, true, CancellationToken.None);
        await Send(ws, new { type = "turn.release", turnId = "t1" });

        var events = await ReceiveUntil<TurnEndEvent>(ws);
        Assert.IsType<TurnStartEvent>(events[0]);
        Assert.Contains(events, e => e is SourceFinalEvent);
        Assert.Contains(events, e => e is AudioChunkEvent { SampleRate: 24000 });
        Assert.Contains(events, e => e is StageTimingEvent { Stage: StageNames.TtsFirstByte });
        var end = (TurnEndEvent)events[^1];
        Assert.Equal("completed", end.Status);
        Assert.All(events, e => Assert.Equal("t1", e.TurnId));

        await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
    }

    [Fact]
    public async Task Injected_fake_429s_fail_over_and_surface_on_the_socket()
    {
        await using var app = Factory();
        using var ws = await Connect(app);

        await Send(ws, new { type = "session.configure", pairId = "en-es", providers = AllFake, faults = new { translation = "429" } });
        Assert.IsType<SessionReadyEvent>(await Receive(ws, TimeSpan.FromSeconds(10)));
        await Send(ws, new { type = "turn.start", turnId = "t1", speaker = "en", source = "en", target = "es" });
        for (var i = 0; i < 20; i++) await ws.SendAsync(new byte[640], WebSocketMessageType.Binary, true, CancellationToken.None);
        await Send(ws, new { type = "turn.release", turnId = "t1" });

        var events = await ReceiveUntil<TurnEndEvent>(ws);
        var failover = Assert.Single(events.OfType<ProviderFailoverEvent>());
        Assert.Equal(("fake", "fake-deepl"), (failover.From, failover.To));
        Assert.Equal("completed", ((TurnEndEvent)events[^1]).Status);
    }

    [Fact]
    public async Task Missing_keys_for_selected_providers_are_a_config_error_naming_them()
    {
        await using var app = Factory(new() { ["Deepgram:ApiKey"] = "", ["OpenAI:ApiKey"] = "x", ["ElevenLabs:ApiKey"] = "x", ["DeepL:ApiKey"] = "x" });
        using var ws = await Connect(app);

        await Send(ws, new { type = "session.configure", pairId = "en-es", providers = new { stt = "deepgram", translation = "fake", tts = "fake" } });
        var err = Assert.IsType<ErrorEvent>(await Receive(ws, TimeSpan.FromSeconds(10)));
        Assert.Equal("config_error", err.Code);
        Assert.Contains("Deepgram__ApiKey", err.Message);
    }

    [Fact]
    public async Task Cancel_ends_the_turn_as_cancelled()
    {
        await using var app = Factory();
        using var ws = await Connect(app);

        await Send(ws, new { type = "session.configure", pairId = "en-es", providers = AllFake });
        await Receive(ws, TimeSpan.FromSeconds(10));
        await Send(ws, new { type = "turn.start", turnId = "t9", speaker = "es", source = "es", target = "en" });
        for (var i = 0; i < 10; i++) await ws.SendAsync(new byte[640], WebSocketMessageType.Binary, true, CancellationToken.None);
        await Send(ws, new { type = "turn.cancel", turnId = "t9" });

        var end = (TurnEndEvent)(await ReceiveUntil<TurnEndEvent>(ws))[^1];
        Assert.Equal(("cancelled", "es-en"), (end.Status, end.Direction));
    }
}
