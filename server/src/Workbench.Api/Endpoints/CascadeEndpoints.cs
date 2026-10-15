using Workbench.Api.Control;

namespace Workbench.Api.Endpoints;

public static class CascadeEndpoints
{
    public static void MapCascadeEndpoints(this WebApplication app)
    {
        app.Map("/ws/cascade", async (HttpContext ctx) =>
        {
            if (!ctx.WebSockets.IsWebSocketRequest)
            {
                ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }
            using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
            var session = ActivatorUtilities.CreateInstance<CascadeSession>(ctx.RequestServices, socket);
            await session.RunAsync(ctx.RequestAborted);
        });
    }
}
