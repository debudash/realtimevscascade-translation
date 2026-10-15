using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Workbench.Api.Config;
using Workbench.Core;
using Workbench.Core.Contracts;
using Workbench.Providers.DeepL;
using Workbench.Providers.Deepgram;
using Workbench.Providers.ElevenLabs;
using Workbench.Providers.OpenAI;

namespace Workbench.Tests.Providers;

/// <summary>
/// Contract tests against the real provider APIs: one small call each (fractions of a cent).
/// Skipped with a clear message when the key is missing from .env, or when WORKBENCH_SKIP_CONTRACT=1.
/// </summary>
[Trait("Category", "Contract")]
public class ProviderContractTests
{
    static ProviderContractTests() => DotEnvLoader.Load();

    private static string Key(string variable)
    {
        Skip.If(Environment.GetEnvironmentVariable("WORKBENCH_SKIP_CONTRACT") == "1", "Contract tests disabled (WORKBENCH_SKIP_CONTRACT=1).");
        var key = Environment.GetEnvironmentVariable(variable);
        Skip.If(string.IsNullOrWhiteSpace(key), $"Skipped: {variable} is not set. Add it to .env in the project folder.");
        return key!;
    }

    private static readonly IOptions<LanguagesOptions> Languages = Options.Create(new LanguagesOptions
    {
        Languages =
        [
            new() { Code = "en", Name = "English", DeepgramLanguage = "en", DeepLSource = "EN", DeepLTarget = "EN-US" },
            new() { Code = "es", Name = "Spanish", DeepgramLanguage = "es", DeepLSource = "ES", DeepLTarget = "ES" },
        ],
    });

    private static IHttpClientFactory Http()
    {
        var services = new ServiceCollection();
        services.AddHttpClient();
        return services.BuildServiceProvider().GetRequiredService<IHttpClientFactory>();
    }

    private static async Task<string> Collect(IAsyncEnumerable<string> tokens)
    {
        var parts = new List<string>();
        await foreach (var t in tokens) parts.Add(t);
        return string.Concat(parts);
    }

    private static TranslationContext EnToEs(TurnMeter? meter = null) => new("en", "es", [], meter);

    [SkippableFact]
    public async Task OpenAI_streams_a_spanish_translation_and_reports_usage()
    {
        var key = Key("OpenAI__ApiKey");
        var p = new OpenAITranslationProvider(Http(), Options.Create(new OpenAIOptions { ApiKey = key }), Languages);
        var meter = new TurnMeter();

        var text = await Collect(p.TranslateAsync(new Segment(0, "My son has had a fever since last night."), EnToEs(meter), CancellationToken.None));

        Assert.Contains("fiebre", text, StringComparison.OrdinalIgnoreCase);
        Assert.True(meter.Snapshot().TranslationInputTokens > 0);
    }

    [SkippableFact]
    public async Task OpenAI_bad_key_is_a_non_retryable_provider_error()
    {
        Key("OpenAI__ApiKey");
        var p = new OpenAITranslationProvider(Http(), Options.Create(new OpenAIOptions { ApiKey = "sk-invalid-for-test" }), Languages);

        var e = await Assert.ThrowsAsync<ProviderErrorException>(() => Collect(p.TranslateAsync(new Segment(0, "Hello."), EnToEs(), CancellationToken.None)));

        Assert.Equal(401, e.HttpStatus);
        Assert.False(e.Retryable);
        // OpenAI echoes a masked key fragment in its 401 text; none of it may reach errors or logs.
        Assert.DoesNotContain("sk-", e.Message);
        Assert.DoesNotContain("for-test", e.Message);
    }

    [SkippableFact]
    public async Task DeepL_translates_spanish_to_english()
    {
        var key = Key("DeepL__ApiKey");
        var p = new DeepLTranslationProvider(Http(), Options.Create(new DeepLOptions { ApiKey = key }), Languages, Options.Create(new TranslationControlsOptions()));

        var text = await Collect(p.TranslateAsync(new Segment(0, "Tengo una cita a las tres con la doctora."), new TranslationContext("es", "en", []), CancellationToken.None));

        Assert.Contains("appointment", text, StringComparison.OrdinalIgnoreCase);
    }

    [SkippableFact]
    public async Task ElevenLabs_streams_even_length_pcm16_at_24kHz()
    {
        var key = Key("ElevenLabs__ApiKey");
        var p = new ElevenLabsTtsProvider(Http(), Options.Create(new ElevenLabsOptions { ApiKey = key }));

        var bytes = 0;
        var chunks = 0;
        await foreach (var c in p.SynthesizeAsync("Hola.", new VoiceOptions("es"), CancellationToken.None))
        {
            Assert.Equal(24000, c.SampleRate);
            Assert.Equal(0, c.Pcm16.Length % 2);
            bytes += c.Pcm16.Length;
            chunks++;
        }

        Assert.True(bytes > 4800, $"only {bytes} bytes"); // > 100 ms of audio
        Assert.True(chunks >= 1);
    }

    [SkippableFact]
    public async Task Deepgram_transcribes_the_fixture_and_finalizes_on_release()
    {
        var key = Key("Deepgram__ApiKey");
        var p = new DeepgramSttProvider(Options.Create(new DeepgramOptions { ApiKey = key }), Languages, Http());

        // The fixture is 16 kHz mono PCM16 WAV: skip the 44-byte header, send 20 ms frames in real time
        // (as the browser does), with the first 300 ms in a burst (as after press-to-warm connects).
        var pcm = File.ReadAllBytes(Path.Combine(TestPaths.RepoRoot, "e2e", "fixtures", "fixture-en-fever.wav"))[44..];
        var audio = Channel.CreateUnbounded<AudioFrame>();
        var feeder = Task.Run(async () =>
        {
            for (var i = 0; i + 640 <= pcm.Length; i += 640)
            {
                audio.Writer.TryWrite(new AudioFrame(pcm.AsMemory(i, 640)));
                if (i >= 15 * 640) await Task.Delay(20);
            }
            audio.Writer.Complete(); // release
        });

        var results = new List<SttResult>();
        await foreach (var r in p.TranscribeAsync(audio.Reader, new SttOptions("en"), CancellationToken.None)) results.Add(r);
        await feeder;

        var finalText = string.Join(' ', results.Where(r => r.IsFinal).Select(r => r.Text));
        Assert.Contains("fever", finalText, StringComparison.OrdinalIgnoreCase);
    }
}
