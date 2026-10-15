namespace Workbench.Providers.Resilience;

/// <summary>Per-stage timeouts and retry/breaker settings (docs/architecture.md §6). Bound from "Resilience".</summary>
public sealed class ResilienceOptions
{
    public TimeSpan SttFinalTimeout { get; set; } = TimeSpan.FromSeconds(2);
    public TimeSpan TranslationFirstTokenTimeout { get; set; } = TimeSpan.FromSeconds(2);
    public TimeSpan TtsFirstByteTimeout { get; set; } = TimeSpan.FromSeconds(2);

    /// <summary>Retries after a first-token / first-byte timeout before provider_timeout.</summary>
    public int TimeoutRetries { get; set; } = 1;

    /// <summary>Retries on 429 and transient (5xx) errors, exponential backoff with jitter.</summary>
    public int MaxRetries { get; set; } = 3;
    public TimeSpan RetryBaseDelay { get; set; } = TimeSpan.FromMilliseconds(200);

    /// <summary>How long translation stays failed over after repeated 429s.</summary>
    public TimeSpan BreakDuration { get; set; } = TimeSpan.FromSeconds(60);
}
