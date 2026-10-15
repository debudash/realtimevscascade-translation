// Deepgram streaming STT (WebSocket). Docs (read 2026-10-15):
//   https://developers.deepgram.com/reference/speech-to-text/listen-streaming
//   https://developers.deepgram.com/docs/finalize        ({"type":"Finalize"}, from_finalize; not guaranteed with little audio)
//   https://developers.deepgram.com/docs/close-stream    ({"type":"CloseStream"})
//   https://developers.deepgram.com/docs/keep-alive      (socket closes after 10 s without audio or KeepAlive)
//   https://developers.deepgram.com/docs/authenticating  (Authorization: Token <key>)
//   https://developers.deepgram.com/docs/models-languages-overview (nova-3 supports en and es)
using System.Net;
using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.Options;
using Workbench.Core;
using Workbench.Core.Contracts;

namespace Workbench.Providers.Deepgram;

public sealed class DeepgramOptions
{
    public const string KeyVariable = "Deepgram__ApiKey";
    public string? ApiKey { get; set; }
    public string Model { get; set; } = "nova-3";
    /// <summary>Silence (ms) that ends a segment mid-turn; segment-commit mode commits on these finals.</summary>
    public int EndpointingMs { get; set; } = 300;
    /// <summary>After release, end the turn if Deepgram sends nothing for this long.</summary>
    public int FinalizeTimeoutMs { get; set; } = 1500;
    public string ListenUrl { get; set; } = "wss://api.deepgram.com/v1/listen";
    public string RestBaseUrl { get; set; } = "https://api.deepgram.com";
}

public sealed class DeepgramSttProvider(
    IOptions<DeepgramOptions> options,
    IOptions<LanguagesOptions> languages,
    IHttpClientFactory http) : ISttProvider, IWarmable
{
    public const string HttpClientName = "deepgram";
    private static readonly byte[] FinalizeMsg = """{"type":"Finalize"}"""u8.ToArray();
    private static readonly byte[] CloseMsg = """{"type":"CloseStream"}"""u8.ToArray();
    private static readonly byte[] KeepAliveMsg = """{"type":"KeepAlive"}"""u8.ToArray();

    public string Name => "deepgram";

    /// <summary>One socket per turn, opened on press (press-to-warm). Sends are serialized: ClientWebSocket allows one at a time.</summary>
    private sealed class Stream(ClientWebSocket ws, int sampleRate)
    {
        private readonly SemaphoreSlim _sendLock = new(1, 1);
        private long _bytesSent;

        public ClientWebSocket Ws { get; } = ws;
        /// <summary>Completes when the audio channel is done (button release) and Finalize, if any, has been sent.</summary>
        public TaskCompletionSource Released { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public double SecondsSent => Interlocked.Read(ref _bytesSent) / (2.0 * sampleRate);

        public async Task SendAsync(ReadOnlyMemory<byte> data, WebSocketMessageType type, CancellationToken ct)
        {
            await _sendLock.WaitAsync(ct);
            try
            {
                await Ws.SendAsync(data, type, true, ct);
                if (type == WebSocketMessageType.Binary) Interlocked.Add(ref _bytesSent, data.Length);
            }
            finally
            {
                _sendLock.Release();
            }
        }

        /// <summary>Best effort; never throws.</summary>
        public async Task TrySendAsync(byte[] data)
        {
            try
            {
                if (Ws.State == WebSocketState.Open) await SendAsync(data, WebSocketMessageType.Text, CancellationToken.None);
            }
            catch (Exception) { }
        }
    }

    public async IAsyncEnumerable<SttResult> TranscribeAsync(ChannelReader<AudioFrame> audio, SttOptions opts, [EnumeratorCancellation] CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) throw new ProviderConfigException(Name, "stt", DeepgramOptions.KeyVariable);

        var lang = languages.Value.Languages.FirstOrDefault(l => l.Code == opts.Language)?.DeepgramLanguage ?? opts.Language;
        var url = $"{o.ListenUrl}?model={o.Model}&language={lang}&encoding=linear16&sample_rate={opts.SampleRate}&channels=1" +
                  $"&interim_results=true&punctuate=true&smart_format=true&endpointing={o.EndpointingMs}";

        using var ws = await ConnectWithRetryAsync(new Uri(url), o.ApiKey!, ct);

        var stream = new Stream(ws, opts.SampleRate);
        var results = Channel.CreateUnbounded<SttResult>();
        using var turnCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var sender = SendLoopAsync(stream, audio, turnCts.Token);
        var receiver = ReceiveLoopAsync(stream, results.Writer, turnCts.Token);
        try
        {
            await foreach (var r in results.Reader.ReadAllAsync(ct)) yield return r;
        }
        finally
        {
            // Runs even if the consumer stops early: stop both loops before the socket is disposed.
            turnCts.Cancel();
            await Task.WhenAll(sender, receiver).ContinueWith(_ => { }, TaskScheduler.Default);
            try
            {
                if (ws.State == WebSocketState.Open) await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
            }
            catch (Exception) { }
        }
    }

    /// <summary>
    /// Connects, retrying 429 / 5xx / network failures up to <see cref="ConnectRetries"/> times with
    /// jittered backoff. Safe because nothing has been sent yet: the turn's audio waits in its channel.
    /// </summary>
    private async Task<ClientWebSocket> ConnectWithRetryAsync(Uri url, string apiKey, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            var ws = new ClientWebSocket();
            ws.Options.SetRequestHeader("Authorization", $"Token {apiKey}");
            ws.Options.CollectHttpResponseDetails = true;
            try
            {
                using var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                connectTimeout.CancelAfter(ConnectTimeout);
                await ws.ConnectAsync(url, connectTimeout.Token);
                return ws;
            }
            catch (Exception e) when (e is WebSocketException or OperationCanceledException && !ct.IsCancellationRequested)
            {
                var status = ws.HttpStatusCode;
                ws.Dispose();
                ProviderException error = status switch
                {
                    HttpStatusCode.TooManyRequests => new RateLimitedException(Name, "stt", "Deepgram returned 429"),
                    HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden =>
                        new ProviderErrorException(Name, "stt", $"Deepgram rejected the API key ({(int)status})", (int)status),
                    0 when e is OperationCanceledException => new ProviderTimeoutException(Name, "stt", $"Deepgram connect took over {ConnectTimeout.TotalSeconds:0} s"),
                    0 => new ProviderErrorException(Name, "stt", $"Deepgram connection failed: {e.Message}", inner: e),
                    var s => new ProviderErrorException(Name, "stt", $"Deepgram returned {(int)s}", (int)s),
                };
                if (attempt >= ConnectRetries || !error.Retryable) throw error;
                await Task.Delay(TimeSpan.FromMilliseconds(150 * (attempt + 1) + Random.Shared.Next(0, 100)), ct);
            }
        }
    }

    private const int ConnectRetries = 2;
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(3);

    /// <summary>Streams frames as they arrive; on release sends Finalize (skipped when no audio was sent).</summary>
    private static async Task SendLoopAsync(Stream s, ChannelReader<AudioFrame> audio, CancellationToken ct)
    {
        try
        {
            while (await WaitForFrameOrKeepAlive(s, audio, ct))
            {
                while (audio.TryRead(out var frame)) await s.SendAsync(frame.Pcm16, WebSocketMessageType.Binary, ct);
            }
            // Release: flush what Deepgram has buffered and get the last finals now. With no audio there
            // is nothing to finalize (Deepgram would not reply), so the receiver ends at once.
            if (s.SecondsSent > 0) await s.SendAsync(FinalizeMsg, WebSocketMessageType.Text, ct);
        }
        catch (Exception e) when (e is OperationCanceledException or WebSocketException or ObjectDisposedException or InvalidOperationException) { }
        finally
        {
            s.Released.TrySetResult();
        }
    }

    /// <summary>Waits for audio; sends a KeepAlive if none arrives for 4 s (Deepgram closes idle sockets at 10 s).</summary>
    private static async Task<bool> WaitForFrameOrKeepAlive(Stream s, ChannelReader<AudioFrame> audio, CancellationToken ct)
    {
        while (true)
        {
            using var idle = CancellationTokenSource.CreateLinkedTokenSource(ct);
            idle.CancelAfter(TimeSpan.FromSeconds(4));
            try
            {
                return await audio.WaitToReadAsync(idle.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                await s.SendAsync(KeepAliveMsg, WebSocketMessageType.Text, ct);
            }
        }
    }

    /// <summary>
    /// Deepgram works through audio at about real-time pace even when it arrives in a burst (e.g. the
    /// frames buffered while the socket connected), and the Finalize response only covers what it has
    /// processed so far. So the turn ends when, after release, a final result's end time reaches the end
    /// of the audio sent (measured 2026-10-15: 66 ms after Finalize with real-time pacing), or when
    /// Deepgram goes quiet for FinalizeTimeoutMs after release.
    /// </summary>
    private async Task ReceiveLoopAsync(Stream s, ChannelWriter<SttResult> results, CancellationToken ct)
    {
        var o = options.Value;
        var buffer = new byte[64 * 1024];
        using var quiet = CancellationTokenSource.CreateLinkedTokenSource(ct);
        // Arm the quiet timer at release (immediately if no audio was sent at all).
        _ = s.Released.Task.ContinueWith(_ =>
        {
            try
            {
                quiet.CancelAfter(s.SecondsSent == 0 ? 0 : o.FinalizeTimeoutMs);
            }
            catch (ObjectDisposedException) { }
        }, TaskScheduler.Default);

        Exception? error = null;
        try
        {
            while (true)
            {
                var (type, text) = await ReceiveMessage(s.Ws, buffer, quiet.Token);
                if (s.Released.Task.IsCompleted) quiet.CancelAfter(o.FinalizeTimeoutMs); // activity resets the quiet timer

                if (type == WebSocketMessageType.Close)
                {
                    // A close before release, or with an error status (e.g. idle NET-0001, 1008, 1011), is a failure.
                    var status = s.Ws.CloseStatus;
                    if (!s.Released.Task.IsCompleted || status is not (WebSocketCloseStatus.NormalClosure or null))
                    {
                        error = new ProviderErrorException(Name, "stt", $"Deepgram closed the stream ({(int?)status} {s.Ws.CloseStatusDescription})");
                    }
                    break;
                }
                if (type != WebSocketMessageType.Text) continue;

                using var doc = JsonDocument.Parse(text);
                var root = doc.RootElement;
                var msgType = root.TryGetProperty("type", out var t) ? t.GetString() : null;
                if (msgType == "Results" && TryParseResult(root, out var transcript, out var isFinal, out var fromFinalize, out var end))
                {
                    await results.WriteAsync(new SttResult(transcript, isFinal, fromFinalize), ct);
                    // Released, and the finals now cover everything sent: done.
                    if (isFinal && s.Released.Task.IsCompleted && end >= s.SecondsSent - 0.05) break;
                }
                else if (msgType == "Error")
                {
                    var desc = root.TryGetProperty("description", out var de) ? de.GetString() : "Deepgram error";
                    error = new ProviderErrorException(Name, "stt", $"Deepgram: {desc}");
                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Quiet after release (Finalize unanswered, e.g. very little audio), or the turn was cancelled.
        }
        catch (Exception e) when (e is WebSocketException or JsonException or ObjectDisposedException or InvalidOperationException)
        {
            if (!ct.IsCancellationRequested) error = new ProviderErrorException(Name, "stt", $"Deepgram stream failed: {e.Message}", inner: e);
        }
        finally
        {
            results.TryComplete(error); // first: the consumer must never hang
            await s.TrySendAsync(CloseMsg);
        }
    }

    private static bool TryParseResult(JsonElement root, out string transcript, out bool isFinal, out bool fromFinalize, out double end)
    {
        transcript = "";
        isFinal = root.TryGetProperty("is_final", out var f) && f.ValueKind == JsonValueKind.True;
        fromFinalize = root.TryGetProperty("from_finalize", out var ff) && ff.ValueKind == JsonValueKind.True;
        end = (root.TryGetProperty("start", out var st) && st.TryGetDouble(out var sv) ? sv : 0)
            + (root.TryGetProperty("duration", out var du) && du.TryGetDouble(out var dv) ? dv : 0);
        if (!root.TryGetProperty("channel", out var ch) || !ch.TryGetProperty("alternatives", out var alts)
            || alts.ValueKind != JsonValueKind.Array || alts.GetArrayLength() == 0) return false;
        transcript = alts[0].TryGetProperty("transcript", out var tr) ? tr.GetString() ?? "" : "";
        return true;
    }

    private static async Task<(WebSocketMessageType, string)> ReceiveMessage(ClientWebSocket ws, byte[] buffer, CancellationToken ct)
    {
        var count = 0;
        ValueWebSocketReceiveResult r;
        do
        {
            if (count == buffer.Length) Array.Resize(ref buffer, buffer.Length * 2);
            r = await ws.ReceiveAsync(buffer.AsMemory(count), ct);
            count += r.Count;
        } while (!r.EndOfMessage);
        return (r.MessageType, Encoding.UTF8.GetString(buffer, 0, count));
    }

    /// <summary>
    /// Warm-up: resolves DNS and checks the key. The STT socket itself opens on press (press-to-warm);
    /// its connect time is hidden behind the speaker's first words while frames are buffered.
    /// </summary>
    public async Task WarmUpAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) return;
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{o.RestBaseUrl}/v1/projects");
        req.Headers.Authorization = new("Token", o.ApiKey);
        using var res = await http.CreateClient(HttpClientName).SendAsync(req, ct);
        if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new ProviderErrorException(Name, "stt", $"Deepgram rejected the API key ({(int)res.StatusCode})", (int)res.StatusCode);
    }
}
