// OpenAI Realtime (GA) client-secret minting for browser WebRTC. Docs (read 2026-10-15):
//   https://developers.openai.com/api/docs/guides/realtime-webrtc
//   https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
//   https://developers.openai.com/api/docs/guides/realtime-conversations   (push-to-talk with turn_detection: null)
//   https://developers.openai.com/api/docs/guides/realtime-transcription
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Workbench.Core;

namespace Workbench.Providers.OpenAI;

public sealed record RealtimeDirection(string Source, string Target, string Instructions, string TranscriptionLanguage);

public sealed record RealtimeSession(string ClientSecret, long ExpiresAt, string Model, string Voice, string TranscriptionModel, IReadOnlyList<RealtimeDirection> Directions);

/// <summary>
/// Mints a short-lived client secret. The browser uses it to open WebRTC directly to OpenAI;
/// the API key never leaves the server.
/// </summary>
public sealed class RealtimeSessionClient(HttpClient http, IOptions<OpenAIOptions> options)
{
    public const string HttpClientName = "openai";
    private const string Provider = "openai-realtime";

    public async Task<RealtimeSession> CreateAsync(IReadOnlyList<RealtimeDirection> directions, CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) throw new ProviderConfigException(Provider, "session", OpenAIOptions.KeyVariable);
        var first = directions[0];

        var body = new JsonObject
        {
            ["expires_after"] = new JsonObject { ["anchor"] = "created_at", ["seconds"] = o.ClientSecretTtlSeconds },
            ["session"] = new JsonObject
            {
                ["type"] = "realtime",
                ["model"] = o.RealtimeModel,
                ["instructions"] = first.Instructions,
                ["output_modalities"] = new JsonArray("audio"),
                ["audio"] = new JsonObject
                {
                    ["input"] = new JsonObject
                    {
                        // Push-to-talk: no server VAD; the client commits and requests a response on release.
                        ["turn_detection"] = null,
                        // Side transcription process (not what the model "heard"); used for the source column.
                        ["transcription"] = new JsonObject { ["model"] = o.RealtimeTranscriptionModel, ["language"] = first.TranscriptionLanguage },
                    },
                    ["output"] = new JsonObject { ["voice"] = o.RealtimeVoice },
                },
            },
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{o.BaseUrl}/v1/realtime/client_secrets")
        {
            Content = JsonContent.Create(body),
        };
        req.Headers.Authorization = new("Bearer", o.ApiKey);

        using var res = await http.SendAsync(req, ct);
        if (res.StatusCode == HttpStatusCode.TooManyRequests)
            throw new RateLimitedException(Provider, "session", "OpenAI returned 429 while minting the client secret");
        if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        {
            // Never pass auth error text through: OpenAI echoes a masked key fragment in it.
            throw new ProviderErrorException(Provider, "session", $"OpenAI rejected the API key ({(int)res.StatusCode})", (int)res.StatusCode);
        }
        if (!res.IsSuccessStatusCode)
        {
            var detail = await SafeErrorMessage(res, ct);
            throw new ProviderErrorException(Provider, "session", $"OpenAI returned {(int)res.StatusCode}: {detail}", (int)res.StatusCode);
        }

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        var root = doc.RootElement;
        var secret = root.GetProperty("value").GetString()
            ?? throw new ProviderErrorException(Provider, "session", "Client secret missing from response");
        var expires = root.TryGetProperty("expires_at", out var e) ? e.GetInt64() : 0;
        return new RealtimeSession(secret, expires, o.RealtimeModel, o.RealtimeVoice, o.RealtimeTranscriptionModel, directions);
    }

    /// <summary>OpenAI's error.message only; never echoes request headers.</summary>
    private static async Task<string> SafeErrorMessage(HttpResponseMessage res, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            return doc.RootElement.GetProperty("error").GetProperty("message").GetString() ?? "unknown error";
        }
        catch
        {
            return res.ReasonPhrase ?? "unknown error";
        }
    }
}
