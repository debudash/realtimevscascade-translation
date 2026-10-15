// Deepgram streaming STT (WebSocket). Docs (read 2026-10-15):
//   https://developers.deepgram.com/reference/speech-to-text/listen-streaming
//   https://developers.deepgram.com/docs/finalize        ({"type":"Finalize"}, from_finalize; not guaranteed with little audio)
//   https://developers.deepgram.com/docs/close-stream    ({"type":"CloseStream"})
//   https://developers.deepgram.com/docs/keep-alive      (socket closes after 10 s without audio or KeepAlive)
//   https://developers.deepgram.com/docs/authenticating  (Authorization: Token <key>)
//   https://developers.deepgram.com/docs/models-languages-overview (nova-3 supports en and es)
using System.Net;
using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.Options;
using Workbench.Core;
using Workbench.Core.Contracts;

namespace Workbench.Providers.Deepgram;

public sealed class DeepgramOptions
{
    public const string KeyVariable = "Deepgram__ApiKey";
    public string? ApiKey { get; set; }
    public string Model { get; set; } = "nova-3";
    /// <summary>Silence (ms) that ends a segment mid-turn; segment-commit mode commits on these finals.</summary>
    public int EndpointingMs { get; set; } = 300;
    /// <summary>After release, how long to wait for the Finalize response before closing anyway.</summary>
    public int FinalizeTimeoutMs { get; set; } = 1500;
    public string ListenUrl { get; set; } = "wss://api.deepgram.com/v1/listen";
    public string RestBaseUrl { get; set; } = "https://api.deepgram.com";
}

public sealed class DeepgramSttProvider(
    IOptions<DeepgramOptions> options,
    IOptions<LanguagesOptions> languages,
    IHttpClientFactory http) : ISttProvider, IWarmable
{
    public const string HttpClientName = "deepgram";
    private static readonly byte[] FinalizeMsg = """{"type":"Finalize"}"""u8.ToArray();
    private static readonly byte[] CloseMsg = """{"type":"CloseStream"}"""u8.ToArray();
    private static readonly byte[] KeepAliveMsg = """{"type":"KeepAlive"}"""u8.ToArray();

    public string Name => "deepgram";
    private const int SampleRate = 16000;

    public async IAsyncEnumerable<SttResult> TranscribeAsync(ChannelReader<AudioFrame> audio, SttOptions opts, [EnumeratorCancellation] CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) throw new ProviderConfigException(Name, "stt", DeepgramOptions.KeyVariable);

        var lang = languages.Value.Languages.FirstOrDefault(l => l.Code == opts.Language)?.DeepgramLanguage ?? opts.Language;
        var url = $"{o.ListenUrl}?model={o.Model}&language={lang}&encoding=linear16&sample_rate={opts.SampleRate}&channels=1" +
                  $"&interim_results=true&punctuate=true&smart_format=true&endpointing={o.EndpointingMs}";

        using var ws = new ClientWebSocket();
        ws.Options.SetRequestHeader("Authorization", $"Token {o.ApiKey}");
        ws.Options.CollectHttpResponseDetails = true;
        try
        {
            await ws.ConnectAsync(new Uri(url), ct);
        }
        catch (WebSocketException e) when (!ct.IsCancellationRequested)
        {
            throw ws.HttpStatusCode switch
            {
                HttpStatusCode.TooManyRequests => new RateLimitedException(Name, "stt", "Deepgram returned 429"),
                0 => new ProviderErrorException(Name, "stt", $"Deepgram connection failed: {e.Message}", inner: e),
                var s => new ProviderErrorException(Name, "stt", $"Deepgram returned {(int)s}", (int)s),
            };
        }

        var results = Channel.CreateUnbounded<SttResult>();
        var finalizeSent = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sent = new SentAudio();
        using var turnCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var sender = SendAsync(ws, audio, sent, finalizeSent, turnCts.Token);
        var receiver = ReceiveAsync(ws, results.Writer, sent, finalizeSent.Task, turnCts.Token);

        await foreach (var r in results.Reader.ReadAllAsync(ct)) yield return r;

        await receiver; // surfaces receive errors
        turnCts.Cancel();
        await sender.ContinueWith(_ => { }, TaskScheduler.Default);
        if (ws.State == WebSocketState.Open)
        {
            try
            {
                await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
            }
            catch (WebSocketException) { }
        }
    }

    /// <summary>Streams frames as they arrive; on release sends Finalize, then CloseStream after the final arrives.</summary>
    /// <summary>Seconds of audio sent so far (written by the sender, read by the receiver).</summary>
    private sealed class SentAudio
    {
        private long _bytes;
        public void Add(int bytes) => Interlocked.Add(ref _bytes, bytes);
        public double Seconds(int sampleRate) => Interlocked.Read(ref _bytes) / (2.0 * sampleRate);
    }

    private static async Task SendAsync(ClientWebSocket ws, ChannelReader<AudioFrame> audio, SentAudio sent, TaskCompletionSource finalizeSent, CancellationToken ct)
    {
        try
        {
            while (await WaitForFrameOrKeepAlive(audio, ws, ct))
            {
                while (audio.TryRead(out var frame))
                {
                    await ws.SendAsync(frame.Pcm16, WebSocketMessageType.Binary, true, ct);
                    sent.Add(frame.Pcm16.Length);
                }
            }
            // Release: flush what Deepgram has buffered and get the last finals now.
            await ws.SendAsync(FinalizeMsg, WebSocketMessageType.Text, true, ct);
            finalizeSent.TrySetResult();
        }
        catch (Exception e) when (e is OperationCanceledException or WebSocketException) { }
    }

    /// <summary>Waits for audio; sends a KeepAlive if none arrives for 4 s (Deepgram closes idle sockets at 10 s).</summary>
    private static async Task<bool> WaitForFrameOrKeepAlive(ChannelReader<AudioFrame> audio, ClientWebSocket ws, CancellationToken ct)
    {
        while (true)
        {
            using var idle = CancellationTokenSource.CreateLinkedTokenSource(ct);
            idle.CancelAfter(TimeSpan.FromSeconds(4));
            try
            {
                return await audio.WaitToReadAsync(idle.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                await ws.SendAsync(KeepAliveMsg, WebSocketMessageType.Text, true, ct);
            }
        }
    }

    /// <summary>
    /// Deepgram works through audio at about real-time pace even when it arrives in a burst (e.g. the
    /// frames buffered while the socket connected), and the Finalize response only covers what it has
    /// processed so far. So the turn ends when, after Finalize, a final result's end time reaches the
    /// end of the audio we sent (measured 2026-10-15: 66 ms after Finalize with real-time pacing).
    /// </summary>
    private async Task ReceiveAsync(ClientWebSocket ws, ChannelWriter<SttResult> results, SentAudio sent, Task finalizeSent, CancellationToken ct)
    {
        var o = options.Value;
        var buffer = new byte[64 * 1024];
        // Once Finalize is sent (release), stop if Deepgram goes quiet for FinalizeTimeoutMs
        // (an inactivity timeout, so a backlog that is still being worked through is not cut off).
        using var finalizeWait = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _ = finalizeSent.ContinueWith(_ => finalizeWait.CancelAfter(o.FinalizeTimeoutMs), TaskScheduler.Default);
        Exception? error = null;
        try
        {
            while (ws.State is WebSocketState.Open or WebSocketState.CloseSent)
            {
                var (type, text) = await ReceiveMessage(ws, buffer, finalizeWait.Token);
                if (type == WebSocketMessageType.Close) break;
                if (finalizeSent.IsCompleted) finalizeWait.CancelAfter(o.FinalizeTimeoutMs);
                if (type != WebSocketMessageType.Text) continue;

                using var doc = JsonDocument.Parse(text);
                var root = doc.RootElement;
                var msgType = root.TryGetProperty("type", out var t) ? t.GetString() : null;
                if (msgType == "Results")
                {
                    var transcript = root.GetProperty("channel").GetProperty("alternatives")[0].GetProperty("transcript").GetString() ?? "";
                    var isFinal = root.TryGetProperty("is_final", out var f) && f.GetBoolean();
                    var fromFinalize = root.TryGetProperty("from_finalize", out var ff) && ff.GetBoolean();
                    var end = root.GetProperty("start").GetDouble() + root.GetProperty("duration").GetDouble();
                    await results.WriteAsync(new SttResult(transcript, isFinal, fromFinalize), ct);
                    // Released, and the finals now cover everything we sent: done.
                    if (isFinal && finalizeSent.IsCompleted && end >= sent.Seconds(SampleRate) - 0.05) break;
                }
                else if (msgType == "Error")
                {
                    var desc = root.TryGetProperty("description", out var de) ? de.GetString() : "Deepgram error";
                    error = new ProviderErrorException(Name, "stt", $"Deepgram: {desc}");
                    break;
                }

            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // Finalize response did not come (little or no buffered audio): end with what we have.
        }
        catch (Exception e) when (e is WebSocketException or JsonException && !ct.IsCancellationRequested)
        {
            error = new ProviderErrorException(Name, "stt", $"Deepgram stream failed: {e.Message}", inner: e);
        }
        finally
        {
            try
            {
                if (ws.State == WebSocketState.Open) await ws.SendAsync(CloseMsg, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch (WebSocketException) { }
            results.TryComplete(error);
        }
    }

    private static async Task<(WebSocketMessageType, string)> ReceiveMessage(ClientWebSocket ws, byte[] buffer, CancellationToken ct)
    {
        var count = 0;
        ValueWebSocketReceiveResult r;
        do
        {
            if (count == buffer.Length) Array.Resize(ref buffer, buffer.Length * 2);
            r = await ws.ReceiveAsync(buffer.AsMemory(count), ct);
            count += r.Count;
        } while (!r.EndOfMessage);
        return (r.MessageType, Encoding.UTF8.GetString(buffer, 0, count));
    }

    /// <summary>Warm-up: resolve DNS and open a pooled TLS connection to Deepgram (also validates the key).</summary>
    public async Task WarmUpAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) return;
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{o.RestBaseUrl}/v1/projects");
        req.Headers.Authorization = new("Token", o.ApiKey);
        using var _ = await http.CreateClient(HttpClientName).SendAsync(req, ct);
    }
}
