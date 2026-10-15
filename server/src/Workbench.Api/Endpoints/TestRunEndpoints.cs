using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Workbench.Api.Config;

namespace Workbench.Api.Endpoints;

/// <summary>
/// Test Runs from the UI's Test Runs tab: one JSON file per run in harness/results/test-runs/
/// (config "TestRuns:Directory"), the same shape the harness keeps, so runs survive restarts
/// and can feed the evaluation report. The body is stored as sent, plus id and createdAt.
/// </summary>
public static partial class TestRunEndpoints
{
    private const long MaxBodyBytes = 10 * 1024 * 1024;
    private static readonly string[] Modes = ["realtime", "cascade"];
    private static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true };

    [GeneratedRegex("^[a-z0-9-]{1,80}$")]
    private static partial Regex IdPattern();

    public static void MapTestRunEndpoints(this WebApplication app)
    {
        string Dir() => app.Configuration["TestRuns:Directory"] is { Length: > 0 } d ? d : Path.Combine(RepoPaths.Root, "harness", "results", "test-runs");

        // Summaries only (no turns), newest first.
        app.MapGet("/api/test-runs", () =>
        {
            var dir = Dir();
            if (!Directory.Exists(dir)) return Results.Ok(Array.Empty<object>());
            var runs = Directory.EnumerateFiles(dir, "*.json")
                .Select(f => { try { return JsonNode.Parse(File.ReadAllText(f)) as JsonObject; } catch (JsonException) { return null; } })
                .OfType<JsonObject>()
                .Select(r => { r.Remove("turns"); return r; })
                .OrderByDescending(r => r["createdAt"]?.GetValue<string>() ?? "", StringComparer.Ordinal)
                .ToList();
            return Results.Ok(runs);
        });

        app.MapGet("/api/test-runs/{id}", (string id) =>
        {
            var path = Path.Combine(Dir(), id + ".json");
            if (!IdPattern().IsMatch(id) || !File.Exists(path)) return Results.NotFound();
            return Results.Text(File.ReadAllText(path), "application/json");
        });

        app.MapPost("/api/test-runs", async (HttpRequest req) =>
        {
            if (req.ContentLength > MaxBodyBytes) return Results.BadRequest(new { error = "A test run must be under 10 MB." });
            JsonObject? run;
            try { run = await JsonNode.ParseAsync(req.Body) as JsonObject; }
            catch (JsonException) { return Results.BadRequest(new { error = "The body is not valid JSON." }); }
            if (run is null) return Results.BadRequest(new { error = "The body must be a JSON object." });

            var name = (run["name"] as JsonValue)?.TryGetValue<string>(out var n) == true ? n.Trim() : "";
            if (name.Length is 0 or > 200) return Results.BadRequest(new { error = "Give the test run a name (up to 200 characters)." });
            var mode = (run["setup"]?["mode"] as JsonValue)?.TryGetValue<string>(out var m) == true ? m : null;
            if (mode is null || !Modes.Contains(mode)) return Results.BadRequest(new { error = "setup.mode must be realtime or cascade." });
            if (run["turns"] is not JsonArray) return Results.BadRequest(new { error = "turns must be an array." });

            var created = DateTimeOffset.UtcNow;
            var id = $"{created:yyyyMMdd-HHmmssfff}-{Slug(name)}";
            run["id"] = id;
            run["name"] = name;
            run["createdAt"] = created.ToString("O");

            var dir = Dir();
            Directory.CreateDirectory(dir);
            var tmp = Path.Combine(dir, id + ".json.tmp");
            await File.WriteAllTextAsync(tmp, run.ToJsonString(Pretty));
            File.Move(tmp, Path.Combine(dir, id + ".json"), overwrite: false);
            return Results.Created($"/api/test-runs/{id}", new { id });
        });
    }

    /// <summary>Lowercase letters and digits from the name, joined by hyphens, at most 40 characters.</summary>
    private static string Slug(string name)
    {
        var slug = Regex.Replace(name.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        if (slug.Length > 40) slug = slug[..40].TrimEnd('-');
        return slug.Length > 0 ? slug : "run";
    }
}
