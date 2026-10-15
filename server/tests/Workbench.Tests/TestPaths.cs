namespace Workbench.Tests;

internal static class TestPaths
{
    public static string RepoRoot { get; } = FindRoot();

    public static string EventSamples => Path.Combine(RepoRoot, "contracts", "event-samples.json");

    private static string FindRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "PROGRESS.md"))) return dir.FullName;
        }
        throw new InvalidOperationException("Repo root (PROGRESS.md) not found.");
    }
}
