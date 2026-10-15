using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Workbench.Tests.Api;

/// <summary>Test Runs are saved by the backend as one JSON file each, so they survive restarts and can feed the report.</summary>
public sealed class TestRunEndpointTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "workbench-test-runs-" + Guid.NewGuid().ToString("N"));

    private WebApplicationFactory<Program> Factory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["TestRuns:Directory"] = _dir })));

    private static JsonObject Run(string name, string mode = "cascade") => new()
    {
        ["name"] = name,
        ["setup"] = new JsonObject { ["mode"] = mode, ["strategy"] = "segment", ["controls"] = false },
        ["clips"] = new JsonArray("en-01", "es-01"),
        ["passes"] = 1,
        ["summary"] = new JsonObject { ["turns"] = 2, ["p50Ms"] = 1200 },
        ["turns"] = new JsonArray(new JsonObject { ["turnId"] = "t1" }, new JsonObject { ["turnId"] = "t2" }),
    };

    [Fact]
    public async Task A_saved_run_is_written_to_disk_and_comes_back_whole()
    {
        await using var app = Factory();
        var http = app.CreateClient();
        var res = await http.PostAsJsonAsync("/api/test-runs", Run("Cascade baseline"));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

        Assert.True(File.Exists(Path.Combine(_dir, id + ".json")));
        var run = await http.GetFromJsonAsync<JsonElement>($"/api/test-runs/{id}");
        Assert.Equal("Cascade baseline", run.GetProperty("name").GetString());
        Assert.Equal(id, run.GetProperty("id").GetString());
        Assert.True(run.TryGetProperty("createdAt", out _));
        Assert.Equal(2, run.GetProperty("turns").GetArrayLength());
    }

    [Fact]
    public async Task The_list_is_newest_first_and_leaves_out_the_turns()
    {
        await using var app = Factory();
        var http = app.CreateClient();
        await http.PostAsJsonAsync("/api/test-runs", Run("First"));
        await Task.Delay(20);
        await http.PostAsJsonAsync("/api/test-runs", Run("Second", "realtime"));

        var list = await http.GetFromJsonAsync<JsonElement>("/api/test-runs");
        Assert.Equal(["Second", "First"], list.EnumerateArray().Select(r => r.GetProperty("name").GetString()).ToArray());
        Assert.All(list.EnumerateArray(), r => Assert.False(r.TryGetProperty("turns", out _)));
        Assert.Equal("realtime", list[0].GetProperty("setup").GetProperty("mode").GetString());
    }

    [Theory]
    [InlineData("", "cascade")]
    [InlineData("No mode", "hybrid")]
    public async Task A_run_without_a_name_or_with_an_unknown_mode_is_rejected(string name, string mode)
    {
        await using var app = Factory();
        var res = await app.CreateClient().PostAsJsonAsync("/api/test-runs", Run(name, mode));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.False(Directory.Exists(_dir) && Directory.EnumerateFiles(_dir).Any());
    }

    [Theory]
    [InlineData("does-not-exist")]
    [InlineData("..%2F..%2FPROGRESS")]
    [InlineData("UPPER")]
    public async Task Unknown_or_malformed_ids_are_not_found(string id)
    {
        await using var app = Factory();
        var res = await app.CreateClient().GetAsync($"/api/test-runs/{id}");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }
}
