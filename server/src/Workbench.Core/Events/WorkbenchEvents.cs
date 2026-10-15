using System.Text.Json;
using System.Text.Json.Serialization;

namespace Workbench.Core.Events;

/// <summary>
/// The normalized event schema shared by both transports (docs/architecture.md §3).
/// The TypeScript mirror lives in client/src/contracts/events.ts; the round-trip
/// contract test (contracts/event-samples.json) keeps the two in step.
/// </summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(SessionReadyEvent), "session.ready")]
[JsonDerivedType(typeof(TurnStartEvent), "turn.start")]
[JsonDerivedType(typeof(TurnEndEvent), "turn.end")]
[JsonDerivedType(typeof(SourcePartialEvent), "source.partial")]
[JsonDerivedType(typeof(SourceFinalEvent), "source.final")]
[JsonDerivedType(typeof(SegmentCommitEvent), "segment.commit")]
[JsonDerivedType(typeof(TargetPartialEvent), "target.partial")]
[JsonDerivedType(typeof(TargetFinalEvent), "target.final")]
[JsonDerivedType(typeof(AudioChunkEvent), "audio.chunk")]
[JsonDerivedType(typeof(StageTimingEvent), "stage.timing")]
[JsonDerivedType(typeof(ProviderFailoverEvent), "provider.failover")]
[JsonDerivedType(typeof(FloorDeniedEvent), "floor.denied")]
[JsonDerivedType(typeof(ErrorEvent), "error")]
public abstract record WorkbenchEvent
{
    /// <summary>The turn this event belongs to; null for session-level events.</summary>
    public string? TurnId { get; init; }

    /// <summary>Monotonic milliseconds on the emitting side's clock (server: Stopwatch since session start).</summary>
    public double T { get; init; }
}

public sealed record ProviderSet(string Stt, string Translation, string TranslationFallback, string Tts);

public sealed record SessionReadyEvent(string Mode, ProviderSet Providers, string Strategy) : WorkbenchEvent;

public sealed record TurnStartEvent(string Speaker, string Direction) : WorkbenchEvent;

/// <param name="Status">completed | empty | cancelled | failed</param>
public sealed record TurnEndEvent(
    string Speaker,
    string Direction,
    string Status,
    TurnUsage? Usage = null,
    IReadOnlyList<string>? ProvidersUsed = null,
    string? FailoverNote = null) : WorkbenchEvent;

/// <summary>Usage logged per turn, priced later by the report from harness/pricing.json.</summary>
public sealed record TurnUsage(
    double SttAudioSeconds,
    int TranslationInputTokens,
    int TranslationOutputTokens,
    int TranslationCharacters,
    int TtsCharacters);

/// <param name="Text">The full source text so far (stable + interim).</param>
/// <param name="Stable">The prefix of Text that will not change.</param>
public sealed record SourcePartialEvent(string Text, string Lang, string Stable) : WorkbenchEvent;

/// <param name="Text">The full, final source text for the turn so far.</param>
public sealed record SourceFinalEvent(string Text, string Lang) : WorkbenchEvent;

/// <summary>A commit-policy decision: this source text goes to translation now.</summary>
public sealed record SegmentCommitEvent(int Segment, string Text) : WorkbenchEvent;

/// <param name="Text">The full target text so far (cumulative).</param>
public sealed record TargetPartialEvent(string Text, string Lang) : WorkbenchEvent;

public sealed record TargetFinalEvent(string Text, string Lang) : WorkbenchEvent;

/// <param name="Data">Base64 PCM16 little-endian mono.</param>
public sealed record AudioChunkEvent(string Data, int SampleRate, int Segment) : WorkbenchEvent;

/// <param name="Stage">stt_final | translate_first_token | translate_done | tts_first_byte</param>
public sealed record StageTimingEvent(string Stage, double DurationMs, int Segment, string Provider) : WorkbenchEvent;

public sealed record ProviderFailoverEvent(string Stage, string From, string To, string Reason) : WorkbenchEvent;

/// <summary>Log only, not a tracked metric.</summary>
public sealed record FloorDeniedEvent(string Speaker) : WorkbenchEvent;

public sealed record ErrorEvent(
    string Code,
    string Message,
    bool Retryable,
    string? Provider = null,
    string? Stage = null,
    int? HttpStatus = null) : WorkbenchEvent;

public static class StageNames
{
    public const string SttFinal = "stt_final";
    public const string TranslateFirstToken = "translate_first_token";
    public const string TranslateDone = "translate_done";
    public const string TtsFirstByte = "tts_first_byte";
}

public static class EventJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string Serialize(WorkbenchEvent e) => JsonSerializer.Serialize(e, Options);

    public static WorkbenchEvent? Deserialize(string json) => JsonSerializer.Deserialize<WorkbenchEvent>(json, Options);
}
