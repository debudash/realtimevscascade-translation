using System.Reflection;

namespace Workbench.Api.Config;

/// <summary>
/// The git commit this server was built from. The .NET SDK stamps it into the assembly's
/// informational version ("1.0.0+&lt;sha&gt;") at build time, so no git call is needed at runtime.
/// Uncommitted changes in the working tree are not detected.
/// </summary>
public static class BuildInfo
{
    public static string Sha { get; } = Read();

    private static string Read()
    {
        var version = typeof(BuildInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        var plus = version?.IndexOf('+') ?? -1;
        if (version is null || plus < 0) return "unknown";
        var sha = version[(plus + 1)..];
        return sha.Length >= 7 ? sha[..7] : "unknown";
    }
}
