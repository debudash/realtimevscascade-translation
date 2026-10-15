// ElevenLabs streaming TTS over HTTP. Docs (read 2026-10-15):
//   https://elevenlabs.io/docs/api-reference/text-to-speech/stream   (POST /v1/text-to-speech/{voice_id}/stream?output_format=pcm_24000)
//   https://elevenlabs.io/docs/models                                (eleven_flash_v2_5: ~75 ms, supports Spanish)
//   https://elevenlabs.io/docs/best-practices/latency-optimization   (HTTP streaming when the full text is known up front)
// pcm_24000 = raw signed 16-bit little-endian, 24 kHz, mono, no header.
using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Workbench.Core;
using Workbench.Core.Contracts;

namespace Workbench.Providers.ElevenLabs;

public sealed class ElevenLabsOptions
{
    public const string KeyVariable = "ElevenLabs__ApiKey";
    public string? ApiKey { get; set; }
    public string BaseUrl { get; set; } = "https://api.elevenlabs.io";
    public string ModelId { get; set; } = "eleven_flash_v2_5";
    /// <summary>Matilda (premade, multilingual with Flash v2.5); per-language overrides live in Languages.</summary>
    public string DefaultVoiceId { get; set; } = "XrExE9yKIg1WjnnlVkGX";
    public int SampleRate { get; set; } = 24000;
}

public sealed class ElevenLabsTtsProvider(IHttpClientFactory http, IOptions<ElevenLabsOptions> options) : ITtsProvider, IWarmable
{
    public const string HttpClientName = "elevenlabs";
    public string Name => "elevenlabs";

    public async IAsyncEnumerable<AudioChunk> SynthesizeAsync(string text, VoiceOptions voice, [EnumeratorCancellation] CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) throw new ProviderConfigException(Name, "tts", ElevenLabsOptions.KeyVariable);
        var voiceId = voice.VoiceId ?? o.DefaultVoiceId;

        var body = new JsonObject { ["text"] = text, ["model_id"] = o.ModelId, ["language_code"] = voice.Language };
        using var req = new HttpRequestMessage(HttpMethod.Post,
            $"{o.BaseUrl}/v1/text-to-speech/{voiceId}/stream?output_format=pcm_{o.SampleRate}") { Content = JsonContent.Create(body) };
        req.Headers.Add("xi-api-key", o.ApiKey);

        using var res = await http.CreateClient(HttpClientName).SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (res.StatusCode == HttpStatusCode.TooManyRequests) throw new RateLimitedException(Name, "tts", "ElevenLabs returned 429");
        if (!res.IsSuccessStatusCode)
        {
            var status = (int)res.StatusCode;
            var detail = await res.Content.ReadAsStringAsync(ct);
            throw new ProviderErrorException(Name, "tts", $"ElevenLabs returned {status}: {(detail.Length > 200 ? detail[..200] : detail)}", status);
        }

        await using var stream = await res.Content.ReadAsStreamAsync(ct);
        // Network reads can split a 16-bit sample; carry an odd trailing byte into the next read.
        const int readSize = 4800; // 100 ms at 24 kHz
        var buffer = new byte[readSize + 1];
        var carried = 0;
        int read;
        while ((read = await stream.ReadAsync(buffer.AsMemory(carried, readSize), ct)) > 0)
        {
            var total = carried + read;
            var even = total & ~1;
            if (even > 0) yield return new AudioChunk(buffer.AsSpan(0, even).ToArray(), o.SampleRate);
            carried = total - even;
            if (carried == 1) buffer[0] = buffer[even];
        }
    }

    /// <summary>Warm-up: open a pooled TLS connection to api.elevenlabs.io.</summary>
    public async Task WarmUpAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) return;
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{o.BaseUrl}/v1/models");
        req.Headers.Add("xi-api-key", o.ApiKey);
        using var _ = await http.CreateClient(HttpClientName).SendAsync(req, ct);
    }
}
