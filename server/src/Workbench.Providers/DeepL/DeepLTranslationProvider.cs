// DeepL text translation (secondary adapter and 429 failover target). Docs (read 2026-10-15):
//   https://developers.deepl.com/api-reference/translate/request-translation  (POST /v2/translate, JSON)
//   https://developers.deepl.com/docs/getting-started/auth                    (DeepL-Auth-Key; ":fx" keys -> api-free.deepl.com)
//   https://developers.deepl.com/docs/getting-started/supported-languages     (EN, ES; targets EN-US, ES)
//   https://developers.deepl.com/docs/best-practices/error-handling          (429 retry with backoff; 456 quota, do not retry)
// DeepL has no text streaming: the whole segment translation arrives as one "token".
using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Workbench.Core;
using Workbench.Core.Contracts;

namespace Workbench.Providers.DeepL;

public sealed class DeepLOptions
{
    public const string KeyVariable = "DeepL__ApiKey";
    public string? ApiKey { get; set; }
    /// <summary>Optional override; by default derived from the key (":fx" = Free).</summary>
    public string? BaseUrl { get; set; }
    /// <summary>latency_optimized | quality_optimized | prefer_quality_optimized, or empty to omit.</summary>
    public string? ModelType { get; set; } = "latency_optimized";

    public string ResolveBaseUrl() =>
        BaseUrl ?? (ApiKey?.EndsWith(":fx", StringComparison.Ordinal) == true ? "https://api-free.deepl.com" : "https://api.deepl.com");
}

public sealed class DeepLTranslationProvider(IHttpClientFactory http, IOptions<DeepLOptions> options, IOptions<LanguagesOptions> languages)
    : ITranslationProvider, IWarmable
{
    public const string HttpClientName = "deepl";
    public string Name => "deepl";

    public async IAsyncEnumerable<string> TranslateAsync(Segment segment, TranslationContext ctx, [EnumeratorCancellation] CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) throw new ProviderConfigException(Name, "translation", DeepLOptions.KeyVariable);
        var src = languages.Value.Get(ctx.SourceLang);
        var tgt = languages.Value.Get(ctx.TargetLang);

        var body = new JsonObject
        {
            ["text"] = new JsonArray(segment.Text),
            ["source_lang"] = src.DeepLSource,
            ["target_lang"] = tgt.DeepLTarget,
        };
        // Context influences the translation but is not translated (or billed).
        if (ctx.Previous.Count > 0) body["context"] = string.Join(" ", ctx.Previous.Select(p => p.Source));
        if (!string.IsNullOrEmpty(o.ModelType)) body["model_type"] = o.ModelType;

        var text = await PostAsync(body, o, ct);
        if (text.Length > 0) yield return text;
    }

    private async Task<string> PostAsync(JsonObject body, DeepLOptions o, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{o.ResolveBaseUrl()}/v2/translate") { Content = JsonContent.Create(body) };
        req.Headers.Authorization = new("DeepL-Auth-Key", o.ApiKey);
        using var res = await http.CreateClient(HttpClientName).SendAsync(req, ct);

        var status = (int)res.StatusCode;
        if (res.StatusCode == HttpStatusCode.TooManyRequests) throw new RateLimitedException(Name, "translation", "DeepL returned 429");
        if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new ProviderErrorException(Name, "translation", $"DeepL rejected the API key ({status})", status);
        if (!res.IsSuccessStatusCode)
        {
            var detail = await res.Content.ReadAsStringAsync(ct);
            var message = TryMessage(detail);
            // Some plans reject model_type; retry once without it rather than failing the turn.
            if (status == 400 && body.ContainsKey("model_type") && message.Contains("model_type", StringComparison.OrdinalIgnoreCase))
            {
                body.Remove("model_type");
                return await PostAsync(body, new DeepLOptions { ApiKey = o.ApiKey, BaseUrl = o.BaseUrl, ModelType = null }, ct);
            }
            // 456 = quota exhausted: not retryable.
            throw new ProviderErrorException(Name, "translation", $"DeepL returned {status}: {message}", status);
        }

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.GetProperty("translations")[0].GetProperty("text").GetString()?.Trim() ?? "";
    }

    private static string TryMessage(string body)
    {
        try
        {
            return JsonNode.Parse(body)?["message"]?.GetValue<string>() ?? body;
        }
        catch (JsonException)
        {
            return body.Length > 200 ? body[..200] : body;
        }
    }

    /// <summary>Warm-up: open a pooled TLS connection (GET /v2/usage is free).</summary>
    public async Task WarmUpAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) return;
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{o.ResolveBaseUrl()}/v2/usage");
        req.Headers.Authorization = new("DeepL-Auth-Key", o.ApiKey);
        using var _ = await http.CreateClient(HttpClientName).SendAsync(req, ct);
    }
}
