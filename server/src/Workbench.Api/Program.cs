using Workbench.Api.Config;
using Workbench.Api.Endpoints;
using Workbench.Core;
using Workbench.Api.Control;
using Workbench.Providers.DeepL;
using Workbench.Providers.Deepgram;
using Workbench.Providers.ElevenLabs;
using Workbench.Providers.OpenAI;
using Workbench.Providers.Resilience;

// Keys come from .env (repo root). Load it before configuration is built;
// real environment variables win over .env.
DotEnvLoader.Load();

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ProvidersOptions>(builder.Configuration.GetSection("Providers"));
builder.Services.Configure<LanguagesOptions>(builder.Configuration.GetSection("Languages"));
builder.Services.AddProblemDetails();

builder.Services.Configure<OpenAIOptions>(builder.Configuration.GetSection("OpenAI"));
// Pooled, long-lived connections so warm-up actually keeps TLS sessions hot between turns.
static SocketsHttpHandler PooledHandler() => new()
{
    PooledConnectionIdleTimeout = TimeSpan.FromMinutes(5),
    PooledConnectionLifetime = TimeSpan.FromMinutes(15),
};
builder.Services.AddHttpClient<RealtimeSessionClient>(RealtimeSessionClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(30))
    .ConfigurePrimaryHttpMessageHandler(PooledHandler);
builder.Services.AddHttpClient(DeepgramSttProvider.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(15)).ConfigurePrimaryHttpMessageHandler(PooledHandler);
builder.Services.AddHttpClient(DeepLTranslationProvider.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(15)).ConfigurePrimaryHttpMessageHandler(PooledHandler);
builder.Services.AddHttpClient(ElevenLabsTtsProvider.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(60)).ConfigurePrimaryHttpMessageHandler(PooledHandler);

// Real cascade adapters (stateless singletons; options bound from config + .env keys).
builder.Services.Configure<DeepgramOptions>(builder.Configuration.GetSection("Deepgram"));
builder.Services.Configure<DeepLOptions>(builder.Configuration.GetSection("DeepL"));
builder.Services.Configure<ElevenLabsOptions>(builder.Configuration.GetSection("ElevenLabs"));
builder.Services.AddSingleton<DeepgramSttProvider>();
builder.Services.AddSingleton<OpenAITranslationProvider>();
builder.Services.AddSingleton<DeepLTranslationProvider>();
builder.Services.AddSingleton<ElevenLabsTtsProvider>();

// Cascade: provider selection + resilience (media module lives in Workbench.Core.Pipeline).
builder.Services.Configure<ResilienceOptions>(builder.Configuration.GetSection("Resilience"));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<FailoverCircuitRegistry>();
builder.Services.AddSingleton<CascadeProviderFactory>();

var app = builder.Build();

// Provider registry: swapping a provider is a config value; adding one is one line here.
var providers = app.Services.GetRequiredService<CascadeProviderFactory>();
providers.AddStt("deepgram", sp => sp.GetRequiredService<DeepgramSttProvider>());
providers.AddTranslation("openai", sp => sp.GetRequiredService<OpenAITranslationProvider>());
providers.AddTranslation("deepl", sp => sp.GetRequiredService<DeepLTranslationProvider>());
providers.AddTts("elevenlabs", sp => sp.GetRequiredService<ElevenLabsTtsProvider>());

app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });

app.MapHealthEndpoints();
app.MapClipEndpoints();
app.MapRealtimeEndpoints();
app.MapCascadeEndpoints();

app.Run();

/// <summary>Exposed for WebApplicationFactory in tests.</summary>
public partial class Program;
