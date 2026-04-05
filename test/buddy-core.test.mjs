import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
  BUN_HASH_SELF_TESTS,
  hashStringBun,
  matchesFilters,
  rollUserId,
  verifyBunHashCompatibility,
  wyhash64,
} from "../app/shared/buddy-core.js";
import { buildSequentialId, calculateLocalLimit, getEffectiveWorkerCount } from "../app/shared/search-plan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const rootPortableExe = path.join(projectRoot, "ClaudeBuddyLocalPortable.exe");
const distPortableExe = path.join(distDir, "ClaudeBuddyLocalPortable.exe");
const distPortableZip = path.join(distDir, "ClaudeBuddyLocalPortable.zip");
const tests = [];
let portableBuilt = false;

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

async function ensurePortableBuilt() {
  if (portableBuilt) {
    return;
  }

  await import(`${pathToFileURL(path.join(projectRoot, "scripts", "build-portable.mjs")).href}?t=${Date.now()}`);
  portableBuilt = true;
}

function randomPort() {
  return 32000 + Math.floor(Math.random() * 2000);
}

function skipOnPortableSpawnError(error, name) {
  if (error?.code === "EPERM" || error?.code === "EACCES") {
    throw new SkipTest(`${name} (sandbox blocked portable spawn)`);
  }
}

async function waitForPortable(baseUrl, name) {
  let lastError = null;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (lastError) {
    skipOnPortableSpawnError(lastError, name);
  }

  throw new Error(`Portable host did not become ready for ${name}.`);
}

async function withPortable(run, options = {}) {
  await ensurePortableBuilt();

  await withTempDir(async (tempRoot) => {
    const configPath = options.configPath ?? path.join(tempRoot, ".claude.json");
    if (options.initialConfig !== undefined) {
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, options.initialConfig, "utf8");
    }

    const baseUrl = `http://127.0.0.1:${randomPort()}`;
    const child = spawn(rootPortableExe, [], {
      cwd: projectRoot,
      env: {
        ...process.env,
        BUDDY_PORTABLE_NO_BROWSER: "1",
        BUDDY_PORTABLE_PORT: baseUrl.split(":").pop(),
        CLAUDE_CONFIG_PATH: configPath,
      },
      stdio: "ignore",
    });

    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
    });

    try {
      if (spawnError) {
        skipOnPortableSpawnError(spawnError, options.name ?? "portable integration");
      }

      const health = await waitForPortable(baseUrl, options.name ?? "portable integration");
      await run({ baseUrl, configPath, tempRoot, health });
    } catch (error) {
      skipOnPortableSpawnError(spawnError ?? error, options.name ?? "portable integration");
      throw error;
    } finally {
      if (!child.killed) {
        child.kill();
      }
      await new Promise((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(resolve, 1000);
      });
    }
  });
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

test("build-portable creates a standalone exe in root", async () => {
  await ensurePortableBuilt();

  const rootStat = await stat(rootPortableExe);

  assert.equal(rootStat.size > 100000, true);
  await assert.rejects(stat(distPortableExe));
});

test("build-portable-zip creates a release zip without duplicating a dist exe", async () => {
  await import(`${pathToFileURL(path.join(projectRoot, "scripts", "build-portable-zip.mjs")).href}?t=${Date.now()}`);

  const zipStat = await stat(distPortableZip);
  assert.equal(zipStat.size > 100000, true);
  await assert.rejects(stat(distPortableExe));
});

test("portable health endpoint reports portable mode", async () => {
  await withPortable(async ({ health }) => {
    assert.equal(health.ok, true);
    assert.equal(health.portable, true);
  }, { name: "portable health endpoint reports portable mode" });
});

test("portable config status reports missing config cleanly", async () => {
  await withPortable(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/config/status`, { cache: "no-store" });
    const status = await response.json();

    assert.equal(response.ok, true);
    assert.equal(status.exists, false);
    assert.equal(status.parseError, null);
    assert.equal(status.currentUserId, null);
  }, { name: "portable config status reports missing config cleanly" });
});

test("portable apply preserves oauth access token and removes override fields", async () => {
  const initialConfig = `${JSON.stringify({
    userID: "before",
    companion: { cached: true },
    oauthAccount: {
      accountUuid: "uuid-1",
      accessToken: "keep-me",
    },
  }, null, 2)}\n`;

  await withPortable(async ({ baseUrl, configPath, tempRoot }) => {
    const response = await fetch(`${baseUrl}/api/apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: "buddy-portable",
        backup: true,
        removeCompanion: true,
        removeAccountUuid: true,
      }),
    });
    const payload = await response.json();

    assert.equal(response.ok, true);
    assert.equal(payload.ok, true);

    const updated = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(updated.userID, "buddy-portable");
    assert.equal("companion" in updated, false);
    assert.equal(updated.oauthAccount.accountUuid, undefined);
    assert.equal(updated.oauthAccount.accessToken, "keep-me");

    const backups = await readdir(tempRoot);
    assert.equal(backups.some((name) => name.startsWith(".claude.json.buddy-backup-")), true);
  }, {
    name: "portable apply preserves oauth access token and removes override fields",
    initialConfig,
  });
});

test("portable apply rejects a valid non-object root without clobbering the file", async () => {
  const original = "[]\n";

  await withPortable(async ({ baseUrl, configPath }) => {
    const response = await fetch(`${baseUrl}/api/apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: "should-fail",
        backup: true,
        removeCompanion: true,
        removeAccountUuid: true,
      }),
    });
    const payload = await response.json();

    assert.equal(response.ok, false);
    assert.equal(payload.ok, false);
    assert.match(payload.error ?? "", /JSON object/i);
    assert.equal(await readFile(configPath, "utf8"), original);
  }, {
    name: "portable apply rejects a valid non-object root without clobbering the file",
    initialConfig: original,
  });
});

test("portable apply handles BOM configs and can create nested config directories", async () => {
  await withTempDir(async (tempRoot) => {
    const configPath = path.join(tempRoot, "nested", "profile", ".claude.json");
    const initialConfig = `\ufeff${JSON.stringify({
      oauthAccount: {
        accountUuid: "uuid-1",
        accessToken: "keep-me",
      },
    }, null, 2)}\n`;

    await withPortable(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "buddy-bom",
          backup: false,
          removeCompanion: true,
          removeAccountUuid: true,
        }),
      });
      const payload = await response.json();

      assert.equal(response.ok, true);
      assert.equal(payload.ok, true);

      const updated = JSON.parse(await readFile(configPath, "utf8"));
      assert.equal(updated.userID, "buddy-bom");
      assert.equal(updated.oauthAccount.accountUuid, undefined);
      assert.equal(updated.oauthAccount.accessToken, "keep-me");
    }, {
      name: "portable apply handles BOM configs and can create nested config directories",
      configPath,
      initialConfig,
    });
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
