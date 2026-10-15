using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Workbench.Providers.OpenAI;

namespace Workbench.Tests.Api;

public class RealtimeSessionEndpointTests
{
    private const string FakeKey = "sk-test-NOT-A-REAL-KEY-123";

    /// <summary>Captures the outgoing request and returns a canned response.</summary>
    private sealed class StubHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? RequestBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            RequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private static WebApplicationFactory<Program> Factory(StubHandler handler, string? key) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["OpenAI:ApiKey"] = key ?? "" }));
            b.ConfigureServices(s => s.AddHttpClient<RealtimeSessionClient>(RealtimeSessionClient.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => handler));
        });

    private static StringContent Json(object o) => new(JsonSerializer.Serialize(o), Encoding.UTF8, "application/json");

    [Fact]
    public async Task Mints_a_push_to_talk_session_and_never_returns_the_api_key()
    {
        var stub = new StubHandler(HttpStatusCode.OK, """{"value":"ek_abc","expires_at":1792000000,"session":{}}""");
        await using var app = Factory(stub, FakeKey);

        var res = await app.CreateClient().PostAsync("/api/realtime/session", Json(new { pairId = "en-es" }));
        var body = await res.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.DoesNotContain(FakeKey, body);
        var json = JsonNode.Parse(body)!;
        Assert.Equal("ek_abc", json["clientSecret"]!.GetValue<string>());
        Assert.Equal(2, json["directions"]!.AsArray().Count);

        Assert.Equal("https://api.openai.com/v1/realtime/client_secrets", stub.Request!.RequestUri!.ToString());
        Assert.Equal("Bearer", stub.Request.Headers.Authorization!.Scheme);
        var session = JsonNode.Parse(stub.RequestBody!)!["session"]!;
        Assert.Equal("gpt-realtime", session["model"]!.GetValue<string>());
        Assert.Equal("realtime", session["type"]!.GetValue<string>());
        var input = session["audio"]!["input"]!.AsObject();
        Assert.True(input.ContainsKey("turn_detection"));
        Assert.Null(input["turn_detection"]); // push-to-talk: VAD off
        Assert.Equal("en", input["transcription"]!["language"]!.GetValue<string>());
        Assert.Contains("from English to Spanish", session["instructions"]!.GetValue<string>());
    }

    [Fact]
    public async Task Missing_key_is_a_config_error_naming_the_variable()
    {
        await using var app = Factory(new StubHandler(HttpStatusCode.OK, "{}"), key: null);

        var res = await app.CreateClient().PostAsync("/api/realtime/session", Json(new { pairId = "en-es" }));
        var json = JsonNode.Parse(await res.Content.ReadAsStringAsync())!;

        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        Assert.Equal("config_error", json["code"]!.GetValue<string>());
        Assert.Equal("OpenAI__ApiKey", json["missing"]![0]!.GetValue<string>());
    }

    [Fact]
    public async Task Upstream_429_maps_to_rate_limited()
    {
        await using var app = Factory(new StubHandler(HttpStatusCode.TooManyRequests, """{"error":{"message":"slow down"}}"""), FakeKey);

        var res = await app.CreateClient().PostAsync("/api/realtime/session", Json(new { pairId = "en-es" }));
        var json = JsonNode.Parse(await res.Content.ReadAsStringAsync())!;

        Assert.Equal(HttpStatusCode.TooManyRequests, res.StatusCode);
        Assert.Equal("rate_limited", json["code"]!.GetValue<string>());
    }
}
