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
            var clips = RepoPaths.ClipDirs
                .Where(Directory.Exists)
                .SelectMany(d => Directory.EnumerateFiles(d, "*.wav"))
                .Select(Path.GetFileNameWithoutExtension)
                .OfType<string>()
                .Order(StringComparer.Ordinal)
                .Select(id => scripts.TryGetValue(id, out var s)
                    ? new ClipInfo(id, s.Lang, s.Text, s.Target, s.Reference, Duration(id))
                    : new ClipInfo(id, id.Split('-').FirstOrDefault(p => p.Length == 2) ?? "en", id, null, null, Duration(id)));
            return Results.Ok(clips);
        });

        app.MapGet("/api/clips/{id}.wav", (string id) =>
        {
            // Ids are file stems; reject anything that could escape the folder.
            if (id.Any(c => !(char.IsLetterOrDigit(c) || c is '-' or '_'))) return Results.BadRequest();
            var path = RepoPaths.ClipDirs.Select(d => Path.Combine(d, id + ".wav")).FirstOrDefault(File.Exists);
            return path is not null ? Results.File(path, "audio/wav") : Results.NotFound();
        });
    }

    /// <summary>Target and Reference come from harness/scripts.json; DurationSeconds from the WAV header (Test Run estimates).</summary>
    private sealed record ClipInfo(string Id, string Lang, string Text, string? Target, string? Reference, double? DurationSeconds);

    private sealed record ScriptEntry(string Id, string Lang, string Text, string? Target, string? Reference);

    /// <summary>Seconds of audio: the "data" chunk size over the "fmt " byte rate. Null if the file is not a PCM WAV.</summary>
    private static double? Duration(string id)
    {
        var path = RepoPaths.ClipDirs.Select(d => Path.Combine(d, id + ".wav")).FirstOrDefault(File.Exists);
        if (path is null) return null;
        try
        {
            using var r = new BinaryReader(File.OpenRead(path));
            if (new string(r.ReadChars(4)) != "RIFF") return null;
            r.ReadInt32();
            if (new string(r.ReadChars(4)) != "WAVE") return null;
            int byteRate = 0;
            while (r.BaseStream.Position + 8 <= r.BaseStream.Length)
            {
                var chunk = new string(r.ReadChars(4));
                var size = r.ReadInt32();
                if (chunk == "fmt ")
                {
                    r.ReadBytes(8);
                    byteRate = r.ReadInt32();
                    r.ReadBytes(size - 12);
                }
                else if (chunk == "data")
                {
                    return byteRate > 0 ? Math.Round((double)size / byteRate, 2) : null;
                }
                else r.BaseStream.Seek(size + (size & 1), SeekOrigin.Current);
            }
        }
        catch (IOException) { } // includes EndOfStreamException (truncated file)
        return null;
    }

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
            string? Opt(string name) => c.TryGetProperty(name, out var v) ? v.GetString() : null;
            result[id] = new ScriptEntry(id, c.GetProperty("lang").GetString()!, c.GetProperty("text").GetString()!, Opt("target"), Opt("reference"));
        }
        return result;
    }
}
