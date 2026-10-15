using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Workbench.Tests.Api;

public class HealthEndpointTests
{
    private static WebApplicationFactory<Program> Factory(Dictionary<string, string?> keys) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(keys)));

    [Fact]
    public async Task Reports_missing_key_names_and_never_values()
    {
        await using var app = Factory(new()
        {
            ["OpenAI:ApiKey"] = "sk-test-not-real-value",
            ["Deepgram:ApiKey"] = "",
            ["ElevenLabs:ApiKey"] = "el-test-not-real-value",
            ["DeepL:ApiKey"] = " ",
        });

        var body = await app.CreateClient().GetStringAsync("/api/health");
        var json = JsonDocument.Parse(body).RootElement;

        Assert.False(json.GetProperty("configOk").GetBoolean());
        var missing = json.GetProperty("missing").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Equal(["Deepgram__ApiKey", "DeepL__ApiKey"], missing);
        Assert.DoesNotContain("not-real-value", body);
    }

    [Fact]
    public async Task Config_ok_when_all_keys_present()
    {
        await using var app = Factory(new()
        {
            ["OpenAI:ApiKey"] = "a", ["Deepgram:ApiKey"] = "b", ["ElevenLabs:ApiKey"] = "c", ["DeepL:ApiKey"] = "d",
        });

        var json = await app.CreateClient().GetFromJsonAsync<JsonElement>("/api/health");

        Assert.True(json.GetProperty("configOk").GetBoolean());
        Assert.Empty(json.GetProperty("missing").EnumerateArray());
    }

    [Fact]
    public async Task Config_lists_the_default_english_spanish_pair()
    {
        await using var app = Factory([]);

        var json = await app.CreateClient().GetFromJsonAsync<JsonElement>("/api/config");

        Assert.Equal("en-es", json.GetProperty("defaultPair").GetString());
        Assert.Contains(json.GetProperty("pairs").EnumerateArray(), p => p.GetProperty("id").GetString() == "en-es");
    }
}
