using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ClaudeBuddyPortable;

internal sealed class ConfigStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
    };

    public string GetClaudeConfigPath()
    {
        return Environment.GetEnvironmentVariable("CLAUDE_CONFIG_PATH")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude.json");
    }

    public async Task<ConfigStatus> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var configPath = GetClaudeConfigPath();

        try
        {
            var parsed = await ReadConfigObjectAsync(configPath, cancellationToken);

            return new ConfigStatus(
                ConfigPath: configPath,
                Exists: true,
                ParseError: null,
                HasUserId: parsed["userID"] is JsonValue userValue && !string.IsNullOrWhiteSpace(userValue.GetValue<string>()),
                HasCompanion: parsed["companion"] is not null,
                HasOAuthAccount: parsed["oauthAccount"] is JsonObject,
                HasAccountUuid: parsed["oauthAccount"]?["accountUuid"] is not null,
                CurrentUserId: parsed["userID"] is JsonValue currentUserId ? currentUserId.GetValue<string>() : null
            );
        }
        catch (FileNotFoundException)
        {
            return new ConfigStatus(
                ConfigPath: configPath,
                Exists: false,
                ParseError: null,
                HasUserId: false,
                HasCompanion: false,
                HasOAuthAccount: false,
                HasAccountUuid: false,
                CurrentUserId: null
            );
        }
        catch (DirectoryNotFoundException)
        {
            return new ConfigStatus(
                ConfigPath: configPath,
                Exists: false,
                ParseError: null,
                HasUserId: false,
                HasCompanion: false,
                HasOAuthAccount: false,
                HasAccountUuid: false,
                CurrentUserId: null
            );
        }
        catch (Exception error)
        {
            return new ConfigStatus(
                ConfigPath: configPath,
                Exists: true,
                ParseError: error.Message,
                HasUserId: false,
                HasCompanion: false,
                HasOAuthAccount: false,
                HasAccountUuid: false,
                CurrentUserId: null
            );
        }
    }

    public async Task<ApplyResult> ApplyUserIdAsync(ApplyRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.UserId))
        {
            throw new InvalidOperationException("userId is required.");
        }

        var configPath = GetClaudeConfigPath();
        JsonObject config;

        try
        {
            config = await ReadConfigObjectAsync(configPath, cancellationToken);
        }
        catch (FileNotFoundException)
        {
            config = new JsonObject();
        }
        catch (DirectoryNotFoundException)
        {
            config = new JsonObject();
        }

        string? backupPath = null;

        if (request.Backup && File.Exists(configPath))
        {
            backupPath = $"{configPath}.buddy-backup-{DateTime.UtcNow:yyyy-MM-ddTHH-mm-ss-fffZ}";
            File.Copy(configPath, backupPath, overwrite: true);
        }

        config["userID"] = request.UserId.Trim();

        if (request.RemoveCompanion)
        {
            config.Remove("companion");
        }

        if (request.RemoveAccountUuid && config["oauthAccount"] is JsonObject oauthAccount)
        {
            oauthAccount.Remove("accountUuid");
            if (oauthAccount.Count == 0)
            {
                config.Remove("oauthAccount");
            }
        }

        Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);

        var tempPath = $"{configPath}.tmp-{Environment.ProcessId}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        var replacementPath = $"{configPath}.replace-{Environment.ProcessId}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        var payload = JsonSerializer.Serialize(config, JsonOptions) + Environment.NewLine;
        await File.WriteAllTextAsync(tempPath, payload, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), cancellationToken);

        try
        {
            File.Move(tempPath, configPath);
        }
        catch (IOException)
        {
            await ReplaceExistingFileAsync(configPath, tempPath, replacementPath, cancellationToken);
        }
        catch (UnauthorizedAccessException)
        {
            await ReplaceExistingFileAsync(configPath, tempPath, replacementPath, cancellationToken);
        }

        return new ApplyResult(
            ConfigPath: configPath,
            BackupPath: backupPath,
            UserId: request.UserId.Trim(),
            RemovedCompanion: request.RemoveCompanion,
            RemovedAccountUuid: request.RemoveAccountUuid
        );
    }

    private static async Task ReplaceExistingFileAsync(string configPath, string tempPath, string replacementPath, CancellationToken cancellationToken)
    {
        try
        {
            if (File.Exists(configPath))
            {
                File.Move(configPath, replacementPath, overwrite: true);
            }

            File.Move(tempPath, configPath);

            if (File.Exists(replacementPath))
            {
                File.Delete(replacementPath);
            }
        }
        catch
        {
            if (File.Exists(replacementPath) && !File.Exists(configPath))
            {
                File.Move(replacementPath, configPath);
            }

            throw;
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }

            if (File.Exists(replacementPath))
            {
                File.Delete(replacementPath);
            }

            await Task.CompletedTask;
        }
    }

    private static async Task<JsonObject> ReadConfigObjectAsync(string configPath, CancellationToken cancellationToken)
    {
        var raw = await File.ReadAllTextAsync(configPath, cancellationToken);
        var normalized = StripUtf8Bom(raw);

        if (string.IsNullOrWhiteSpace(normalized))
        {
            return new JsonObject();
        }

        var parsed = JsonNode.Parse(normalized) as JsonObject;
        if (parsed is null)
        {
            throw new InvalidOperationException("Claude config root must be a JSON object.");
        }

        return parsed;
    }

    private static string StripUtf8Bom(string value)
    {
        return value.Length > 0 && value[0] == '\uFEFF' ? value[1..] : value;
    }
}

internal sealed record ConfigStatus(
    string ConfigPath,
    bool Exists,
    string? ParseError,
    bool HasUserId,
    bool HasCompanion,
    bool HasOAuthAccount,
    bool HasAccountUuid,
    string? CurrentUserId
);

internal sealed record ApplyRequest(
    string UserId,
    bool Backup,
    bool RemoveCompanion,
    bool RemoveAccountUuid
);

internal sealed record ApplyResult(
    string ConfigPath,
    string? BackupPath,
    string UserId,
    bool RemovedCompanion,
    bool RemovedAccountUuid
);
