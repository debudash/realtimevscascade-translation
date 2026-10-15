using Workbench.Api.Control;

namespace Workbench.Api.Config;

/// <summary>The provider keys, as configuration paths and as the variable names users set in .env.</summary>
public static class RequiredKeys
{
    /// <summary>Single source: the provider factory's key table.</summary>
    public static IReadOnlyList<(string ConfigPath, string VariableName)> All =>
        CascadeProviderFactory.Keys.Values.Select(k => (k.ConfigPath, k.Variable)).ToList();

    /// <summary>Names (never values) of the keys that are missing or blank.</summary>
    public static IReadOnlyList<string> Missing(IConfiguration config) =>
        All.Where(k => string.IsNullOrWhiteSpace(config[k.ConfigPath]))
           .Select(k => k.VariableName)
           .ToList();
}
