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

/// <summary>
/// Controllability levers for the translation stage (clinic register, required terminology).
/// Each adapter applies them its own way: DeepL via formality + a glossary, an LLM via its prompt.
/// </summary>
/// <param name="Formal">Address the listener formally (usted / vous / Sie).</param>
/// <param name="Glossary">Required term translations for this direction (source term -> target term).</param>
public sealed record TranslationControls(bool Formal, IReadOnlyDictionary<string, string> Glossary)
{
    public static readonly TranslationControls None = new(false, new Dictionary<string, string>());
    public bool Any => Formal || Glossary.Count > 0;
}

/// <param name="Previous">The last committed segments (oldest first), with their translations, for context.</param>
/// <param name="Meter">Per-turn meter: adapters add token usage; the resilience layer reports provider used and failover.</param>
/// <param name="Controls">Register and terminology controls; null or None = provider defaults.</param>
public sealed record TranslationContext(
    string SourceLang,
    string TargetLang,
    IReadOnlyList<(string Source, string Target)> Previous,
    TurnMeter? Meter = null,
    TranslationControls? Controls = null);

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

/// <summary>
/// Thread-safe per-turn bookkeeping: usage counters (turned into TurnUsage at turn end), which
/// translation provider actually served, and failovers (reported to the turn as they happen).
/// </summary>
public sealed class TurnMeter
{
    private long _sttMs, _inTok, _outTok, _trChars, _ttsChars;
    private string? _translationProvider;
    private string? _failoverNote;

    public void AddSttAudio(TimeSpan d) => Interlocked.Add(ref _sttMs, (long)d.TotalMilliseconds);
    public void AddTokens(int input, int output) { Interlocked.Add(ref _inTok, input); Interlocked.Add(ref _outTok, output); }
    public void AddTranslationChars(int n) => Interlocked.Add(ref _trChars, n);
    public void AddTtsChars(int n) => Interlocked.Add(ref _ttsChars, n);

    /// <summary>The provider that served the most recent translation (primary or fallback).</summary>
    public string? TranslationProvider
    {
        get => Volatile.Read(ref _translationProvider);
        set => Volatile.Write(ref _translationProvider, value);
    }

    public string? FailoverNote => Volatile.Read(ref _failoverNote);

    /// <summary>Raised when the resilience layer switches provider mid-turn.</summary>
    public Action<string, string, string, string>? OnFailover { get; set; }

    /// <summary>Records the first failover of the turn; later segments on the same fallback are not re-reported.</summary>
    public void ReportFailover(string stage, string from, string to, string reason)
    {
        if (Interlocked.CompareExchange(ref _failoverNote, $"{stage}: {from} → {to} ({reason})", null) is not null) return;
        OnFailover?.Invoke(stage, from, to, reason);
    }

    public Events.TurnUsage Snapshot() => new(
        Math.Round(Interlocked.Read(ref _sttMs) / 1000.0, 3),
        (int)Interlocked.Read(ref _inTok),
        (int)Interlocked.Read(ref _outTok),
        (int)Interlocked.Read(ref _trChars),
        (int)Interlocked.Read(ref _ttsChars));
}
