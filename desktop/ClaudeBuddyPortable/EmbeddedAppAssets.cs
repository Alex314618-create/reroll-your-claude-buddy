using System.Reflection;
using Microsoft.AspNetCore.StaticFiles;

namespace ClaudeBuddyPortable;

internal sealed class EmbeddedAppAssets
{
    private const string ResourcePrefix = "ClaudeBuddyApp/";

    private readonly Assembly _assembly;
    private readonly Dictionary<string, string> _resourceNames;
    private readonly FileExtensionContentTypeProvider _contentTypes = new();

    private EmbeddedAppAssets(Assembly assembly, Dictionary<string, string> resourceNames)
    {
        _assembly = assembly;
        _resourceNames = resourceNames;
    }

    public bool HasIndex => _resourceNames.ContainsKey("index.html");

    public static EmbeddedAppAssets Load()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resourceNames = assembly
            .GetManifestResourceNames()
            .Where(name => name.StartsWith(ResourcePrefix, StringComparison.Ordinal))
            .ToDictionary(
                name => NormalizePath(name[ResourcePrefix.Length..]),
                name => name,
                StringComparer.OrdinalIgnoreCase
            );

        return new EmbeddedAppAssets(assembly, resourceNames);
    }

    public bool TryRead(string relativePath, out string contentType, out byte[] bytes)
    {
        var normalizedPath = NormalizePath(relativePath);
        if (!_resourceNames.TryGetValue(normalizedPath, out var resourceName))
        {
            contentType = "application/octet-stream";
            bytes = Array.Empty<byte>();
            return false;
        }

        using var stream = _assembly.GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            contentType = "application/octet-stream";
            bytes = Array.Empty<byte>();
            return false;
        }

        if (!_contentTypes.TryGetContentType(normalizedPath, out var resolvedContentType))
        {
            resolvedContentType = "application/octet-stream";
        }
        contentType = resolvedContentType;

        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        bytes = memory.ToArray();
        return true;
    }

    private static string NormalizePath(string path)
    {
        return path.Replace('\\', '/').TrimStart('/');
    }
}
