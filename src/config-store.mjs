import os from "node:os";
import path from "node:path";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

export function getClaudeConfigPath() {
  return process.env.CLAUDE_CONFIG_PATH || path.join(os.homedir(), ".claude.json");
}

function stripUtf8Bom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function isConfigObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ensureConfigObject(value) {
  if (!isConfigObject(value)) {
    throw new Error("Claude config root must be a JSON object.");
  }

  return value;
}

async function readConfigFile(configPath) {
  const raw = await readFile(configPath, "utf8");
  const normalized = stripUtf8Bom(raw);

  if (normalized.trim().length === 0) {
    return {
      raw,
      parsed: {},
    };
  }

  return {
    raw,
    parsed: ensureConfigObject(JSON.parse(normalized)),
  };
}

export async function getConfigStatus() {
  const configPath = getClaudeConfigPath();

  try {
    const { parsed } = await readConfigFile(configPath);

    return {
      configPath,
      exists: true,
      parseError: null,
      hasUserId: typeof parsed.userID === "string" && parsed.userID.length > 0,
      hasCompanion: Boolean(parsed.companion),
      hasOAuthAccount: Boolean(parsed.oauthAccount),
      hasAccountUuid: Boolean(parsed.oauthAccount?.accountUuid),
      currentUserId: typeof parsed.userID === "string" ? parsed.userID : null,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        configPath,
        exists: false,
        parseError: null,
        hasUserId: false,
        hasCompanion: false,
        hasOAuthAccount: false,
        hasAccountUuid: false,
        currentUserId: null,
      };
    }

    return {
      configPath,
      exists: true,
      parseError: error instanceof Error ? error.message : String(error),
      hasUserId: false,
      hasCompanion: false,
      hasOAuthAccount: false,
      hasAccountUuid: false,
      currentUserId: null,
    };
  }
}

export async function applyUserId({
  userId,
  removeAccountUuid = true,
  removeCompanion = true,
  backup = true,
}) {
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("userId is required.");
  }

  const configPath = getClaudeConfigPath();
  let config = {};
  let backupPath = null;

  try {
    const { parsed } = await readConfigFile(configPath);
    config = parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (backup) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = `${configPath}.buddy-backup-${timestamp}`;
      await copyFile(configPath, backupPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      backupPath = null;
    }
  }

  config.userID = userId.trim();

  if (removeCompanion) {
    delete config.companion;
  }

  if (removeAccountUuid && config.oauthAccount && typeof config.oauthAccount === "object") {
    delete config.oauthAccount.accountUuid;
    if (Object.keys(config.oauthAccount).length === 0) {
      delete config.oauthAccount;
    }
  }

  await mkdir(path.dirname(configPath), { recursive: true });

  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  const replacementPath = `${configPath}.replace-${process.pid}-${Date.now()}`;

  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  try {
    await rename(tempPath, configPath);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") {
      throw error;
    }

    try {
      await rename(configPath, replacementPath);
    } catch (renameError) {
      if (renameError?.code !== "ENOENT") {
        throw renameError;
      }
    }

    try {
      await rename(tempPath, configPath);
    } catch (replaceError) {
      try {
        await rename(replacementPath, configPath);
      } catch {}
      throw replaceError;
    }

    try {
      await rm(replacementPath, { force: true });
    } catch {}
  }

  return {
    configPath,
    backupPath,
    userId: config.userID,
    removedCompanion: removeCompanion,
    removedAccountUuid: removeAccountUuid,
  };
}
