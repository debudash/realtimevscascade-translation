namespace Workbench.Api.Config;

/// <summary>Provider selection (docs/architecture.md §2). Overridable per session from the UI's run conditions.</summary>
public sealed class ProvidersOptions
{
    public string Stt { get; set; } = "deepgram";
    public string Translation { get; set; } = "openai";
    public string TranslationFallback { get; set; } = "deepl";
    public string Tts { get; set; } = "elevenlabs";
}
