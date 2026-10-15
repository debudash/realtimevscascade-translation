using System.Text.Json;
using Workbench.Api.Config;

namespace Workbench.Api.Endpoints;

/// <summary>Serves the cached evaluation clips (harness/clips) to the in-app Replay input.</summary>
public static class ClipEndpoints
{
    public static void MapClipEndpoints(this WebApplication app)
    {
        app.MapGet("/api/clips", () =>
        {
            var scripts = LoadScripts();
            if (!Directory.Exists(RepoPaths.Clips)) return Results.Ok(Array.Empty<object>());

            var clips = Directory.EnumerateFiles(RepoPaths.Clips, "*.wav")
                .Select(Path.GetFileNameWithoutExtension)
                .OfType<string>()
                .Order(StringComparer.Ordinal)
                .Select(id => scripts.TryGetValue(id, out var s)
                    ? new ClipInfo(id, s.Lang, s.Text)
                    : new ClipInfo(id, id.Split('-')[0], id));
            return Results.Ok(clips);
        });

        app.MapGet("/api/clips/{id}.wav", (string id) =>
        {
            // Ids are file stems; reject anything that could escape the folder.
            if (id.Any(c => !(char.IsLetterOrDigit(c) || c is '-' or '_'))) return Results.BadRequest();
            var path = Path.Combine(RepoPaths.Clips, id + ".wav");
            return File.Exists(path) ? Results.File(path, "audio/wav") : Results.NotFound();
        });
    }

    private sealed record ClipInfo(string Id, string Lang, string Text);

    private sealed record ScriptEntry(string Id, string Lang, string Text);

    private static Dictionary<string, ScriptEntry> LoadScripts()
    {
        var path = Path.Combine(RepoPaths.Root, "harness", "scripts.json");
        if (!File.Exists(path)) return [];
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var result = new Dictionary<string, ScriptEntry>();
        if (!doc.RootElement.TryGetProperty("clips", out var clips)) return result;
        foreach (var c in clips.EnumerateArray())
        {
            var id = c.GetProperty("id").GetString()!;
            result[id] = new ScriptEntry(id, c.GetProperty("lang").GetString()!, c.GetProperty("text").GetString()!);
        }
        return result;
    }
}
