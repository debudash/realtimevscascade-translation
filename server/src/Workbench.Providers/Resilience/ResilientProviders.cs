using System.Runtime.CompilerServices;
using Polly;
using Polly.Retry;
using Workbench.Core;
using Workbench.Core.Contracts;

namespace Workbench.Providers.Resilience;

internal static class RetryPipelines
{
    /// <summary>
    /// Outer: one retry after a first-item timeout. Inner: up to MaxRetries on 429 / transient
    /// errors, exponential backoff with jitter (Polly). Retries happen before the first item only.
    /// </summary>
    public static ResiliencePipeline Build(ResilienceOptions o, TimeProvider time)
    {
        var builder = new ResiliencePipelineBuilder { TimeProvider = time };
        if (o.TimeoutRetries > 0)
        {
            builder.AddRetry(new RetryStrategyOptions
            {
                ShouldHandle = new PredicateBuilder().Handle<ProviderTimeoutException>(),
                MaxRetryAttempts = o.TimeoutRetries,
                Delay = TimeSpan.Zero,
            });
        }
        if (o.MaxRetries <= 0) return builder.Build();
        return builder.AddRetry(new RetryStrategyOptions
            {
                ShouldHandle = new PredicateBuilder()
                    .Handle<RateLimitedException>()
                    .Handle<ProviderErrorException>(e => e.Retryable),
                MaxRetryAttempts = o.MaxRetries,
                BackoffType = DelayBackoffType.Exponential,
                UseJitter = true,
                Delay = o.RetryBaseDelay,
            })
            .Build();
    }
}

/// <summary>
/// Translation with per-stage timeout, Polly retry with jitter, and a circuit breaker that fails over
/// to the secondary provider (DeepL) after repeated 429s. The failover is recorded on the turn.
/// </summary>
public sealed class ResilientTranslationProvider : ITranslationProvider
{
    private readonly ITranslationProvider _primary;
    private readonly ITranslationProvider? _fallback;
    private readonly FailoverCircuit _circuit;
    private readonly ResilienceOptions _opts;
    private readonly ResiliencePipeline _retry;
    private readonly TimeProvider _time;

    public ResilientTranslationProvider(
        ITranslationProvider primary,
        ITranslationProvider? fallback,
        FailoverCircuit circuit,
        ResilienceOptions opts,
        TimeProvider time)
    {
        _primary = primary;
        _fallback = fallback is not null && fallback.Name != primary.Name ? fallback : null;
        _circuit = circuit;
        _opts = opts;
        _time = time;
        _retry = RetryPipelines.Build(opts, time);
    }

    public string Name => _primary.Name;

    public async IAsyncEnumerable<string> TranslateAsync(Segment segment, TranslationContext ctx, [EnumeratorCancellation] CancellationToken ct)
    {
        StartedStream<string> stream;
        if (_fallback is not null && _circuit.IsOpen)
        {
            ctx.Meter?.ReportFailover("translation", _primary.Name, _fallback.Name, "circuit open after repeated 429s");
            stream = await Start(_fallback, segment, ctx, ct);
        }
        else
        {
            try
            {
                stream = await Start(_primary, segment, ctx, ct);
            }
            catch (RateLimitedException) when (_fallback is not null)
            {
                _circuit.Trip(_opts.BreakDuration);
                ctx.Meter?.ReportFailover("translation", _primary.Name, _fallback.Name,
                    $"429 {_opts.MaxRetries + 1} times; circuit open for {_opts.BreakDuration.TotalSeconds:0} s");
                stream = await Start(_fallback, segment, ctx, ct);
            }
        }

        await using (stream)
        {
            await foreach (var token in stream.ReadAllAsync(_opts.StreamIdleTimeout, _time).WithCancellation(ct)) yield return token;
        }
    }

    private async Task<StartedStream<string>> Start(ITranslationProvider p, Segment segment, TranslationContext ctx, CancellationToken ct)
    {
        if (ctx.Meter is not null) ctx.Meter.TranslationProvider = p.Name;
        return await _retry.ExecuteAsync(
            async token => await StartedStream<string>.StartAsync(
                t => p.TranslateAsync(segment, ctx, t), _opts.TranslationFirstTokenTimeout, p.Name, "translation", "first token", _time, token),
            ct);
    }
}

/// <summary>TTS with a first-byte timeout (one retry) and Polly retry with jitter on 429 / transient errors.</summary>
public sealed class ResilientTtsProvider(ITtsProvider inner, ResilienceOptions opts, TimeProvider time) : ITtsProvider
{
    private readonly ResiliencePipeline _retry = RetryPipelines.Build(opts, time);

    public string Name => inner.Name;

    public async IAsyncEnumerable<AudioChunk> SynthesizeAsync(string text, VoiceOptions voice, [EnumeratorCancellation] CancellationToken ct)
    {
        var stream = await _retry.ExecuteAsync(
            async token => await StartedStream<AudioChunk>.StartAsync(
                t => inner.SynthesizeAsync(text, voice, t), opts.TtsFirstByteTimeout, inner.Name, "tts", "first audio byte", time, token),
            ct);
        await using (stream)
        {
            await foreach (var chunk in stream.ReadAllAsync(opts.StreamIdleTimeout, time).WithCancellation(ct)) yield return chunk;
        }
    }
}
