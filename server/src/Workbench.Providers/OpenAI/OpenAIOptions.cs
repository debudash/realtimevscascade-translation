namespace Workbench.Providers.OpenAI;

public sealed class OpenAIOptions
{
    public const string KeyVariable = "OpenAI__ApiKey";

    public string? ApiKey { get; set; }
    public string BaseUrl { get; set; } = "https://api.openai.com";

    // Realtime mode (locked: gpt-realtime).
    public string RealtimeModel { get; set; } = "gpt-realtime";
    public string RealtimeVoice { get; set; } = "marin";
    public string RealtimeTranscriptionModel { get; set; } = "gpt-4o-transcribe";
    public int ClientSecretTtlSeconds { get; set; } = 600;

    // Cascade translation (streamed Chat Completions).
    public string TranslationModel { get; set; } = "gpt-4.1-mini";
}

/// <summary>The interpreter instructions, owned by the server so both modes use the same wording.</summary>
public static class InterpreterPrompt
{
    public static string For(string sourceName, string targetName) =>
        $"You are a professional interpreter. Translate everything the speaker says from {sourceName} to {targetName}. " +
        "Never answer, comment, or add content. If the speaker asks a question, translate the question; do not answer it. " +
        "Output only the translation, spoken.";
}
