using System.Diagnostics;
using System.Text;
using System.Threading.Channels;
using Workbench.Core.Contracts;
using Workbench.Core.Events;

namespace Workbench.Core.Pipeline;

public sealed record CascadeTurnSpec(string TurnId, string Speaker, string Source, string Target, string? VoiceId = null)
{
    public string Direction => $"{Source}-{Target}";
}

public sealed class PipelineOptions
{
    /// <summary>Bounded audio buffer: 1500 x 20 ms = 30 s. The socket reader awaits when full (backpressure).</summary>
    public int AudioCapacityFrames { get; init; } = 1500;
    public int StageCapacity { get; init; } = 32;
    /// <summary>After release, how long STT may take to deliver its last final.</summary>
    public TimeSpan SttFinalTimeout { get; init; } = TimeSpan.FromSeconds(2);
    /// <summary>Committed segments passed to translation as context.</summary>
    public int ContextSegments { get; init; } = 2;
}

/// <summary>The session's single outgoing writer. The pipeline never touches the socket.</summary>
public interface IEventSink
{
    ValueTask EmitAsync(WorkbenchEvent e, CancellationToken ct);
}

/// <summary>Streaming -> Draining -> Completed | Cancelled | Failed (docs/architecture.md §4).</summary>
public enum TurnPipelineState { Streaming, Draining, Completed, Cancelled, Failed }

/// <summary>
/// One cascade turn: STT -> CommitPolicy -> Translation -> TTS, each stage a task connected by
/// bounded channels, so translation and TTS run while the speaker is still talking.
/// A per-turn CancellationTokenSource cancels every stage on client cancel or on the first failure.
/// </summary>
public sealed class CascadeTurnPipeline : IAsyncDisposable
{
    private readonly CascadeTurnSpec _spec;
    private readonly ISttProvider _stt;
    private readonly ITranslationProvider _translator;
    private readonly ITtsProvider _tts;
    private readonly ICommitPolicy _policy;
    private readonly PipelineOptions _opts;
    private readonly IEventSink _sink;
    private readonly Func<double> _clock;
    private readonly Channel<AudioFrame> _audio;
    private readonly CancellationTokenSource _cts;
    private readonly TaskCompletionSource _released = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Stopwatch _sinceRelease = new();
    private readonly TurnMeter _meter = new();
    private readonly StringBuilder _target = new();
    private Exception? _failure;
    private volatile bool _cancelledByClient;
    private int _committed;
    private int _state = (int)TurnPipelineState.Streaming;

    public CascadeTurnPipeline(
        CascadeTurnSpec spec,
        ISttProvider stt,
        ITranslationProvider translator,
        ITtsProvider tts,
        ICommitPolicy policy,
        PipelineOptions opts,
        IEventSink sink,
        Func<double> clock,
        CancellationToken sessionToken)
    {
        _spec = spec;
        _stt = stt;
        _translator = translator;
        _tts = tts;
        _policy = policy;
        _opts = opts;
        _sink = sink;
        _clock = clock;
        _audio = Channel.CreateBounded<AudioFrame>(new BoundedChannelOptions(opts.AudioCapacityFrames)
        {
            SingleReader = true,
            SingleWriter = true,
            FullMode = BoundedChannelFullMode.Wait,
        });
        _cts = CancellationTokenSource.CreateLinkedTokenSource(sessionToken);
        _meter.OnFailover = (stage, from, to, reason) =>
            _ = Emit(new ProviderFailoverEvent(stage, from, to, reason));
    }

    public string TurnId => _spec.TurnId;
    public TurnPipelineState State => (TurnPipelineState)Volatile.Read(ref _state);

    /// <summary>Called by the socket reader for each binary frame. Awaits when the buffer is full.</summary>
    public async ValueTask WriteAudioAsync(ReadOnlyMemory<byte> pcm16)
    {
        if (State != TurnPipelineState.Streaming) return;
        try
        {
            await _audio.Writer.WriteAsync(new AudioFrame(pcm16), _cts.Token);
            _meter.AddSttAudio(TimeSpan.FromSeconds(pcm16.Length / 32000.0)); // 16 kHz * 2 bytes
        }
        catch (Exception e) when (e is OperationCanceledException or ChannelClosedException)
        {
            // Turn already cancelled or released.
        }
    }

    /// <summary>Button release: no more audio. STT finalizes; the final-transcript timeout starts.</summary>
    public void Release()
    {
        if (Interlocked.CompareExchange(ref _state, (int)TurnPipelineState.Draining, (int)TurnPipelineState.Streaming)
            != (int)TurnPipelineState.Streaming) return;
        _sinceRelease.Start();
        _audio.Writer.TryComplete();
        _released.TrySetResult();
    }

    /// <summary>Idempotent and safe to call from any thread, before, during or after the run.</summary>
    public void Cancel()
    {
        if (State is TurnPipelineState.Completed or TurnPipelineState.Failed or TurnPipelineState.Cancelled) return;
        _cancelledByClient = true;
        _audio.Writer.TryComplete();
        try
        {
            _cts.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // Already finished.
        }
    }

    public async Task RunAsync()
    {
        var ct = _cts.Token;
        await Emit(new TurnStartEvent(_spec.Speaker, _spec.Direction));

        var segments = Channel.CreateBounded<Segment>(_opts.StageCapacity);
        var toSpeak = Channel.CreateBounded<(int Index, string Text)>(_opts.StageCapacity);

        await Task.WhenAll(
            Stage(() => RunSttAsync(segments.Writer, ct)),
            Stage(() => RunTranslationAsync(segments.Reader, toSpeak.Writer, ct)),
            Stage(() => RunTtsAsync(toSpeak.Reader, ct)));

        await FinishAsync();
    }

    /// <summary>Runs a stage; the first real failure cancels the whole turn.</summary>
    private async Task Stage(Func<Task> stage)
    {
        try
        {
            await stage();
        }
        catch (OperationCanceledException) when (_cts.IsCancellationRequested)
        {
            // Another stage failed, or the client cancelled.
        }
        catch (Exception e)
        {
            Interlocked.CompareExchange(ref _failure, e, null);
            _cts.Cancel();
        }
    }

    // ---- STT: stream frames as they arrive; commit per policy ----
    private async Task RunSttAsync(ChannelWriter<Segment> segments, CancellationToken ct)
    {
        using var sttCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var finals = new List<string>();
        var sttDone = 0;
        var watchdogFired = false;
        var timedOut = false;

        // Final-transcript watchdog, armed at release.
        _ = Task.Run(async () =>
        {
            try
            {
                await _released.Task.WaitAsync(ct);
                await Task.Delay(_opts.SttFinalTimeout, ct);
                if (Volatile.Read(ref sttDone) == 0)
                {
                    Volatile.Write(ref watchdogFired, true);
                    sttCts.Cancel();
                }
            }
            catch (OperationCanceledException) { }
        }, CancellationToken.None);

        try
        {
            await foreach (var r in _stt.TranscribeAsync(_audio.Reader, new SttOptions(_spec.Source), sttCts.Token))
            {
                var text = r.Text.Trim();
                if (r.IsFinal)
                {
                    if (text.Length > 0) finals.Add(text);
                    await Emit(new SourceFinalEvent(string.Join(' ', finals), _spec.Source));
                    if (_sinceRelease.IsRunning)
                        await Emit(new StageTimingEvent(StageNames.SttFinal, _sinceRelease.Elapsed.TotalMilliseconds, _committed, _stt.Name));
                }
                else
                {
                    var stable = string.Join(' ', finals);
                    var full = text.Length == 0 ? stable : (stable.Length == 0 ? text : $"{stable} {text}");
                    await Emit(new SourcePartialEvent(full, _spec.Source, stable));
                }

                foreach (var s in _policy.Accept(r)) await Commit(segments, s, ct);
            }
        }
        catch (OperationCanceledException) when (Volatile.Read(ref watchdogFired) && !ct.IsCancellationRequested)
        {
            // STT never delivered its final: carry on with what was heard (Flush below).
            // No retry: after release there is no audio left to resend (deviation from §6, see PROGRESS.md).
            timedOut = true;
        }
        Volatile.Write(ref sttDone, 1);

        foreach (var s in _policy.Flush()) await Commit(segments, s, ct);
        if (timedOut && _committed == 0)
        {
            throw new ProviderTimeoutException(_stt.Name, "stt",
                $"No final transcript within {_opts.SttFinalTimeout.TotalSeconds:0.0} s after release");
        }
        segments.Complete();
    }

    private async Task Commit(ChannelWriter<Segment> segments, Segment s, CancellationToken ct)
    {
        Interlocked.Increment(ref _committed);
        await Emit(new SegmentCommitEvent(s.Index, s.Text));
        await segments.WriteAsync(s, ct);
    }

    // ---- Translation: stream tokens per committed segment, with the last N segments as context ----
    private async Task RunTranslationAsync(ChannelReader<Segment> segments, ChannelWriter<(int, string)> toSpeak, CancellationToken ct)
    {
        var history = new List<(string Source, string Target)>();
        await foreach (var seg in segments.ReadAllAsync(ct))
        {
            var sw = Stopwatch.StartNew();
            var first = true;
            var sb = new StringBuilder();
            var ctx = new TranslationContext(_spec.Source, _spec.Target, history.TakeLast(_opts.ContextSegments).ToList(), _meter);
            _meter.AddTranslationChars(seg.Text.Length);

            await foreach (var delta in _translator.TranslateAsync(seg, ctx, ct))
            {
                if (first)
                {
                    first = false;
                    await Emit(new StageTimingEvent(StageNames.TranslateFirstToken, sw.Elapsed.TotalMilliseconds, seg.Index, TranslatorUsed));
                }
                sb.Append(delta);
                await Emit(new TargetPartialEvent(Join(_target.ToString(), sb.ToString()), _spec.Target));
            }
            await Emit(new StageTimingEvent(StageNames.TranslateDone, sw.Elapsed.TotalMilliseconds, seg.Index, TranslatorUsed));

            var text = sb.ToString().Trim();
            history.Add((seg.Text, text));
            if (text.Length == 0) continue;
            lock (_target)
            {
                if (_target.Length > 0) _target.Append(' ');
                _target.Append(text);
            }
            await toSpeak.WriteAsync((seg.Index, text), ct);
        }
        toSpeak.Complete();
    }

    private string TranslatorUsed => _meter.TranslationProvider ?? _translator.Name;

    // ---- TTS: synthesize per committed translation, stream chunks in order ----
    private async Task RunTtsAsync(ChannelReader<(int Index, string Text)> toSpeak, CancellationToken ct)
    {
        await foreach (var (index, text) in toSpeak.ReadAllAsync(ct))
        {
            var sw = Stopwatch.StartNew();
            var first = true;
            _meter.AddTtsChars(text.Length);
            await foreach (var chunk in _tts.SynthesizeAsync(text, new VoiceOptions(_spec.Target, _spec.VoiceId), ct))
            {
                if (chunk.Pcm16.Length == 0) continue;
                if (first)
                {
                    first = false;
                    await Emit(new StageTimingEvent(StageNames.TtsFirstByte, sw.Elapsed.TotalMilliseconds, index, _tts.Name));
                }
                await Emit(new AudioChunkEvent(Convert.ToBase64String(chunk.Pcm16.Span), chunk.SampleRate, index));
            }
        }
    }

    private async Task FinishAsync()
    {
        string status;
        if (_cancelledByClient)
        {
            status = "cancelled";
            Volatile.Write(ref _state, (int)TurnPipelineState.Cancelled);
        }
        else if (_failure is not null)
        {
            status = "failed";
            Volatile.Write(ref _state, (int)TurnPipelineState.Failed);
            await Emit(ToErrorEvent(_failure));
        }
        else if (_committed == 0 || _target.Length == 0)
        {
            status = "empty";
            Volatile.Write(ref _state, (int)TurnPipelineState.Completed);
            var stage = _committed == 0 ? "stt" : "translation";
            await Emit(new ErrorEvent(ErrorCodes.EmptyResult,
                _committed == 0 ? "No speech detected. Hold the button while you talk." : "The translation came back empty.",
                Retryable: true, Provider: _committed == 0 ? _stt.Name : TranslatorUsed, Stage: stage));
        }
        else
        {
            status = "completed";
            Volatile.Write(ref _state, (int)TurnPipelineState.Completed);
            await Emit(new TargetFinalEvent(_target.ToString(), _spec.Target));
        }

        await Emit(new TurnEndEvent(
            _spec.Speaker,
            _spec.Direction,
            status,
            _meter.Snapshot(),
            [_stt.Name, TranslatorUsed, _tts.Name],
            _meter.FailoverNote));
    }

    public static ErrorEvent ToErrorEvent(Exception e) => e switch
    {
        ProviderErrorException p => new ErrorEvent(p.Code, p.Message, p.Retryable, p.Provider, p.Stage, p.HttpStatus),
        ProviderException p => new ErrorEvent(p.Code, p.Message, p.Retryable, p.Provider, p.Stage),
        _ => new ErrorEvent(ErrorCodes.Internal, "Unexpected error in the cascade pipeline.", Retryable: true),
    };

    private static string Join(string a, string b) => a.Length == 0 ? b : b.Length == 0 ? a : $"{a} {b}";

    /// <summary>Stamps turnId and the session clock. Uses the session token so terminal events still go out after a turn cancel.</summary>
    private ValueTask Emit(WorkbenchEvent e) => _sink.EmitAsync(e with { TurnId = _spec.TurnId, T = _clock() }, CancellationToken.None);

    /// <summary>
    /// Nothing to release eagerly: the linked CTS is left to the GC so a late Cancel() from the
    /// socket reader can never hit a disposed source.
    /// </summary>
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
