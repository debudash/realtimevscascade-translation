using Microsoft.Extensions.Options;
using Workbench.Api.Config;
using Workbench.Core.Contracts;
using Workbench.Core.Events;
using Workbench.Providers.Fakes;
using Workbench.Providers.Resilience;

namespace Workbench.Api.Control;

/// <summary>Per-session provider choice. Unset fields fall back to the "Providers" config section.</summary>
public sealed record ProviderSelection(string? Stt = null, string? Translation = null, string? TranslationFallback = null, string? Tts = null);

/// <summary>Fault injection for fake providers only (UI error states, demos). Ignored for real providers.</summary>
public sealed record FaultSelection(string? Stt = null, string? Translation = null, string? TranslationFallback = null, string? Tts = null);

public sealed record CascadeProviderSet(
    ISttProvider Stt,
    ITranslationProvider Translation,
    ITtsProvider Tts,
    ProviderSet Names,
    IReadOnlyList<IWarmable> Warmables);

/// <summary>
/// Builds a session's providers by name and wraps translation and TTS in the resilience layer.
/// Swapping a provider is a config change (or a per-session override); adapters register here.
/// </summary>
public sealed class CascadeProviderFactory(
    IServiceProvider services,
    IOptions<ProvidersOptions> defaults,
    IOptions<ResilienceOptions> resilience,
    FailoverCircuitRegistry circuits,
    IConfiguration config,
    TimeProvider time)
{
    /// <summary>Which .env variable each real provider needs.</summary>
    public static readonly IReadOnlyDictionary<string, (string ConfigPath, string Variable)> Keys =
        new Dictionary<string, (string, string)>
        {
            ["deepgram"] = ("Deepgram:ApiKey", "Deepgram__ApiKey"),
            ["openai"] = ("OpenAI:ApiKey", "OpenAI__ApiKey"),
            ["deepl"] = ("DeepL:ApiKey", "DeepL__ApiKey"),
            ["elevenlabs"] = ("ElevenLabs:ApiKey", "ElevenLabs__ApiKey"),
        };

    private readonly Dictionary<string, Func<FakeOptions, ISttProvider>> _stt = new()
    {
        ["fake"] = o => new FakeSttProvider(o),
    };

    private readonly Dictionary<string, Func<FakeOptions, ITranslationProvider>> _translation = new()
    {
        ["fake"] = o => new FakeTranslationProvider("fake", o),
        ["fake-deepl"] = o => new FakeTranslationProvider("fake-deepl", o),
    };

    private readonly Dictionary<string, Func<FakeOptions, ITtsProvider>> _tts = new()
    {
        ["fake"] = o => new FakeTtsProvider(o),
    };

    /// <summary>Registers a real adapter (resolved from DI when a session asks for it).</summary>
    public void AddStt(string name, Func<IServiceProvider, ISttProvider> make) => _stt[name] = _ => make(services);
    public void AddTranslation(string name, Func<IServiceProvider, ITranslationProvider> make) => _translation[name] = _ => make(services);
    public void AddTts(string name, Func<IServiceProvider, ITtsProvider> make) => _tts[name] = _ => make(services);

    public ProviderSet Resolve(ProviderSelection? sel)
    {
        var d = defaults.Value;
        var translation = sel?.Translation ?? d.Translation;
        // A fake primary fails over to a distinct fake so the failover path is demonstrable without keys.
        var fallback = sel?.TranslationFallback ?? (translation == "fake" ? "fake-deepl" : d.TranslationFallback);
        if (fallback == translation) fallback = translation == "fake" ? "fake-deepl" : "none";
        return new ProviderSet(sel?.Stt ?? d.Stt, translation, fallback, sel?.Tts ?? d.Tts);
    }

    /// <summary>Names of missing .env variables for the selected providers (never values).</summary>
    public IReadOnlyList<string> MissingKeys(ProviderSet names) =>
        new[] { names.Stt, names.Translation, names.TranslationFallback, names.Tts }
            .Where(n => Keys.ContainsKey(n))
            .Select(n => Keys[n])
            .Where(k => string.IsNullOrWhiteSpace(config[k.ConfigPath]))
            .Select(k => k.Variable)
            .Distinct()
            .ToList();

    public IReadOnlyList<string> UnknownProviders(ProviderSet n)
    {
        var unknown = new List<string>();
        if (!_stt.ContainsKey(n.Stt)) unknown.Add($"stt:{n.Stt}");
        if (!_translation.ContainsKey(n.Translation)) unknown.Add($"translation:{n.Translation}");
        if (n.TranslationFallback != "none" && !_translation.ContainsKey(n.TranslationFallback)) unknown.Add($"translationFallback:{n.TranslationFallback}");
        if (!_tts.ContainsKey(n.Tts)) unknown.Add($"tts:{n.Tts}");
        return unknown;
    }

    public CascadeProviderSet Create(ProviderSet names, FaultSelection? faults)
    {
        FakeOptions Fake(string? fault) => new() { Fault = FakeOptions.Parse(fault) };

        var stt = _stt[names.Stt](Fake(faults?.Stt));
        var primary = _translation[names.Translation](Fake(faults?.Translation));
        var fallback = names.TranslationFallback == "none" ? null : _translation[names.TranslationFallback](Fake(faults?.TranslationFallback));
        var tts = _tts[names.Tts](Fake(faults?.Tts));

        // Real providers share one breaker per provider; fakes get a fresh one per session.
        var circuit = primary is FakeTranslationProvider ? new FailoverCircuit(time) : circuits.For(primary.Name);
        var res = resilience.Value;

        return new CascadeProviderSet(
            stt,
            new ResilientTranslationProvider(primary, fallback, circuit, res, time),
            new ResilientTtsProvider(tts, res, time),
            names,
            new object?[] { stt, primary, fallback, tts }.OfType<IWarmable>().Distinct().ToList());
    }
}
