using System.Collections.Concurrent;
using System.Diagnostics;
using Workbench.Core.Commit;
using Workbench.Core.Contracts;
using Workbench.Core.Events;
using Workbench.Core.Pipeline;
using Workbench.Providers.Fakes;
using Workbench.Providers.Resilience;

namespace Workbench.Tests.Pipeline;

/// <summary>Collects emitted events in order, with a marker when the test releases the turn.</summary>
internal sealed class RecordingSink : IEventSink
{
    public ConcurrentQueue<WorkbenchEvent> Events { get; } = new();
    public volatile int CountAtRelease = -1;

    public ValueTask EmitAsync(WorkbenchEvent e, CancellationToken ct)
    {
        Events.Enqueue(e);
        return ValueTask.CompletedTask;
    }

    public List<WorkbenchEvent> All => [.. Events];
    public IEnumerable<T> Of<T>() => All.OfType<T>();
}

public class CascadePipelineTests
{
    private static readonly ResilienceOptions FastResilience = new()
    {
        TranslationFirstTokenTimeout = TimeSpan.FromMilliseconds(150),
        TtsFirstByteTimeout = TimeSpan.FromMilliseconds(150),
        RetryBaseDelay = TimeSpan.FromMilliseconds(1),
        BreakDuration = TimeSpan.FromSeconds(60),
    };

    private static FakeOptions Fast(FakeFault fault = FakeFault.None) => new()
    {
        Fault = fault,
        FirstLatency = TimeSpan.FromMilliseconds(10),
        StepLatency = TimeSpan.FromMilliseconds(1),
    };

    private sealed record Rig(
        CascadeTurnPipeline Pipeline,
        RecordingSink Sink,
        FakeSttProvider Stt,
        FakeTranslationProvider Primary,
        FakeTranslationProvider Fallback,
        FakeTtsProvider Tts);

    private static Rig Build(
        FakeSttProvider? stt = null,
        FakeTranslationProvider? primary = null,
        FakeTranslationProvider? fallback = null,
        FakeTtsProvider? tts = null,
        FailoverCircuit? circuit = null,
        ICommitPolicy? policy = null,
        TimeSpan? sttFinalTimeout = null)
    {
        stt ??= new FakeSttProvider(Fast()) { FramesPerWord = 2, WordsPerSegment = 3 };
        primary ??= new FakeTranslationProvider("openai", Fast());
        fallback ??= new FakeTranslationProvider("deepl", Fast());
        tts ??= new FakeTtsProvider(Fast());
        circuit ??= new FailoverCircuit(TimeProvider.System);
        var sink = new RecordingSink();
        var sw = Stopwatch.StartNew();
        var pipeline = new CascadeTurnPipeline(
            new CascadeTurnSpec("t1", "en", "en", "es"),
            stt,
            new ResilientTranslationProvider(primary, fallback, circuit, FastResilience, TimeProvider.System),
            new ResilientTtsProvider(tts, FastResilience, TimeProvider.System),
            policy ?? new SegmentCommitPolicy(),
            new PipelineOptions { SttFinalTimeout = sttFinalTimeout ?? TimeSpan.FromSeconds(1) },
            sink,
            () => sw.Elapsed.TotalMilliseconds,
            CancellationToken.None);
        return new Rig(pipeline, sink, stt, primary, fallback, tts);
    }

    private static async Task Feed(CascadeTurnPipeline p, int frames, int delayMs = 0)
    {
        var frame = new byte[640];
        for (var i = 0; i < frames; i++)
        {
            await p.WriteAudioAsync(frame);
            if (delayMs > 0) await Task.Delay(delayMs);
        }
    }

    private static async Task<bool> WaitFor(Func<bool> cond, int timeoutMs = 3000)
    {
        var sw = Stopwatch.StartNew();
        while (!cond())
        {
            if (sw.ElapsedMilliseconds > timeoutMs) return false;
            await Task.Delay(5);
        }
        return true;
    }

    private static async Task RunTurn(Rig r, int frames)
    {
        var run = r.Pipeline.RunAsync();
        await Feed(r.Pipeline, frames);
        r.Pipeline.Release();
        await run.WaitAsync(TimeSpan.FromSeconds(10));
    }

    [Fact]
    public async Task Translation_and_tts_stream_before_the_turn_ends()
    {
        var r = Build();
        var run = r.Pipeline.RunAsync();

        // 3 words per segment at 2 frames per word: the first final arrives after 6 frames.
        await Feed(r.Pipeline, 8, delayMs: 2);
        Assert.True(await WaitFor(() => r.Sink.Of<AudioChunkEvent>().Any()), "no audio before release");
        r.Sink.CountAtRelease = r.Sink.Events.Count;
        var beforeRelease = r.Sink.All;
        Assert.Contains(beforeRelease, e => e is TargetPartialEvent);
        Assert.Contains(beforeRelease, e => e is StageTimingEvent { Stage: StageNames.TtsFirstByte });

        await Feed(r.Pipeline, 6);
        r.Pipeline.Release();
        await run.WaitAsync(TimeSpan.FromSeconds(10));

        var end = Assert.Single(r.Sink.Of<TurnEndEvent>());
        Assert.Equal("completed", end.Status);
        Assert.Equal(TurnPipelineState.Completed, r.Pipeline.State);
        Assert.Contains(r.Sink.Of<StageTimingEvent>(), t => t.Stage == StageNames.SttFinal);
    }

    [Fact]
    public async Task Events_are_ordered_and_every_event_carries_the_turn()
    {
        var r = Build();
        await RunTurn(r, 40); // 20 words -> 6 segments + finalize

        var events = r.Sink.All;
        Assert.All(events, e => Assert.Equal("t1", e.TurnId));
        Assert.IsType<TurnStartEvent>(events[0]);
        Assert.IsType<TurnEndEvent>(events[^1]);

        var commits = r.Sink.Of<SegmentCommitEvent>().Select(c => c.Segment).ToList();
        Assert.Equal(Enumerable.Range(0, commits.Count), commits);

        var audioSegments = r.Sink.Of<AudioChunkEvent>().Select(a => a.Segment).ToList();
        Assert.Equal(audioSegments.Order(), audioSegments); // TTS never interleaves segments

        var partials = r.Sink.Of<TargetPartialEvent>().Select(p => p.Text).ToList();
        for (var i = 1; i < partials.Count; i++) Assert.StartsWith(partials[i - 1], partials[i]);
        Assert.Equal(partials[^1], Assert.Single(r.Sink.Of<TargetFinalEvent>()).Text);

        var usage = Assert.Single(r.Sink.Of<TurnEndEvent>()).Usage!;
        Assert.Equal(0.8, usage.SttAudioSeconds, 3);
        Assert.True(usage.TtsCharacters > 0);
    }

    [Fact]
    public async Task Cancel_stops_every_stage_promptly()
    {
        var slowTts = new FakeTtsProvider(new FakeOptions { FirstLatency = TimeSpan.FromMilliseconds(10), StepLatency = TimeSpan.FromMilliseconds(200) });
        var r = Build(tts: slowTts);
        var run = r.Pipeline.RunAsync();
        await Feed(r.Pipeline, 8);
        Assert.True(await WaitFor(() => r.Sink.Of<AudioChunkEvent>().Any()));

        var sw = Stopwatch.StartNew();
        r.Pipeline.Cancel();
        await run.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.True(sw.ElapsedMilliseconds < 1000, $"cancel took {sw.ElapsedMilliseconds} ms");
        Assert.Equal("cancelled", Assert.Single(r.Sink.Of<TurnEndEvent>()).Status);
        Assert.Equal(TurnPipelineState.Cancelled, r.Pipeline.State);
        Assert.Empty(r.Sink.Of<ErrorEvent>());
    }

    [Fact]
    public async Task Translation_timeout_retries_once_then_reports_provider_timeout()
    {
        var hanging = new FakeTranslationProvider("openai", Fast(FakeFault.Timeout));
        var r = Build(primary: hanging);
        await RunTurn(r, 8);

        var err = Assert.Single(r.Sink.Of<ErrorEvent>());
        Assert.Equal("provider_timeout", err.Code);
        Assert.Equal("translation", err.Stage);
        Assert.Equal(2, hanging.Calls); // first attempt + one retry
        Assert.Equal("failed", Assert.Single(r.Sink.Of<TurnEndEvent>()).Status);
        Assert.Equal(TurnPipelineState.Failed, r.Pipeline.State);
    }

    [Fact]
    public async Task Tts_timeout_reports_provider_timeout_at_tts()
    {
        var r = Build(tts: new FakeTtsProvider(Fast(FakeFault.Timeout)));
        await RunTurn(r, 8);

        var err = Assert.Single(r.Sink.Of<ErrorEvent>());
        Assert.Equal(("provider_timeout", "tts"), (err.Code, err.Stage));
    }

    [Fact]
    public async Task Empty_stt_result_is_a_neutral_empty_result()
    {
        var r = Build(stt: new FakeSttProvider(Fast(FakeFault.Empty)));
        await RunTurn(r, 20);

        var err = Assert.Single(r.Sink.Of<ErrorEvent>());
        Assert.Equal(("empty_result", "stt"), (err.Code, err.Stage));
        Assert.Equal("empty", Assert.Single(r.Sink.Of<TurnEndEvent>()).Status);
        Assert.Equal(0, r.Primary.Calls); // nothing reached translation
    }

    [Fact]
    public async Task Release_without_speech_is_empty_not_an_error()
    {
        var r = Build();
        await RunTurn(r, 1); // 20 ms: no word heard
        Assert.Equal("empty_result", Assert.Single(r.Sink.Of<ErrorEvent>()).Code);
    }

    [Fact]
    public async Task Empty_translation_is_reported_as_empty_result_at_translation()
    {
        var r = Build(primary: new FakeTranslationProvider("openai", Fast(FakeFault.Empty)));
        await RunTurn(r, 8);

        var err = Assert.Single(r.Sink.Of<ErrorEvent>());
        Assert.Equal(("empty_result", "translation"), (err.Code, err.Stage));
        Assert.Empty(r.Sink.Of<AudioChunkEvent>());
    }

    [Fact]
    public async Task Repeated_429_retries_with_backoff_then_fails_over_to_deepl_and_records_it()
    {
        var circuit = new FailoverCircuit(TimeProvider.System);
        var primary = new FakeTranslationProvider("openai", Fast(FakeFault.RateLimit));
        var r = Build(primary: primary, circuit: circuit);
        await RunTurn(r, 8);

        Assert.Equal(4, primary.Calls); // 1 + 3 retries with jitter
        Assert.True(r.Fallback.Calls >= 1);
        var failover = Assert.Single(r.Sink.Of<ProviderFailoverEvent>());
        Assert.Equal(("translation", "openai", "deepl"), (failover.Stage, failover.From, failover.To));
        var end = Assert.Single(r.Sink.Of<TurnEndEvent>());
        Assert.Equal("completed", end.Status);
        Assert.Contains("deepl", end.ProvidersUsed!);
        Assert.Contains("openai → deepl", end.FailoverNote);
        Assert.All(r.Sink.Of<StageTimingEvent>().Where(t => t.Stage.StartsWith("translate")), t => Assert.Equal("deepl", t.Provider));
        Assert.True(circuit.IsOpen);

        // The breaker stays open across turns: the next turn goes straight to DeepL.
        var next = Build(primary: primary, circuit: circuit);
        await RunTurn(next, 8);
        Assert.Equal(4, primary.Calls);
        Assert.Contains("circuit open", Assert.Single(next.Sink.Of<TurnEndEvent>()).FailoverNote);
    }

    [Fact]
    public async Task Transient_429s_within_the_retry_budget_do_not_fail_over()
    {
        var primary = new FakeTranslationProvider("openai", new FakeOptions
        {
            Fault = FakeFault.RateLimitThenOk, FailTimes = 2,
            FirstLatency = TimeSpan.FromMilliseconds(5), StepLatency = TimeSpan.FromMilliseconds(1),
        });
        var r = Build(primary: primary);
        await RunTurn(r, 8);

        Assert.Empty(r.Sink.Of<ProviderFailoverEvent>());
        Assert.Equal(0, r.Fallback.Calls);
        Assert.Equal("completed", Assert.Single(r.Sink.Of<TurnEndEvent>()).Status);
    }

    [Fact]
    public async Task Non_retryable_provider_error_fails_fast_with_its_http_status()
    {
        var primary = new FakeTranslationProvider("openai", Fast(FakeFault.BadRequest));
        var r = Build(primary: primary);
        await RunTurn(r, 8);

        var err = Assert.Single(r.Sink.Of<ErrorEvent>());
        Assert.Equal(("provider_error", 400), (err.Code, err.HttpStatus));
        Assert.Equal(1, primary.Calls);
    }

    [Fact]
    public async Task Stt_final_timeout_keeps_what_was_heard()
    {
        var stt = new FakeSttProvider(Fast(FakeFault.Timeout)) { FramesPerWord = 2, WordsPerSegment = 50 };
        var r = Build(stt: stt, sttFinalTimeout: TimeSpan.FromMilliseconds(200));
        await RunTurn(r, 8); // 4 interim words, never finalized

        var commit = Assert.Single(r.Sink.Of<SegmentCommitEvent>());
        Assert.Equal("My son has had", commit.Text);
        Assert.Equal("completed", Assert.Single(r.Sink.Of<TurnEndEvent>()).Status);
    }

    [Fact]
    public async Task Stt_final_timeout_with_nothing_heard_is_provider_timeout()
    {
        var stt = new FakeSttProvider(Fast(FakeFault.Timeout)) { FramesPerWord = 100 };
        var r = Build(stt: stt, sttFinalTimeout: TimeSpan.FromMilliseconds(150));
        await RunTurn(r, 8);

        var err = Assert.Single(r.Sink.Of<ErrorEvent>());
        Assert.Equal(("provider_timeout", "stt"), (err.Code, err.Stage));
    }

    [Fact]
    public async Task A_stream_that_stalls_after_its_first_token_is_a_provider_timeout()
    {
        // First token arrives fast, then the stream goes silent for longer than the idle timeout.
        var stalling = new FakeTranslationProvider("openai", new FakeOptions { FirstLatency = TimeSpan.FromMilliseconds(5), StepLatency = TimeSpan.FromSeconds(30) });
        var stt = new FakeSttProvider(Fast()) { FramesPerWord = 2, WordsPerSegment = 3 };
        var sink = new RecordingSink();
        var sw = Stopwatch.StartNew();
        var res = new ResilienceOptions { StreamIdleTimeout = TimeSpan.FromMilliseconds(200), RetryBaseDelay = TimeSpan.FromMilliseconds(1) };
        var p = new CascadeTurnPipeline(
            new CascadeTurnSpec("t1", "en", "en", "es"), stt,
            new ResilientTranslationProvider(stalling, null, new FailoverCircuit(TimeProvider.System), res, TimeProvider.System),
            new ResilientTtsProvider(new FakeTtsProvider(Fast()), res, TimeProvider.System),
            new SegmentCommitPolicy(), new PipelineOptions(), sink, () => sw.Elapsed.TotalMilliseconds, CancellationToken.None);
        var run = p.RunAsync();
        await Feed(p, 8);
        p.Release();
        await run.WaitAsync(TimeSpan.FromSeconds(10));

        var err = Assert.Single(sink.Of<ErrorEvent>());
        Assert.Equal(("provider_timeout", "translation"), (err.Code, err.Stage));
        Assert.Contains("stalled", err.Message);
    }

    [Fact]
    public async Task Clause_policy_commits_inside_a_segment_during_speech()
    {
        var stt = new FakeSttProvider(Fast()) { FramesPerWord = 1, WordsPerSegment = 50 };
        var r = Build(stt: stt, policy: new ClauseCommitPolicy());
        await RunTurn(r, 12); // "My son has had a fever since last night, and the pain started"

        var commits = r.Sink.Of<SegmentCommitEvent>().Select(c => c.Text).ToList();
        Assert.Equal("My son has had a fever since last night,", commits[0]);
        Assert.True(commits.Count >= 2);
    }
}
