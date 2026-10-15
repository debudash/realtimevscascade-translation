using Workbench.Core.Contracts;

namespace Workbench.Core;

/// <summary>
/// Translation controls (register + terminology), applied in both modes: the cascade translators and
/// the Realtime prompt. Overridable per session (URL `?controls=on|off`).
/// </summary>
public sealed class TranslationControlsOptions
{
    public bool Enabled { get; set; } = true;
    public bool Formal { get; set; } = true;
    /// <summary>Per direction ("en-es"): source term -> required target term.</summary>
    public Dictionary<string, Dictionary<string, string>> Glossary { get; set; } = [];

    public TranslationControls For(string source, string target, bool? enabled)
    {
        if (!(enabled ?? Enabled)) return TranslationControls.None;
        var terms = Glossary.TryGetValue($"{source}-{target}", out var g) ? g : new Dictionary<string, string>();
        return new(Formal, terms);
    }
}
