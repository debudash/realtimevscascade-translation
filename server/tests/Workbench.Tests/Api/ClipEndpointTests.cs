using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Workbench.Tests.Api;

public class ClipEndpointTests
{
    [Fact]
    public async Task Clips_carry_their_target_language_reference_translation_and_duration()
    {
        // Test Runs estimate cost from clip durations and score target WER against the reference.
        await using var app = new WebApplicationFactory<Program>();
        var clips = await app.CreateClient().GetFromJsonAsync<JsonElement>("/api/clips");
        var en01 = clips.EnumerateArray().Single(c => c.GetProperty("id").GetString() == "en-01");

        Assert.Equal("en", en01.GetProperty("lang").GetString());
        Assert.Equal("es", en01.GetProperty("target").GetString());
        Assert.Equal("My son has had a fever since last night.", en01.GetProperty("text").GetString());
        Assert.Equal("Mi hijo tiene fiebre desde anoche.", en01.GetProperty("reference").GetString());
        // harness/clips/en-01.wav: 16 kHz mono PCM16, about 2.5 s after trimming.
        Assert.InRange(en01.GetProperty("durationSeconds").GetDouble(), 2.0, 3.0);
    }
}
