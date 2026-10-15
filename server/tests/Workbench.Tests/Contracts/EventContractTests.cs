using System.Text.Json;
using System.Text.Json.Nodes;
using Workbench.Core.Events;

namespace Workbench.Tests.Contracts;

/// <summary>
/// Round-trips contracts/event-samples.json through the C# records. The client's
/// vitest suite round-trips the same file through the TS types.
/// </summary>
public class EventContractTests
{
    public static TheoryData<string> Samples()
    {
        var data = new TheoryData<string>();
        foreach (var node in JsonNode.Parse(File.ReadAllText(TestPaths.EventSamples))!.AsArray())
            data.Add(node!.ToJsonString());
        return data;
    }

    [Theory]
    [MemberData(nameof(Samples))]
    public void Sample_round_trips_without_loss(string sampleJson)
    {
        var evt = EventJson.Deserialize(sampleJson);

        Assert.NotNull(evt);
        var back = JsonNode.Parse(EventJson.Serialize(evt!));
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(sampleJson), back),
            $"Round trip changed the event.\nIn:  {sampleJson}\nOut: {back!.ToJsonString()}");
    }

    [Fact]
    public void Every_event_type_has_a_sample()
    {
        var sampleTypes = JsonNode.Parse(File.ReadAllText(TestPaths.EventSamples))!.AsArray()
            .Select(n => n!["type"]!.GetValue<string>())
            .ToHashSet();

        var declared = typeof(WorkbenchEvent)
            .GetCustomAttributes(typeof(System.Text.Json.Serialization.JsonDerivedTypeAttribute), false)
            .Cast<System.Text.Json.Serialization.JsonDerivedTypeAttribute>()
            .Select(a => (string)a.TypeDiscriminator!);

        Assert.All(declared, t => Assert.Contains(t, sampleTypes));
    }

    [Fact]
    public void Serialized_events_use_camelCase_and_the_type_discriminator_first()
    {
        var json = EventJson.Serialize(new StageTimingEvent("tts_first_byte", 120, 1, "elevenlabs") { TurnId = "x", T = 5 });

        using var doc = JsonDocument.Parse(json);
        Assert.Equal("type", doc.RootElement.EnumerateObject().First().Name);
        Assert.Equal("stage.timing", doc.RootElement.GetProperty("type").GetString());
        Assert.Equal(120, doc.RootElement.GetProperty("durationMs").GetDouble());
    }
}
