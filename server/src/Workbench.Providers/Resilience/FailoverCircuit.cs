using System.Collections.Concurrent;

namespace Workbench.Providers.Resilience;

/// <summary>
/// Circuit breaker for one provider. When the retry budget for 429s is exhausted the circuit opens
/// for <see cref="ResilienceOptions.BreakDuration"/>; while open, callers go straight to the fallback.
/// Shared across sessions (it describes the provider, not the turn).
/// </summary>
public sealed class FailoverCircuit(TimeProvider time)
{
    private long _openUntilTicks;

    public bool IsOpen => time.GetUtcNow().UtcTicks < Interlocked.Read(ref _openUntilTicks);

    public void Trip(TimeSpan duration) => Interlocked.Exchange(ref _openUntilTicks, (time.GetUtcNow() + duration).UtcTicks);

    public void Reset() => Interlocked.Exchange(ref _openUntilTicks, 0);
}

public sealed class FailoverCircuitRegistry(TimeProvider time)
{
    private readonly ConcurrentDictionary<string, FailoverCircuit> _circuits = new();

    public FailoverCircuit For(string provider) => _circuits.GetOrAdd(provider, _ => new FailoverCircuit(time));
}
