namespace Workbench.Core;

/// <summary>A language the workbench can interpret. Onboarding a pair is a config change here.</summary>
public sealed class LanguageOptions
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string NativeName { get; set; } = "";
    /// <summary>Label under the talk button, in the speaker's own language.</summary>
    public string SpeakerLabel { get; set; } = "";
    public string DeepgramLanguage { get; set; } = "";
    public string DeepLSource { get; set; } = "";
    public string DeepLTarget { get; set; } = "";
    public string? ElevenLabsVoiceId { get; set; }
}

public sealed class PairOptions
{
    public string Id { get; set; } = "";
    public string A { get; set; } = "";
    public string B { get; set; } = "";
    public string Label { get; set; } = "";
}

public sealed class LanguagesOptions
{
    public List<LanguageOptions> Languages { get; set; } = [];
    public List<PairOptions> Pairs { get; set; } = [];
    public string DefaultPair { get; set; } = "en-es";

    public LanguageOptions Get(string code) =>
        Languages.FirstOrDefault(l => l.Code == code)
        ?? throw new ArgumentException($"Unknown language '{code}'.");
}
