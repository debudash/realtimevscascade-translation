// OpenAI streamed translation via Chat Completions. Docs (read 2026-10-15):
//   https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
//   https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events
//   (data-only SSE: `data: {chat.completion.chunk}` ... `data: [DONE]`; usage chunk with stream_options.include_usage)
// Model: gpt-4.1-nano by default (fastest first token of the candidates measured 2026-10-15; see PROGRESS.md).
using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Workbench.Core;
using Workbench.Core.Contracts;

namespace Workbench.Providers.OpenAI;

public sealed class OpenAITranslationProvider(IHttpClientFactory http, IOptions<OpenAIOptions> options, IOptions<LanguagesOptions> languages)
    : ITranslationProvider, IWarmable
{
    public string Name => "openai";

    public async IAsyncEnumerable<string> TranslateAsync(Segment segment, TranslationContext ctx, [EnumeratorCancellation] CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) throw new ProviderConfigException(Name, "translation", OpenAIOptions.KeyVariable);

        var body = new JsonObject
        {
            ["model"] = o.TranslationModel,
            ["stream"] = true,
            ["stream_options"] = new JsonObject { ["include_usage"] = true },
            ["temperature"] = 0,
            ["messages"] = new JsonArray(
                new JsonObject { ["role"] = "system", ["content"] = SystemPrompt(ctx) },
                new JsonObject { ["role"] = "user", ["content"] = segment.Text }),
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{o.BaseUrl}/v1/chat/completions") { Content = JsonContent.Create(body) };
        req.Headers.Authorization = new("Bearer", o.ApiKey);
        using var res = await http.CreateClient(RealtimeSessionClient.HttpClientName).SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        await ThrowOnError(res, ct);

        await using var stream = await res.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var data = line.AsSpan(5).TrimStart();
            if (data.SequenceEqual("[DONE]")) yield break;

            using var doc = JsonDocument.Parse(data.ToString());
            var root = doc.RootElement;
            if (root.TryGetProperty("error", out var streamError) && streamError.ValueKind == JsonValueKind.Object)
            {
                var code = streamError.TryGetProperty("code", out var c) ? c.ToString() : "stream_error";
                if (code == "rate_limit_exceeded") throw new RateLimitedException(Name, "translation", "OpenAI rate limit during the stream");
                throw new ProviderErrorException(Name, "translation", $"OpenAI stream error ({code})");
            }
            if (root.TryGetProperty("usage", out var usage) && usage.ValueKind == JsonValueKind.Object)
            {
                ctx.Meter?.AddTokens(usage.GetProperty("prompt_tokens").GetInt32(), usage.GetProperty("completion_tokens").GetInt32());
            }
            if (root.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0
                && choices[0].TryGetProperty("delta", out var delta)
                && delta.TryGetProperty("content", out var content)
                && content.GetString() is { Length: > 0 } text)
            {
                yield return text;
            }
        }
    }

    /// <summary>The interpreter instruction plus the last committed segments as context (not to be re-translated).</summary>
    private string SystemPrompt(TranslationContext ctx)
    {
        var src = Lang(ctx.SourceLang);
        var tgt = Lang(ctx.TargetLang);
        var sb = new StringBuilder(InterpreterPrompt.For(src, tgt, ctx.Controls));
        sb.Append(" The user message is one segment of live speech in a clinic; it may be an incomplete sentence. Translate it as is, in written form.");
        if (ctx.Previous.Count > 0)
        {
            sb.Append("\n\nEarlier in this turn (context only; do not translate again):");
            foreach (var (s, t) in ctx.Previous) sb.Append($"\n- {s} => {t}");
        }
        return sb.ToString();
    }

    private string Lang(string code) => languages.Value.Languages.FirstOrDefault(l => l.Code == code)?.Name ?? code;

    private async Task ThrowOnError(HttpResponseMessage res, CancellationToken ct)
    {
        if (res.IsSuccessStatusCode) return;
        var status = (int)res.StatusCode;
        if (res.StatusCode == HttpStatusCode.TooManyRequests) throw new RateLimitedException(Name, "translation", "OpenAI returned 429");
        // Never pass auth error text through: OpenAI echoes a masked key fragment in it.
        if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new ProviderErrorException(Name, "translation", $"OpenAI rejected the API key ({status})", status);
        string detail;
        try
        {
            detail = JsonNode.Parse(await res.Content.ReadAsStringAsync(ct))?["error"]?["message"]?.GetValue<string>() ?? "";
        }
        catch (JsonException)
        {
            detail = res.ReasonPhrase ?? "";
        }
        throw new ProviderErrorException(Name, "translation", $"OpenAI returned {status}: {detail}", status);
    }

    /// <summary>Warm-up: open a pooled TLS connection to api.openai.com.</summary>
    public async Task WarmUpAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) return;
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{o.BaseUrl}/v1/models/{o.TranslationModel}");
        req.Headers.Authorization = new("Bearer", o.ApiKey);
        using var _ = await http.CreateClient(RealtimeSessionClient.HttpClientName).SendAsync(req, ct);
    }
}
