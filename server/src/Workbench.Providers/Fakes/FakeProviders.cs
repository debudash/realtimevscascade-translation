using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Workbench.Core;
using Workbench.Core.Contracts;

namespace Workbench.Providers.Fakes;

/// <summary>Failure injected into a fake provider (debugging, pipeline tests, UI error states).</summary>
public enum FakeFault
{
    None,
    /// <summary>Every call fails with 429.</summary>
    RateLimit,
    /// <summary>The first <c>FailTimes</c> calls fail with 429, then calls succeed.</summary>
    RateLimitThenOk,
    /// <summary>Never produces a first result (hangs until cancelled).</summary>
    Timeout,
    /// <summary>Completes with no output.</summary>
    Empty,
    /// <summary>Fails with HTTP 500.</summary>
    Error,
    /// <summary>Fails with HTTP 400 (non-retryable).</summary>
    BadRequest,
}

public sealed class FakeOptions
{
    public FakeFault Fault { get; set; }
    public int FailTimes { get; set; } = 3;
    public TimeSpan FirstLatency { get; set; } = TimeSpan.FromMilliseconds(120);
    public TimeSpan StepLatency { get; set; } = TimeSpan.FromMilliseconds(15);

    public static FakeFault Parse(string? s) => s?.ToLowerInvariant() switch
    {
        "429" or "rate_limit" or "ratelimit" => FakeFault.RateLimit,
        "429x3" or "rate_limit_then_ok" => FakeFault.RateLimitThenOk,
        "timeout" => FakeFault.Timeout,
        "empty" => FakeFault.Empty,
        "error" or "500" => FakeFault.Error,
        "400" => FakeFault.BadRequest,
        _ => FakeFault.None,
    };
}

internal static class FakeFaults
{
    /// <summary>Throws or hangs according to the fault. Returns true when the call should produce no output.</summary>
    public static async Task<bool> ApplyAsync(FakeOptions o, int call, string provider, string stage, CancellationToken ct)
    {
        switch (o.Fault)
        {
            case FakeFault.RateLimit:
                throw new RateLimitedException(provider, stage, $"{provider} returned 429 (fake)");
            case FakeFault.RateLimitThenOk when call <= o.FailTimes:
                throw new RateLimitedException(provider, stage, $"{provider} returned 429 (fake, call {call})");
            case FakeFault.Error:
                throw new ProviderErrorException(provider, stage, $"{provider} returned 500 (fake)", 500);
            case FakeFault.BadRequest:
                throw new ProviderErrorException(provider, stage, $"{provider} returned 400 (fake)", 400);
            case FakeFault.Timeout:
                await Task.Delay(Timeout.Infinite, ct);
                return true;
            case FakeFault.Empty:
                return true;
            default:
                return false;
        }
    }
}

/// <summary>
/// Scripted STT: "hears" one word of a script per <see cref="FramesPerWord"/> frames, emits interim
/// results as words arrive, a final every <see cref="WordsPerSegment"/> words, and the remainder
/// as a finalize result when the audio channel completes (button release).
/// </summary>
public sealed class FakeSttProvider(FakeOptions? options = null) : ISttProvider
{
    private int _calls;
    public FakeOptions Options { get; } = options ?? new FakeOptions();
    public string Name => "fake";
    public int FramesPerWord { get; init; } = 10; // 200 ms per word
    public int WordsPerSegment { get; init; } = 6;
    public int Calls => _calls;

    public static readonly IReadOnlyDictionary<string, string> Scripts = new Dictionary<string, string>
    {
        ["en"] = "My son has had a fever since last night, and the pain started after lunch and it is getting worse.",
        ["es"] = "Tengo una cita a las tres con la doctora, pero no entiendo las instrucciones de la receta.",
        ["fr"] = "Mon fils a de la fièvre depuis hier soir, et la douleur a commencé après le déjeuner.",
    };

    public async IAsyncEnumerable<SttResult> TranscribeAsync(ChannelReader<AudioFrame> audio, SttOptions opts, [EnumeratorCancellation] CancellationToken ct)
    {
        var words = Scripts.GetValueOrDefault(opts.Language, Scripts["en"]).Split(' ');
        var empty = Options.Fault is FakeFault.Empty;
        if (Options.Fault is not (FakeFault.Timeout or FakeFault.Empty))
            await FakeFaults.ApplyAsync(Options, Interlocked.Increment(ref _calls), Name, "stt", ct);

        var frames = 0;
        var heard = 0;
        var segStart = 0;
        await foreach (var _ in audio.ReadAllAsync(ct))
        {
            if (empty || ++frames % FramesPerWord != 0 || heard >= words.Length) continue;
            heard++;
            if (heard - segStart >= WordsPerSegment)
            {
                yield return new SttResult(string.Join(' ', words[segStart..heard]), IsFinal: true);
                segStart = heard;
            }
            else
            {
                yield return new SttResult(string.Join(' ', words[segStart..heard]), IsFinal: false);
            }
        }

        // Released: finalize.
        if (Options.Fault is FakeFault.Timeout) await Task.Delay(Timeout.Infinite, ct);
        await Task.Delay(Options.FirstLatency, ct);
        if (heard > segStart) yield return new SttResult(string.Join(' ', words[segStart..heard]), IsFinal: true, FromFinalize: true);
    }
}

/// <summary>Streams a recognizable pseudo-translation ("[es] word word ...") word by word.</summary>
public sealed class FakeTranslationProvider(string name = "fake", FakeOptions? options = null) : ITranslationProvider
{
    private int _calls;
    public FakeOptions Options { get; } = options ?? new FakeOptions();
    public string Name { get; } = name;
    public int Calls => _calls;

    public async IAsyncEnumerable<string> TranslateAsync(Segment segment, TranslationContext ctx, [EnumeratorCancellation] CancellationToken ct)
    {
        if (await FakeFaults.ApplyAsync(Options, Interlocked.Increment(ref _calls), Name, "translation", ct)) yield break;
        await Task.Delay(Options.FirstLatency, ct);
        ctx.Meter?.AddTokens(segment.Text.Length / 4 + 20, segment.Text.Length / 4);
        var words = segment.Text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        yield return $"[{ctx.TargetLang}]";
        foreach (var w in words)
        {
            await Task.Delay(Options.StepLatency, ct);
            yield return " " + w;
        }
    }
}

/// <summary>Synthesizes a soft tone, 50 ms of audio per character, in 100 ms PCM16 chunks.</summary>
public sealed class FakeTtsProvider(FakeOptions? options = null) : ITtsProvider
{
    public const int SampleRate = 24000;
    private int _calls;
    public FakeOptions Options { get; } = options ?? new FakeOptions();
    public string Name => "fake";
    public int Calls => _calls;

    public async IAsyncEnumerable<AudioChunk> SynthesizeAsync(string text, VoiceOptions voice, [EnumeratorCancellation] CancellationToken ct)
    {
        if (await FakeFaults.ApplyAsync(Options, Interlocked.Increment(ref _calls), Name, "tts", ct)) yield break;
        await Task.Delay(Options.FirstLatency, ct);
        var totalSamples = Math.Min(text.Length * SampleRate / 20, SampleRate * 4);
        const int chunkSamples = SampleRate / 10;
        for (var start = 0; start < totalSamples; start += chunkSamples)
        {
            var n = Math.Min(chunkSamples, totalSamples - start);
            var bytes = new byte[n * 2];
            for (var i = 0; i < n; i++)
            {
                var v = (short)(4000 * Math.Sin(2 * Math.PI * 330 * (start + i) / SampleRate));
                bytes[2 * i] = (byte)v;
                bytes[2 * i + 1] = (byte)(v >> 8);
            }
            yield return new AudioChunk(bytes, SampleRate);
            await Task.Delay(Options.StepLatency, ct);
        }
    }
}
