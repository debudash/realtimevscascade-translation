namespace Workbench.Api.Config;

/// <summary>Finds the repo root (the folder holding PROGRESS.md) so the API can serve harness clips.</summary>
public static class RepoPaths
{
    public static string Root { get; } = FindRoot();

    public static string Clips => Path.Combine(Root, "harness", "clips");

    private static string FindRoot()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                if (File.Exists(Path.Combine(dir.FullName, "PROGRESS.md"))) return dir.FullName;
            }
        }
        return Directory.GetCurrentDirectory();
    }
}
