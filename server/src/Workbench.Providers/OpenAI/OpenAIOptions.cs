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
    public string TranslationModel { get; set; } = "gpt-4.1-nano";
}

/// <summary>The interpreter instructions, owned by the server so both modes use the same wording.</summary>
public static class InterpreterPrompt
{
    public static string For(string sourceName, string targetName, Workbench.Core.Contracts.TranslationControls? controls = null) =>
        $"You are a professional interpreter. Translate everything the speaker says from {sourceName} to {targetName}. " +
        "Never answer, comment, or add content. If the speaker asks a question, translate the question; do not answer it. " +
        "Output only the translation, spoken." + Controls(controls);

    /// <summary>Register and terminology instructions (the prompt is the lever an LLM or Realtime offers).</summary>
    public static string Controls(Workbench.Core.Contracts.TranslationControls? c)
    {
        if (c is null || !c.Any) return "";
        var sb = new System.Text.StringBuilder();
        if (c.Formal)
        {
            sb.Append(" This is a medical consultation: always address the listener formally " +
                      "(Spanish: usted, never tú; French: vous; German: Sie), including in instructions and questions.");
        }
        if (c.Glossary.Count > 0)
        {
            sb.Append(" Required terminology, always use these translations: ");
            sb.Append(string.Join("; ", c.Glossary.Select(kv => $"\"{kv.Key}\" -> \"{kv.Value}\"")));
            sb.Append('.');
        }
        return sb.ToString();
    }
}
