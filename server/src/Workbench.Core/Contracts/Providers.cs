using System.Threading.Channels;

namespace Workbench.Core.Contracts;

/// <summary>20 ms of PCM16 16 kHz mono audio from the browser (640 bytes).</summary>
public readonly record struct AudioFrame(ReadOnlyMemory<byte> Pcm16);

/// <summary>A chunk of synthesized PCM16 audio.</summary>
public readonly record struct AudioChunk(ReadOnlyMemory<byte> Pcm16, int SampleRate);

/// <summary>
/// One STT update. Interim results revise the current segment; a final result closes it.
/// FromFinalize marks the result produced by the end-of-turn finalize request.
/// </summary>
public sealed record SttResult(string Text, bool IsFinal, bool FromFinalize = false);

/// <summary>Source text the commit policy has released to translation.</summary>
public sealed record Segment(int Index, string Text);

public sealed record SttOptions(string Language, int SampleRate = 16000);

/// <param name="Previous">The last committed segments (oldest first), with their translations, for context.</param>
/// <param name="Usage">Per-turn meter; adapters that report token usage add to it.</param>
public sealed record TranslationContext(
    string SourceLang,
    string TargetLang,
    IReadOnlyList<(string Source, string Target)> Previous,
    UsageMeter? Usage = null);

public sealed record VoiceOptions(string Language, string? VoiceId = null);

public interface ISttProvider
{
    string Name { get; }

    /// <summary>
    /// Streams results while audio arrives. When the audio channel completes (button release)
    /// the adapter finalizes, yields the remaining finals, and ends the sequence.
    /// </summary>
    IAsyncEnumerable<SttResult> TranscribeAsync(ChannelReader<AudioFrame> audio, SttOptions opts, CancellationToken ct);
}

/// <summary>Pure: no I/O, no clocks. One instance per turn.</summary>
public interface ICommitPolicy
{
    string Name { get; }
    IReadOnlyList<Segment> Accept(SttResult result);

    /// <summary>Called at the end of the turn; releases anything not yet committed.</summary>
    IReadOnlyList<Segment> Flush();
}

public interface ITranslationProvider
{
    string Name { get; }

    /// <summary>Streams target text deltas for one segment.</summary>
    IAsyncEnumerable<string> TranslateAsync(Segment segment, TranslationContext ctx, CancellationToken ct);
}

public interface ITtsProvider
{
    string Name { get; }
    IAsyncEnumerable<AudioChunk> SynthesizeAsync(string text, VoiceOptions voice, CancellationToken ct);
}

/// <summary>Providers that can open connections ahead of the first turn (warm-up).</summary>
public interface IWarmable
{
    Task WarmUpAsync(CancellationToken ct);
}

/// <summary>Thread-safe per-turn usage counters, turned into TurnUsage at turn end.</summary>
public sealed class UsageMeter
{
    private long _sttMs, _inTok, _outTok, _trChars, _ttsChars;

    public void AddSttAudio(TimeSpan d) => Interlocked.Add(ref _sttMs, (long)d.TotalMilliseconds);
    public void AddTokens(int input, int output) { Interlocked.Add(ref _inTok, input); Interlocked.Add(ref _outTok, output); }
    public void AddTranslationChars(int n) => Interlocked.Add(ref _trChars, n);
    public void AddTtsChars(int n) => Interlocked.Add(ref _ttsChars, n);

    public Events.TurnUsage Snapshot() => new(
        Math.Round(Interlocked.Read(ref _sttMs) / 1000.0, 3),
        (int)Interlocked.Read(ref _inTok),
        (int)Interlocked.Read(ref _outTok),
        (int)Interlocked.Read(ref _trChars),
        (int)Interlocked.Read(ref _ttsChars));
}
