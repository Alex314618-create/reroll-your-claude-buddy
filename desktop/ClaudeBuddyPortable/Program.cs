using System.Diagnostics;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;

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
            File.WriteAllText(
                Path.Combine(AppContext.BaseDirectory, "portable-error.log"),
                $"{DateTime.UtcNow:O}{Environment.NewLine}{error}{Environment.NewLine}"
            );
            ShowError($"Portable 启动失败，请查看：{Path.Combine(AppContext.BaseDirectory, "portable-error.log")}");
        }
    }

    private static async Task RunAsync(string[] args)
    {
        var appRoot = Path.Combine(AppContext.BaseDirectory, "app");
        if (!Directory.Exists(appRoot))
        {
            ShowError(
                "Portable 资源目录缺失，找不到 app 文件夹。\n\n请重新解压完整的 Portable 压缩包后再双击运行。"
            );
            return;
        }

        var baseUrl = $"http://127.0.0.1:{FindAvailablePort()}";
        var lastActivity = DateTime.UtcNow;
        var configStore = new ConfigStore();
        var fileProvider = new PhysicalFileProvider(appRoot);
        var contentTypes = new FileExtensionContentTypeProvider();

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
            if (!TryReadStaticFile(fileProvider, contentTypes, relativePath, out var contentType, out var bytes))
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

    private static bool TryReadStaticFile(
        IFileProvider fileProvider,
        FileExtensionContentTypeProvider contentTypes,
        string relativePath,
        out string contentType,
        out byte[] bytes)
    {
        var fileInfo = fileProvider.GetFileInfo(relativePath);
        if (!fileInfo.Exists)
        {
            contentType = "application/octet-stream";
            bytes = Array.Empty<byte>();
            return false;
        }

        if (!contentTypes.TryGetContentType(relativePath, out var resolvedContentType))
        {
            resolvedContentType = "application/octet-stream";
        }

        contentType = resolvedContentType;

        using var stream = fileInfo.CreateReadStream();
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        bytes = memory.ToArray();
        return true;
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
            ShowError($"浏览器没有自动打开，请手动访问：\n\n{url}");
        }
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, "Claude Buddy Local Portable");
    }

    private static int FindAvailablePort()
    {
        using var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        return ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
    }
}
