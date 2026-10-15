using Microsoft.Extensions.Options;
using Workbench.Api.Config;
using Workbench.Api.Control;
using Workbench.Providers.OpenAI;
using Workbench.Core;

namespace Workbench.Api.Endpoints;

public static class HealthEndpoints
{
    public static void MapHealthEndpoints(this WebApplication app)
    {
        // Names of missing variables only, never values.
        app.MapGet("/api/health", (IConfiguration config, IOptions<ProvidersOptions> providers, CascadeProviderFactory factory) =>
        {
            var missing = RequiredKeys.Missing(config);
            var cascadeNames = factory.Resolve(null);
            return Results.Ok(new
            {
                status = "ok",
                // Short git sha of this build; turns and harness runs record it.
                build = BuildInfo.Sha,
                configOk = missing.Count == 0,
                missing,
                // What blocks each mode. DeepL (failover) is optional; Realtime needs only OpenAI.
                missingByMode = new
                {
                    realtime = missing.Where(m => m == OpenAIOptions.KeyVariable).ToList(),
                    cascade = factory.MissingKeys(cascadeNames),
                },
                providers = providers.Value,
            });
        });

        // Languages and pairs drive the UI's pair selector and talk-button labels.
        app.MapGet("/api/config", (IOptions<LanguagesOptions> langs, IOptions<ProvidersOptions> providers, IOptions<TranslationControlsOptions> controls) =>
        {
            var l = langs.Value;
            return Results.Ok(new
            {
                defaultPair = l.DefaultPair,
                pairs = l.Pairs.Select(p => new { p.Id, p.A, p.B, p.Label }),
                languages = l.Languages.Select(x => new { x.Code, x.Name, x.NativeName, x.SpeakerLabel }),
                providers = providers.Value,
                // Default for the header's "Clinic terms" toggle (formal register + glossary).
                translationControls = new { enabled = controls.Value.Enabled },
            });
        });
    }
}
