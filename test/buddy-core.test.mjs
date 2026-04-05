import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import {
  BUN_HASH_SELF_TESTS,
  hashStringBun,
  matchesFilters,
  rollUserId,
  verifyBunHashCompatibility,
  wyhash64,
} from "../app/shared/buddy-core.js";
import { buildSequentialId, calculateLocalLimit, getEffectiveWorkerCount } from "../app/shared/search-plan.js";
import { applyUserId, getConfigStatus } from "../src/config-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const tests = [];
let releaseBuilt = false;

class SkipTest extends Error {
  constructor(message) {
    super(message);
    this.name = "SkipTest";
  }
}

function test(name, fn) {
  tests.push({ name, fn });
}

async function withTempDir(run) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-buddy-test-"));
  try {
    await run(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function withTempConfig(run) {
  await withTempDir(async (tempRoot) => {
    const configPath = path.join(tempRoot, ".claude.json");
    const previous = process.env.CLAUDE_CONFIG_PATH;
    process.env.CLAUDE_CONFIG_PATH = configPath;

    try {
      await run(configPath, tempRoot);
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_CONFIG_PATH;
      } else {
        process.env.CLAUDE_CONFIG_PATH = previous;
      }
    }
  });
}

async function ensureReleaseBuilt() {
  if (releaseBuilt) {
    return;
  }

  await import(`${pathToFileURL(path.join(projectRoot, "scripts", "build-release.mjs")).href}?t=${Date.now()}`);
  releaseBuilt = true;
}

async function runStandaloneNodeApplyScript(scriptPath, configPath, userId, extraArgs = [], expectedExitCode = 0) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const previousConfigPath = process.env.CLAUDE_CONFIG_PATH;
  const previousConsoleLog = console.log;
  const previousConsoleError = console.error;

  process.argv = [process.execPath, scriptPath, userId, ...extraArgs];
  process.exitCode = 0;
  process.env.CLAUDE_CONFIG_PATH = configPath;
  console.log = () => {};
  console.error = () => {};

  try {
    await import(`${pathToFileURL(scriptPath).href}?t=${Date.now()}`);
    assert.equal(process.exitCode ?? 0, expectedExitCode);
  } finally {
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
    console.log = previousConsoleLog;
    console.error = previousConsoleError;
    if (previousConfigPath === undefined) {
      delete process.env.CLAUDE_CONFIG_PATH;
    } else {
      process.env.CLAUDE_CONFIG_PATH = previousConfigPath;
    }
  }
}

function shouldSkipPowerShellIntegration(run, name) {
  if (run.error?.code === "EPERM") {
    throw new SkipTest(`${name} (sandbox blocked powershell.exe spawn)`);
  }
}

test("bun-compatible wyhash self-tests pass", () => {
  assert.equal(verifyBunHashCompatibility(), true);

  for (const testCase of BUN_HASH_SELF_TESTS) {
    assert.equal(wyhash64(testCase.input, testCase.seed), testCase.expected);
  }
});

test("hashStringBun remains stable for the canonical salt", () => {
  assert.equal(hashStringBun("friend-2026-401"), 3507176462);
});

test("rollUserId is deterministic for a known user id", () => {
  const result = rollUserId("buddy-legendary-anchor");

  assert.equal(result.rarity, "common");
  assert.equal(result.species, "robot");
  assert.equal(result.hat, "none");
  assert.equal(result.shiny, false);
  assert.deepEqual(result.stats, {
    DEBUGGING: 72,
    PATIENCE: 36,
    CHAOS: 24,
    WISDOM: 7,
    SNARK: 14,
  });
});

test("matchesFilters handles empty and strict filters", () => {
  const result = rollUserId("filter-check");

  assert.equal(matchesFilters(result, {}), true);
  assert.equal(matchesFilters(result, { species: result.species }), true);
  assert.equal(matchesFilters(result, { rarity: "legendary" }), result.rarity === "legendary");
  assert.equal(matchesFilters(result, { shiny: result.shiny ? "true" : "false" }), true);
  assert.equal(matchesFilters(result, { shiny: result.shiny ? "false" : "true" }), false);
});

test("search planning keeps the attempt limit global across workers", () => {
  assert.equal(getEffectiveWorkerCount(16, 1), 1);
  assert.equal(getEffectiveWorkerCount(4, 500000), 4);

  const localLimits = Array.from({ length: 16 }, (_, workerIndex) => calculateLocalLimit(1, workerIndex, 16));
  assert.equal(localLimits.reduce((sum, value) => sum + value, 0), 1);

  const spreadLimits = Array.from({ length: 4 }, (_, workerIndex) => calculateLocalLimit(10, workerIndex, 4));
  assert.equal(spreadLimits.reduce((sum, value) => sum + value, 0), 10);

  assert.equal(buildSequentialId("buddy-", 100, 0, 2, 4), "buddy-102");
  assert.equal(buildSequentialId("buddy-", 100, 3, 2, 4), "buddy-114");
});

test("getConfigStatus reports missing config cleanly", async () => {
  await withTempConfig(async () => {
    const status = await getConfigStatus();

    assert.equal(status.exists, false);
    assert.equal(status.parseError, null);
    assert.equal(status.currentUserId, null);
  });
});

test("getConfigStatus reports parse errors", async () => {
  await withTempConfig(async (configPath) => {
    await writeFile(configPath, "{broken json", "utf8");
    const status = await getConfigStatus();

    assert.equal(status.exists, true);
    assert.notEqual(status.parseError, null);
  });
});

test("getConfigStatus treats a valid non-object root as invalid config", async () => {
  await withTempConfig(async (configPath) => {
    await writeFile(configPath, "[]\n", "utf8");
    const status = await getConfigStatus();

    assert.equal(status.exists, true);
    assert.match(status.parseError ?? "", /JSON object/i);
  });
});

test("applyUserId backs up config and removes override fields", async () => {
  await withTempConfig(async (configPath) => {
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          userID: "old-id",
          companion: { cached: true },
          oauthAccount: {
            accountUuid: "uuid-1",
            accessToken: "keep-me",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await applyUserId({
      userId: "new-id",
      backup: true,
      removeCompanion: true,
      removeAccountUuid: true,
    });

    assert.equal(result.userId, "new-id");
    assert.notEqual(result.backupPath, null);

    const updated = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(updated.userID, "new-id");
    assert.equal("companion" in updated, false);
    assert.equal(updated.oauthAccount.accountUuid, undefined);
    assert.equal(updated.oauthAccount.accessToken, "keep-me");
  });
});

test("applyUserId rejects a valid non-object root without overwriting the file", async () => {
  await withTempConfig(async (configPath) => {
    const original = "[]\n";
    await writeFile(configPath, original, "utf8");

    await assert.rejects(
      applyUserId({
        userId: "new-id",
        backup: true,
        removeCompanion: true,
        removeAccountUuid: true,
      }),
      /JSON object/i,
    );

    assert.equal(await readFile(configPath, "utf8"), original);
  });
});

test("build-release creates the lightweight release files", async () => {
  await ensureReleaseBuilt();
  const names = (await readdir(distDir)).sort();

  for (const name of ["ClaudeBuddyLocal.html", "apply-userid.mjs", "apply-userid.ps1"]) {
    assert.equal(names.includes(name), true);
  }
});

test("dist/apply-userid.mjs runs standalone in an isolated directory and handles BOM configs", async () => {
  await ensureReleaseBuilt();

  await withTempDir(async (tempRoot) => {
    const configPath = path.join(tempRoot, ".claude.json");
    const scriptPath = path.join(tempRoot, "apply-userid.mjs");

    await copyFile(path.join(distDir, "apply-userid.mjs"), scriptPath);
    await writeFile(
      configPath,
      `\ufeff${JSON.stringify(
        {
          userID: "before",
          companion: { cached: true },
          oauthAccount: {
            accountUuid: "uuid-1",
            accessToken: "keep-me",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await runStandaloneNodeApplyScript(scriptPath, configPath, "buddy-standalone");

    const updated = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(updated.userID, "buddy-standalone");
    assert.equal("companion" in updated, false);
    assert.equal(updated.oauthAccount.accountUuid, undefined);
    assert.equal(updated.oauthAccount.accessToken, "keep-me");
  });
});

test("dist/apply-userid.mjs creates missing parent directories for CLAUDE_CONFIG_PATH", async () => {
  await ensureReleaseBuilt();

  await withTempDir(async (tempRoot) => {
    const configPath = path.join(tempRoot, "nested", "profile", ".claude.json");
    const scriptPath = path.join(tempRoot, "apply-userid.mjs");

    await copyFile(path.join(distDir, "apply-userid.mjs"), scriptPath);
    await runStandaloneNodeApplyScript(scriptPath, configPath, "buddy-nested");

    const updated = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(updated.userID, "buddy-nested");
  });
});

test("dist/apply-userid.mjs rejects a valid non-object root without clobbering the file", async () => {
  await ensureReleaseBuilt();

  await withTempDir(async (tempRoot) => {
    const configPath = path.join(tempRoot, ".claude.json");
    const scriptPath = path.join(tempRoot, "apply-userid.mjs");
    const original = "\"text\"\n";

    await copyFile(path.join(distDir, "apply-userid.mjs"), scriptPath);
    await writeFile(configPath, original, "utf8");
    await runStandaloneNodeApplyScript(scriptPath, configPath, "buddy-invalid-root", [], 1);

    assert.equal(await readFile(configPath, "utf8"), original);
  });
});

test("dist/apply-userid.ps1 works in Windows PowerShell and preserves existing fields", async () => {
  await ensureReleaseBuilt();

  await withTempDir(async (tempRoot) => {
    const configPath = path.join(tempRoot, ".claude.json");
    const scriptPath = path.join(tempRoot, "apply-userid.ps1");

    await copyFile(path.join(distDir, "apply-userid.ps1"), scriptPath);
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          userID: "before",
          companion: { cached: true },
          oauthAccount: {
            accountUuid: "uuid-1",
            accessToken: "keep-me",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const run = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-UserId", "buddy-powershell"],
      {
        cwd: tempRoot,
        env: { ...process.env, CLAUDE_CONFIG_PATH: configPath },
        encoding: "utf8",
      },
    );

    shouldSkipPowerShellIntegration(run, "dist/apply-userid.ps1 works in Windows PowerShell and preserves existing fields");

    assert.equal(run.status, 0, run.stderr || run.stdout);

    const updated = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(updated.userID, "buddy-powershell");
    assert.equal("companion" in updated, false);
    assert.equal(updated.oauthAccount.accountUuid, undefined);
    assert.equal(updated.oauthAccount.accessToken, "keep-me");
  });
});

test("dist/apply-userid.ps1 aborts on broken JSON without clobbering the file", async () => {
  await ensureReleaseBuilt();

  await withTempDir(async (tempRoot) => {
    const configPath = path.join(tempRoot, ".claude.json");
    const scriptPath = path.join(tempRoot, "apply-userid.ps1");
    const broken = "{broken json";

    await copyFile(path.join(distDir, "apply-userid.ps1"), scriptPath);
    await writeFile(configPath, broken, "utf8");

    const run = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-UserId", "should-fail"],
      {
        cwd: tempRoot,
        env: { ...process.env, CLAUDE_CONFIG_PATH: configPath },
        encoding: "utf8",
      },
    );

    shouldSkipPowerShellIntegration(run, "dist/apply-userid.ps1 aborts on broken JSON without clobbering the file");

    assert.notEqual(run.status, 0, "PowerShell script should fail on broken JSON");
    assert.equal(await readFile(configPath, "utf8"), broken);
  });
});

test("dist/apply-userid.ps1 rejects a valid non-object root without clobbering the file", async () => {
  await ensureReleaseBuilt();

  await withTempDir(async (tempRoot) => {
    const configPath = path.join(tempRoot, ".claude.json");
    const scriptPath = path.join(tempRoot, "apply-userid.ps1");
    const original = "null\n";

    await copyFile(path.join(distDir, "apply-userid.ps1"), scriptPath);
    await writeFile(configPath, original, "utf8");

    const run = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-UserId", "should-fail"],
      {
        cwd: tempRoot,
        env: { ...process.env, CLAUDE_CONFIG_PATH: configPath },
        encoding: "utf8",
      },
    );

    shouldSkipPowerShellIntegration(run, "dist/apply-userid.ps1 rejects a valid non-object root without clobbering the file");

    assert.notEqual(run.status, 0, "PowerShell script should fail on a non-object JSON root");
    assert.equal(await readFile(configPath, "utf8"), original);
  });
});

let failures = 0;
let skips = 0;

for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    if (error instanceof SkipTest) {
      skips += 1;
      console.log(`SKIP ${name}`);
      console.log(error.message);
    } else {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(error);
    }
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  const passed = tests.length - failures - skips;
  console.log(`Passed ${passed}/${tests.length} tests.${skips > 0 ? ` Skipped ${skips}.` : ""}`);
}
