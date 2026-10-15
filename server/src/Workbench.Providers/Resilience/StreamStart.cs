using Workbench.Core;

namespace Workbench.Providers.Resilience;

/// <summary>
/// A provider stream whose first item has already arrived. Retrying is only safe before the first
/// item (nothing has been emitted downstream yet), so resilience wraps "start the stream and get
/// the first item" and then hands the open stream on.
/// </summary>
internal sealed class StartedStream<T> : IAsyncDisposable
{
    private readonly IAsyncEnumerator<T> _enumerator;
    private readonly CancellationTokenSource _attempt;
    private readonly bool _hasFirst;

    private StartedStream(IAsyncEnumerator<T> e, CancellationTokenSource attempt, bool hasFirst)
    {
        _enumerator = e;
        _attempt = attempt;
        _hasFirst = hasFirst;
    }

    /// <summary>Opens the stream and waits up to <paramref name="firstItemTimeout"/> for its first item.</summary>
    /// <exception cref="ProviderTimeoutException">No first item in time (the attempt is cancelled).</exception>
    public static async Task<StartedStream<T>> StartAsync(
        Func<CancellationToken, IAsyncEnumerable<T>> open,
        TimeSpan firstItemTimeout,
        string provider,
        string stage,
        string what,
        CancellationToken ct)
    {
        var attempt = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var e = open(attempt.Token).GetAsyncEnumerator(attempt.Token);
        try
        {
            var move = e.MoveNextAsync().AsTask();
            var winner = await Task.WhenAny(move, Task.Delay(firstItemTimeout, ct));
            if (winner != move)
            {
                ct.ThrowIfCancellationRequested();
                throw new ProviderTimeoutException(provider, stage, $"No {what} within {firstItemTimeout.TotalSeconds:0.0} s");
            }
            return new StartedStream<T>(e, attempt, await move);
        }
        catch
        {
            attempt.Cancel();
            await SafeDispose(e);
            attempt.Dispose();
            throw;
        }
    }

    /// <summary>Yields the first item and the rest of the stream.</summary>
    public async IAsyncEnumerable<T> ReadAllAsync()
    {
        if (!_hasFirst) yield break;
        yield return _enumerator.Current;
        while (await _enumerator.MoveNextAsync()) yield return _enumerator.Current;
    }

    public async ValueTask DisposeAsync()
    {
        _attempt.Cancel();
        await SafeDispose(_enumerator);
        _attempt.Dispose();
    }

    private static async ValueTask SafeDispose(IAsyncEnumerator<T> e)
    {
        try
        {
            await e.DisposeAsync();
        }
        catch
        {
            // The attempt was cancelled; its cleanup errors are irrelevant.
        }
    }
}
