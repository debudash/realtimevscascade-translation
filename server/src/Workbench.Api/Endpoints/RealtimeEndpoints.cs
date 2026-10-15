using Microsoft.Extensions.Options;
using Workbench.Api.Config;
using Workbench.Core;
using Workbench.Providers.OpenAI;

namespace Workbench.Api.Endpoints;

public static class RealtimeEndpoints
{
    /// <param name="Controls">Register/terminology instructions on or off; null = config default.</param>
    public sealed record SessionRequest(string? PairId, bool? Controls = null);

    public static void MapRealtimeEndpoints(this WebApplication app)
    {
        // Mints a short-lived client secret for browser WebRTC. Returns per-direction instructions
        // so the client can retarget the session on each press (session.update) without owning prompts.
        app.MapPost("/api/realtime/session", async (SessionRequest? body, RealtimeSessionClient client, IOptions<LanguagesOptions> langs,
            IOptions<TranslationControlsOptions> controls, CancellationToken ct) =>
        {
            var l = langs.Value;
            var pair = l.Pairs.FirstOrDefault(p => p.Id == (body?.PairId ?? l.DefaultPair));
            if (pair is null) return Results.Problem($"Unknown pair '{body?.PairId}'.", statusCode: 400);

            var a = l.Get(pair.A);
            var b = l.Get(pair.B);
            RealtimeDirection Dir(LanguageOptions src, LanguageOptions tgt) =>
                new(src.Code, tgt.Code, InterpreterPrompt.For(src.Name, tgt.Name, controls.Value.For(src.Code, tgt.Code, body?.Controls)), src.Code);

            try
            {
                var session = await client.CreateAsync([Dir(a, b), Dir(b, a)], ct);
                return Results.Ok(session);
            }
            catch (ProviderException ex)
            {
                return ProviderProblem(ex);
            }
        });
    }

    /// <summary>Maps a provider failure to a typed error body (code from the taxonomy). Never includes key values.</summary>
    public static IResult ProviderProblem(ProviderException ex) =>
        Results.Json(
            new
            {
                code = ex.Code,
                message = ex.Message,
                provider = ex.Provider,
                stage = ex.Stage,
                retryable = ex.Retryable,
                missing = ex is ProviderConfigException c ? new[] { c.VariableName } : null,
                httpStatus = (ex as ProviderErrorException)?.HttpStatus,
            },
            statusCode: ex switch
            {
                ProviderConfigException => StatusCodes.Status503ServiceUnavailable,
                RateLimitedException => StatusCodes.Status429TooManyRequests,
                ProviderTimeoutException => StatusCodes.Status504GatewayTimeout,
                _ => StatusCodes.Status502BadGateway,
            });
}
