// DeepL text translation (secondary adapter and 429 failover target). Docs (read 2026-10-15):
//   https://developers.deepl.com/api-reference/translate/request-translation  (POST /v2/translate, JSON)
//   https://developers.deepl.com/docs/getting-started/auth                    (DeepL-Auth-Key; ":fx" keys -> api-free.deepl.com)
//   https://developers.deepl.com/docs/getting-started/supported-languages     (EN, ES; targets EN-US, ES)
//   https://developers.deepl.com/docs/best-practices/error-handling          (429 retry with backoff; 456 quota, do not retry)
//   https://developers.deepl.com/api-reference/multilingual-glossaries       (POST /v3/glossaries: name, dictionaries[{source_lang, target_lang, entries, entries_format}])
//   Verified live 2026-10-15: GET/DELETE /v3/glossaries[/{id}] work; the Free plan allows ONE glossary (456 "Too many
//   glossaries"); matching is literal, so noun phrases ("la receta") need their own entries.
//   formality: prefer_more = formal where the target supports it, otherwise default (no error); glossary_id needs source_lang.
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

public sealed class DeepLTranslationProvider(
    IHttpClientFactory http,
    IOptions<DeepLOptions> options,
    IOptions<LanguagesOptions> languages,
    IOptions<TranslationControlsOptions> controls)
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
        if (ctx.Controls is { Formal: true }) body["formality"] = "prefer_more";
        if (ctx.Controls is { Glossary.Count: > 0 })
        {
            // The glossary holds this direction's dictionary; DeepL applies the matching one.
            var id = await GlossaryIdAsync(o, ct);
            if (id is not null) body["glossary_id"] = id;
        }

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

    private readonly SemaphoreSlim _glossaryLock = new(1, 1);
    private string? _glossaryName;
    private string? _glossaryId;

    /// <summary>
    /// One DeepL multilingual (v3) glossary holding a dictionary per configured direction. The Free plan
    /// allows a single glossary, so the name embeds a hash of all entries and stale workbench-* glossaries
    /// are deleted before a new one is created. Best effort: on failure the turn goes ahead without one.
    /// </summary>
    private async Task<string?> GlossaryIdAsync(DeepLOptions o, CancellationToken ct)
    {
        var dicts = controls.Value.Glossary
            .Where(d => d.Value.Count > 0)
            .OrderBy(d => d.Key, StringComparer.Ordinal)
            .Select(d => (Src: d.Key.Split('-')[0], Tgt: d.Key.Split('-')[1], Tsv: string.Join("\n", d.Value.Select(kv => $"{kv.Key}\t{kv.Value}"))))
            .ToList();
        if (dicts.Count == 0) return null;
        var all = string.Join("|", dicts.Select(d => $"{d.Src}>{d.Tgt}:{d.Tsv}"));
        var name = "workbench-" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(all)))[..8].ToLowerInvariant();

        if (_glossaryName == name) return _glossaryId;
        await _glossaryLock.WaitAsync(ct);
        try
        {
            if (_glossaryName == name) return _glossaryId;
            _glossaryId = await FindOrCreateGlossaryAsync(name, dicts, o);
            if (_glossaryId is not null) _glossaryName = name;
            return _glossaryId;
        }
        finally
        {
            _glossaryLock.Release();
        }
    }

    private async Task<string?> FindOrCreateGlossaryAsync(string name, List<(string Src, string Tgt, string Tsv)> dicts, DeepLOptions o)
    {
        try
        {
            var client = http.CreateClient(HttpClientName);
            HttpRequestMessage Req(HttpMethod m, string path, object? body = null)
            {
                var r = new HttpRequestMessage(m, $"{o.ResolveBaseUrl()}{path}");
                r.Headers.Authorization = new("DeepL-Auth-Key", o.ApiKey);
                if (body is not null) r.Content = JsonContent.Create(body);
                return r;
            }

            using (var res = await client.SendAsync(Req(HttpMethod.Get, "/v3/glossaries")))
            {
                res.EnsureSuccessStatusCode();
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                foreach (var g in doc.RootElement.GetProperty("glossaries").EnumerateArray())
                {
                    var gName = g.GetProperty("name").GetString() ?? "";
                    var gId = g.GetProperty("glossary_id").GetString();
                    if (gName == name) return gId;
                    // Only ever delete our own stale glossaries (the Free plan has room for one).
                    if (gName.StartsWith("workbench-", StringComparison.Ordinal))
                        using (await client.SendAsync(Req(HttpMethod.Delete, $"/v3/glossaries/{gId}"))) { }
                }
            }

            var body = new
            {
                name,
                dictionaries = dicts.Select(d => new { source_lang = d.Src, target_lang = d.Tgt, entries = d.Tsv, entries_format = "tsv" }),
            };
            using var created = await client.SendAsync(Req(HttpMethod.Post, "/v3/glossaries", body));
            if (!created.IsSuccessStatusCode) return null;
            using var cdoc = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
            return cdoc.RootElement.GetProperty("glossary_id").GetString();
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or KeyNotFoundException or TaskCanceledException)
        {
            return null;
        }
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
