using Workbench.Api.Config;
using Workbench.Api.Endpoints;
using Workbench.Core;
using Workbench.Providers.OpenAI;

// Keys come from .env (repo root). Load it before configuration is built;
// real environment variables win over .env.
DotEnvLoader.Load();

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ProvidersOptions>(builder.Configuration.GetSection("Providers"));
builder.Services.Configure<LanguagesOptions>(builder.Configuration.GetSection("Languages"));
builder.Services.AddProblemDetails();

builder.Services.Configure<OpenAIOptions>(builder.Configuration.GetSection("OpenAI"));
builder.Services.AddHttpClient<RealtimeSessionClient>(RealtimeSessionClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(15));

var app = builder.Build();

app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });

app.MapHealthEndpoints();
app.MapClipEndpoints();
app.MapRealtimeEndpoints();

app.Run();

/// <summary>Exposed for WebApplicationFactory in tests.</summary>
public partial class Program;
