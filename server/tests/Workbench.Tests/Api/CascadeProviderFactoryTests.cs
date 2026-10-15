using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Workbench.Api.Config;
using Workbench.Api.Control;
using Workbench.Core.Contracts;
using Workbench.Providers.Fakes;
using Workbench.Providers.Resilience;

namespace Workbench.Tests.Api;

public class CascadeProviderFactoryTests
{
    private static CascadeProviderFactory Factory(Dictionary<string, string?> keys, ProvidersOptions? defaults = null)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(keys).Build();
        var f = new CascadeProviderFactory(
            new ServiceCollection().BuildServiceProvider(),
            Options.Create(defaults ?? new ProvidersOptions()),
            Options.Create(new ResilienceOptions()),
            new FailoverCircuitRegistry(TimeProvider.System),
            config,
            TimeProvider.System);
        // Stand-ins for the real adapters (registration is what is under test here).
        f.AddStt("deepgram", _ => new FakeSttProvider());
        f.AddTranslation("openai", _ => new FakeTranslationProvider("openai"));
        f.AddTranslation("deepl", _ => new FakeTranslationProvider("deepl"));
        f.AddTts("elevenlabs", _ => new FakeTtsProvider());
        return f;
    }

    private static readonly Dictionary<string, string?> AllKeys = new()
    {
        ["OpenAI:ApiKey"] = "a", ["Deepgram:ApiKey"] = "b", ["ElevenLabs:ApiKey"] = "c", ["DeepL:ApiKey"] = "d",
    };

    [Fact]
    public void Resolve_uses_config_defaults_and_applies_per_session_overrides()
    {
        var f = Factory(AllKeys);
        Assert.Equal(new ProviderSetNames("deepgram", "openai", "deepl", "elevenlabs"), Names(f.Resolve(null)));
        Assert.Equal(new ProviderSetNames("deepgram", "deepl", "none", "elevenlabs"), Names(f.Resolve(new ProviderSelection(Translation: "deepl"))));
    }

    [Fact]
    public void Config_alone_swaps_the_default_translator()
    {
        var f = Factory(AllKeys, new ProvidersOptions { Translation = "deepl", TranslationFallback = "openai" });
        var set = f.Create(f.Resolve(null), null);
        Assert.Equal("deepl", set.Translation.Name);
    }

    [Fact]
    public void A_fake_primary_gets_a_distinct_fake_fallback()
    {
        var f = Factory(AllKeys);
        Assert.Equal("fake-deepl", f.Resolve(new ProviderSelection("fake", "fake", null, "fake")).TranslationFallback);
        Assert.Equal("fake-deepl", f.Resolve(new ProviderSelection("fake", "fake", "fake", "fake")).TranslationFallback);
    }

    [Fact]
    public void Missing_keys_name_only_the_providers_that_block_the_session()
    {
        var keys = new Dictionary<string, string?>(AllKeys) { ["Deepgram:ApiKey"] = "", ["DeepL:ApiKey"] = " " };
        var f = Factory(keys);
        // DeepL is the optional failover: its missing key does not block the cascade.
        Assert.Equal(["Deepgram__ApiKey"], f.MissingKeys(f.Resolve(null)));
        Assert.Equal("none", f.UsableFallback(f.Resolve(null)));
    }

    [Fact]
    public void Unknown_provider_names_are_reported()
    {
        var f = Factory(AllKeys);
        Assert.Equal(["stt:nope", "tts:silent"], f.UnknownProviders(f.Resolve(new ProviderSelection(Stt: "nope", Tts: "silent"))));
    }

    [Fact]
    public void Required_keys_come_from_one_table()
    {
        Assert.Equal(
            CascadeProviderFactory.Keys.Values.Select(k => k.Variable).Order(),
            RequiredKeys.All.Select(k => k.VariableName).Order());
    }

    private sealed record ProviderSetNames(string Stt, string Translation, string Fallback, string Tts);

    private static ProviderSetNames Names(Workbench.Core.Events.ProviderSet s) => new(s.Stt, s.Translation, s.TranslationFallback, s.Tts);
}
