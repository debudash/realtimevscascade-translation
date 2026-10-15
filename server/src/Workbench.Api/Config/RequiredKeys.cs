namespace Workbench.Api.Config;

/// <summary>The four provider keys, as configuration paths and as the variable names users set in .env.</summary>
public static class RequiredKeys
{
    public static readonly IReadOnlyList<(string ConfigPath, string VariableName)> All =
    [
        ("OpenAI:ApiKey", "OpenAI__ApiKey"),
        ("Deepgram:ApiKey", "Deepgram__ApiKey"),
        ("ElevenLabs:ApiKey", "ElevenLabs__ApiKey"),
        ("DeepL:ApiKey", "DeepL__ApiKey"),
    ];

    /// <summary>Names (never values) of the keys that are missing or blank.</summary>
    public static IReadOnlyList<string> Missing(IConfiguration config) =>
        All.Where(k => string.IsNullOrWhiteSpace(config[k.ConfigPath]))
           .Select(k => k.VariableName)
           .ToList();
}
