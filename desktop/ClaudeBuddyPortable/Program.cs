using System.Diagnostics;
using System.Windows.Forms;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace ClaudeBuddyPortable;

internal static class Program
{
    [STAThread]
    private static async Task Main(string[] args)
    {
        try
        {
            await RunAsync(args);
        }
        catch (Exception error)
        {
            var logPath = Path.Combine(AppContext.BaseDirectory, "portable-error.log");
            File.WriteAllText(
                logPath,
                $"{DateTime.UtcNow:O}{Environment.NewLine}{error}{Environment.NewLine}"
            );
            ShowError($"Portable failed to start.\n\nSee:\n{logPath}");
        }
    }

    private static async Task RunAsync(string[] args)
    {
        var embeddedAssets = EmbeddedAppAssets.Load();
        if (!embeddedAssets.HasIndex)
        {
            ShowError("Portable app assets are missing from this build.");
            return;
        }

        var baseUrl = $"http://127.0.0.1:{FindAvailablePort()}";
        var lastActivity = DateTime.UtcNow;
        var configStore = new ConfigStore();

        var builder = WebApplication.CreateSlimBuilder(args);
        builder.WebHost.UseKestrel();
        builder.WebHost.UseUrls(baseUrl);
        builder.Logging.ClearProviders();

        var app = builder.Build();

        app.Use(async (context, next) =>
        {
            lastActivity = DateTime.UtcNow;
            context.Response.Headers.CacheControl = "no-store";
            await next();
        });

        app.MapGet("/api/health", () => Results.Json(new { ok = true, portable = true }));

        app.MapGet("/api/ping", () =>
        {
            lastActivity = DateTime.UtcNow;
            return Results.NoContent();
        });

        app.MapGet("/api/config/status", async (CancellationToken cancellationToken) =>
        {
            var status = await configStore.GetStatusAsync(cancellationToken);
            return Results.Json(status);
        });

        app.MapPost("/api/apply", async (ApplyRequest request, CancellationToken cancellationToken) =>
        {
            try
            {
                var result = await configStore.ApplyUserIdAsync(request, cancellationToken);
                return Results.Json(new { ok = true, result });
            }
            catch (Exception error)
            {
                return Results.Json(new { ok = false, error = error.Message }, statusCode: StatusCodes.Status400BadRequest);
            }
        });

        app.MapGet("/{**path}", async (HttpContext context) =>
        {
            var relativePath = NormalizeRelativePath(context.Request.Path.Value);
            if (!embeddedAssets.TryRead(relativePath, out var contentType, out var bytes))
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            context.Response.ContentType = contentType;
            context.Response.ContentLength = bytes.Length;
            await context.Response.Body.WriteAsync(bytes, context.RequestAborted);
        });

        app.Lifetime.ApplicationStarted.Register(() =>
        {
            _ = Task.Run(() => OpenBrowser(baseUrl));
            _ = Task.Run(async () =>
            {
                while (!app.Lifetime.ApplicationStopping.IsCancellationRequested)
                {
                    await Task.Delay(TimeSpan.FromSeconds(15));
                    if (DateTime.UtcNow - lastActivity > TimeSpan.FromMinutes(2))
                    {
                        app.Lifetime.StopApplication();
                        break;
                    }
                }
            });
        });

        await app.RunAsync();
    }

    private static string NormalizeRelativePath(string? requestPath)
    {
        if (string.IsNullOrWhiteSpace(requestPath) || requestPath == "/")
        {
            return "index.html";
        }

        return requestPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
    }

    private static void OpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true,
            });
        }
        catch
        {
            ShowError($"Browser did not open automatically.\n\nOpen this URL manually:\n{url}");
        }
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, "Claude Buddy Local Portable", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private static int FindAvailablePort()
    {
        using var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        return ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
    }
}
