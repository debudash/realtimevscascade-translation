namespace Workbench.Api.Config;

/// <summary>
/// Loads the repo-root .env into the process environment before configuration is built.
/// NoClobber: real environment variables take precedence over .env.
/// Values are never logged; only whether a file was found.
/// </summary>
public static class DotEnvLoader
{
    /// <returns>The path of the .env file that was loaded, or null if none was found.</returns>
    public static string? Load(string? startDirectory = null)
    {
        if (Environment.GetEnvironmentVariable("WORKBENCH_SKIP_DOTENV") == "1") return null;

        var path = Find(startDirectory ?? AppContext.BaseDirectory) ?? Find(Directory.GetCurrentDirectory());
        if (path is null) return null;

        DotNetEnv.Env.NoClobber().Load(path);
        return path;
    }

    /// <summary>Walks up from start until it finds a .env file.</summary>
    private static string? Find(string start)
    {
        for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, ".env");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}
