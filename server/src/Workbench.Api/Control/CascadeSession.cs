using System.Buffers;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.Options;
using Workbench.Core;
using Workbench.Core.Commit;
using Workbench.Core.Events;
using Workbench.Core.Pipeline;
using Workbench.Api.Config;
using Workbench.Providers.Resilience;

namespace Workbench.Api.Control;

/// <summary>
/// Control module: one cascade session per WebSocket. Owns the turn lifecycle and the socket.
/// - Reader loop: JSON control messages (text) and PCM16 16 kHz frames (binary) for the active turn.
/// - Writer task: the only code that writes to the socket; drains a bounded event channel.
/// Wire protocol (client -> server):
///   { "type": "session.configure", "pairId", "strategy", "providers"?: {...}, "faults"?: {...} }
///   { "type": "turn.start", "turnId", "speaker", "source", "target" }
///   { "type": "turn.release", "turnId" }   { "type": "turn.cancel", "turnId" }
/// </summary>
public sealed class CascadeSession(
    WebSocket socket,
    CascadeProviderFactory factory,
    IOptions<LanguagesOptions> languages,
    IOptions<ResilienceOptions> resilience,
    IOptions<CascadeOptions> cascade,
    ICommitPolicyFactory policies,
    ILogger<CascadeSession> log) : IEventSink
{
    private static readonly TimeSpan WarmUpTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan KeepWarmEvery = TimeSpan.FromSeconds(45);

    private readonly Channel<WorkbenchEvent> _out = Channel.CreateBounded<WorkbenchEvent>(
        new BoundedChannelOptions(4096) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private CascadeProviderSet? _providers;
    private string _strategy = cascade.Value.DefaultStrategy;
    private CascadeTurnPipeline? _turn;
    private Task _turnTask = Task.CompletedTask;
    private DateTime _lastActivity = DateTime.UtcNow;

    private sealed record ClientMessage(
        string Type,
        string? PairId = null,
        string? Strategy = null,
        ProviderSelection? Providers = null,
        FaultSelection? Faults = null,
        string? TurnId = null,
        string? Speaker = null,
        string? Source = null,
        string? Target = null);

    public async Task RunAsync(CancellationToken aborted)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(aborted);
        var writer = WriteLoopAsync(cts.Token);
        var keepWarm = KeepWarmLoopAsync(cts.Token);
        try
        {
            await ReadLoopAsync(cts.Token);
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException)
        {
            log.LogInformation("Cascade socket closed: {Reason}", e.Message);
        }
        finally
        {
            // Each step is independent, so one failure cannot skip the rest of the cleanup.
            cts.Cancel();
            try { _turn?.Cancel(); } catch (Exception e) { log.LogWarning(e, "Turn cancel failed"); }
            _out.Writer.TryComplete();
            await _turnTask.ContinueWith(_ => { }, TaskScheduler.Default);
            await writer.ContinueWith(_ => { }, TaskScheduler.Default);
            await keepWarm.ContinueWith(_ => { }, TaskScheduler.Default);
        }
    }

    private async Task ReadLoopAsync(CancellationToken ct)
    {
        var buffer = new ArrayBufferWriter<byte>(64 * 1024);
        while (socket.State == WebSocketState.Open)
        {
            buffer.ResetWrittenCount();
            ValueWebSocketReceiveResult r;
            do
            {
                r = await socket.ReceiveAsync(buffer.GetMemory(16 * 1024), ct);
                buffer.Advance(r.Count);
            } while (!r.EndOfMessage && r.MessageType != WebSocketMessageType.Close);

            if (r.MessageType == WebSocketMessageType.Close)
            {
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None);
                return;
            }
            _lastActivity = DateTime.UtcNow;
            if (r.MessageType == WebSocketMessageType.Binary)
            {
                if (_turn is { } turn) await turn.WriteAudioAsync(buffer.WrittenMemory.ToArray());
            }
            else
            {
                await HandleControlAsync(Encoding.UTF8.GetString(buffer.WrittenSpan), ct);
            }
        }
    }

    private async Task HandleControlAsync(string json, CancellationToken ct)
    {
        ClientMessage? msg;
        try
        {
            msg = JsonSerializer.Deserialize<ClientMessage>(json, EventJson.Options);
        }
        catch (JsonException)
        {
            msg = null;
        }
        if (msg is null)
        {
            await Emit(new ErrorEvent(ErrorCodes.Internal, "Malformed control message.", Retryable: false));
            return;
        }

        switch (msg.Type)
        {
            case "session.configure":
                if (_turn is not null)
                {
                    await Emit(new ErrorEvent(ErrorCodes.Internal, "Cannot reconfigure during a turn.", Retryable: true));
                    break;
                }
                await ConfigureAsync(msg, ct);
                break;
            case "turn.start":
                await StartTurnAsync(msg, ct);
                break;
            case "turn.release":
                if (_turn is { } releasing && releasing.TurnId == msg.TurnId) releasing.Release();
                break;
            case "turn.cancel":
                if (_turn is { } cancelling && cancelling.TurnId == msg.TurnId) cancelling.Cancel();
                break;
            case "ping":
                break;
            default:
                await Emit(new ErrorEvent(ErrorCodes.Internal, $"Unknown control message '{msg.Type}'.", Retryable: false));
                break;
        }
    }

    private async Task ConfigureAsync(ClientMessage msg, CancellationToken ct)
    {
        var names = factory.Resolve(msg.Providers);
        var missing = factory.MissingKeys(names);
        if (missing.Count > 0)
        {
            // Names only, never values.
            await Emit(new ErrorEvent(ErrorCodes.ConfigError, $"Missing: {string.Join(", ", missing)}", Retryable: false));
            return;
        }
        var unknown = factory.UnknownProviders(names);
        if (unknown.Count > 0)
        {
            await Emit(new ErrorEvent(ErrorCodes.ConfigError, $"Unknown provider(s): {string.Join(", ", unknown)}", Retryable: false));
            return;
        }

        _strategy = msg.Strategy is { } s && policies.Names.Contains(s) ? s : cascade.Value.DefaultStrategy;
        _providers = factory.Create(names, msg.Faults);

        // Warm-up: pre-connect provider clients (DNS, TLS, pooled connections) before Ready.
        await WarmAsync(ct);
        await Emit(new SessionReadyEvent("cascade", names, _strategy));
    }

    private async Task WarmAsync(CancellationToken ct)
    {
        if (_providers is null) return;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(WarmUpTimeout);
        try
        {
            await Task.WhenAll(_providers.Warmables.Select(w => w.WarmUpAsync(timeout.Token)));
        }
        catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // Warm-up is best effort; the first turn will surface real provider errors.
            log.LogWarning("Provider warm-up incomplete: {Message}", e.Message);
        }
    }

    /// <summary>Keeps pooled provider connections alive between turns.</summary>
    private async Task KeepWarmLoopAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
                if (_turn is null && DateTime.UtcNow - _lastActivity > KeepWarmEvery)
                {
                    _lastActivity = DateTime.UtcNow;
                    await WarmAsync(ct);
                }
            }
        }
        catch (OperationCanceledException) { }
    }

    private async Task StartTurnAsync(ClientMessage msg, CancellationToken ct)
    {
        if (_providers is null)
        {
            await Emit(new ErrorEvent(ErrorCodes.ConfigError, "Session is not configured.", Retryable: false) { TurnId = msg.TurnId });
            return;
        }
        if (msg.TurnId is null || msg.Source is null || msg.Target is null)
        {
            await Emit(new ErrorEvent(ErrorCodes.Internal, "turn.start needs turnId, source and target.", Retryable: false));
            return;
        }

        // Floor control is the browser's job; a stray overlapping turn just cancels the old one.
        _turn?.Cancel();
        await _turnTask.ContinueWith(_ => { }, TaskScheduler.Default);

        var voice = languages.Value.Languages.FirstOrDefault(l => l.Code == msg.Target)?.ElevenLabsVoiceId;
        var spec = new CascadeTurnSpec(msg.TurnId, msg.Speaker ?? msg.Source, msg.Source, msg.Target, voice);
        var pipeline = new CascadeTurnPipeline(
            spec,
            _providers.Stt,
            _providers.Translation,
            _providers.Tts,
            policies.Create(_strategy),
            new PipelineOptions { SttFinalTimeout = resilience.Value.SttFinalTimeout },
            this,
            () => _clock.Elapsed.TotalMilliseconds,
            ct);
        _turn = pipeline;
        // Press-to-warm: RunAsync opens the STT stream immediately, before release.
        _turnTask = RunTurnAsync(pipeline);
    }

    private async Task RunTurnAsync(CascadeTurnPipeline pipeline)
    {
        try
        {
            await pipeline.RunAsync();
        }
        catch (Exception e)
        {
            log.LogError(e, "Cascade turn {TurnId} crashed", pipeline.TurnId);
            await Emit(new ErrorEvent(ErrorCodes.Internal, "Unexpected error in the cascade pipeline.", Retryable: true) { TurnId = pipeline.TurnId });
            // The client finishes a turn on turn.end; always send one.
            await Emit(new TurnEndEvent("", "", "failed") { TurnId = pipeline.TurnId });
        }
        finally
        {
            if (ReferenceEquals(_turn, pipeline)) _turn = null;
            _lastActivity = DateTime.UtcNow;
            await pipeline.DisposeAsync();
        }
    }

    /// <summary>
    /// Queues an event for the writer. If the writer has died (socket gone), events are dropped
    /// rather than blocking the pipeline forever on a full channel.
    /// </summary>
    public async ValueTask EmitAsync(WorkbenchEvent e, CancellationToken ct)
    {
        try
        {
            await _out.Writer.WriteAsync(e, ct);
        }
        catch (ChannelClosedException)
        {
            // Writer gone: nobody to deliver to.
        }
    }

    private ValueTask Emit(WorkbenchEvent e) => EmitAsync(e with { T = _clock.Elapsed.TotalMilliseconds }, CancellationToken.None);

    /// <summary>The single writer for this socket.</summary>
    private async Task WriteLoopAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var e in _out.Reader.ReadAllAsync(ct))
            {
                if (socket.State != WebSocketState.Open) break;
                var bytes = JsonSerializer.SerializeToUtf8Bytes(e, EventJson.Options);
                await socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, ct);
            }
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException)
        {
            log.LogInformation("Cascade writer stopped: {Reason}", e.Message);
        }
        finally
        {
            // Unblock any producer waiting on a full channel; further emits are dropped.
            _out.Writer.TryComplete();
        }
    }
}
