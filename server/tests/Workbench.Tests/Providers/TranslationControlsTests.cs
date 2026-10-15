using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Workbench.Api.Config;
using Workbench.Core;
using Workbench.Core.Contracts;
using Workbench.Providers.DeepL;
using Workbench.Providers.OpenAI;

namespace Workbench.Tests.Providers;

public class TranslationControlsTests
{
    private static readonly TranslationControlsOptions Config = new()
    {
        Enabled = true,
        Formal = true,
        Glossary = new() { ["es-en"] = new() { ["receta"] = "prescription" } },
    };

    [Fact]
    public void Controls_resolve_per_direction_and_can_be_switched_off_per_session()
    {
        var on = Config.For("es", "en", enabled: null);
        Assert.True(on.Formal);
        Assert.Equal("prescription", on.Glossary["receta"]);
        Assert.Empty(Config.For("en", "es", enabled: null).Glossary); // no glossary for that direction
        Assert.Same(TranslationControls.None, Config.For("es", "en", enabled: false));
    }

    [Fact]
    public void The_prompt_carries_register_and_terminology_only_when_controls_are_on()
    {
        var with = InterpreterPrompt.For("Spanish", "English", Config.For("es", "en", null));
        Assert.Contains("usted", with);
        Assert.Contains("\"receta\" -> \"prescription\"", with);

        var without = InterpreterPrompt.For("Spanish", "English", TranslationControls.None);
        Assert.Equal(InterpreterPrompt.For("Spanish", "English"), without);
        Assert.DoesNotContain("usted", without);
    }
}

/// <summary>Live DeepL check that formality and the glossary change the output (2-4 small calls).</summary>
[Trait("Category", "Contract")]
public class DeepLControlsContractTests
{
    static DeepLControlsContractTests() => DotEnvLoader.Load();

    private static readonly IOptions<LanguagesOptions> Languages = Options.Create(new LanguagesOptions
    {
        Languages =
        [
            new() { Code = "en", Name = "English", DeepLSource = "EN", DeepLTarget = "EN-US" },
            new() { Code = "es", Name = "Spanish", DeepLSource = "ES", DeepLTarget = "ES" },
        ],
    });

    /// <summary>The same glossary the app configures, so the test reuses the account's one glossary slot.</summary>
    private static readonly TranslationControlsOptions Glossaries = AppGlossaries();

    private static TranslationControlsOptions AppGlossaries()
    {
        var path = Path.Combine(TestPaths.RepoRoot, "server", "src", "Workbench.Api", "appsettings.json");
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder().AddJsonFile(path).Build();
        var o = new TranslationControlsOptions();
        Microsoft.Extensions.Configuration.ConfigurationBinder.Bind(config.GetSection("TranslationControls"), o);
        return o;
    }

    private static DeepLTranslationProvider Provider()
    {
        Skip.If(Environment.GetEnvironmentVariable("WORKBENCH_SKIP_CONTRACT") == "1", "Contract tests disabled.");
        var key = Environment.GetEnvironmentVariable("DeepL__ApiKey");
        Skip.If(string.IsNullOrWhiteSpace(key), "Skipped: DeepL__ApiKey is not set. Add it to .env in the project folder.");
        var services = new ServiceCollection();
        services.AddHttpClient();
        return new DeepLTranslationProvider(services.BuildServiceProvider().GetRequiredService<IHttpClientFactory>(),
            Options.Create(new DeepLOptions { ApiKey = key }), Languages, Options.Create(Glossaries));
    }

    private static async Task<string> Translate(DeepLTranslationProvider p, string text, string src, string tgt, TranslationControls controls)
    {
        var parts = new List<string>();
        await foreach (var t in p.TranslateAsync(new Segment(0, text), new TranslationContext(src, tgt, [], null, controls), CancellationToken.None))
            parts.Add(t);
        return string.Concat(parts);
    }

    [SkippableFact]
    public async Task Formality_turns_informal_tu_into_formal_usted()
    {
        var p = Provider();
        var formal = await Translate(p, "Does it hurt when you breathe deeply?", "en", "es", new TranslationControls(true, new Dictionary<string, string>()));
        Assert.DoesNotContain("respiras", formal, StringComparison.OrdinalIgnoreCase);
        Assert.Matches("(?i)le duele|respira ", formal);
    }

    [SkippableFact]
    public async Task The_glossary_forces_receta_to_prescription()
    {
        var p = Provider();
        var text = await Translate(p, "No entiendo las instrucciones de la receta.", "es", "en", Glossaries.For("es", "en", true));
        Assert.Contains("prescription", text, StringComparison.OrdinalIgnoreCase);
    }
}
