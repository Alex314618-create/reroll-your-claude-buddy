import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");

function stripExports(source) {
  return source.replace(/^export\s+/gm, "");
}

function stripImports(source) {
  return source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\n/gm, "");
}

function buildInlineHtml() {
  const html = readFileSync(path.join(projectRoot, "app", "index.html"), "utf8");
  const css = readFileSync(path.join(projectRoot, "app", "styles.css"), "utf8");
  const messages = stripExports(readFileSync(path.join(projectRoot, "app", "messages.js"), "utf8"));
  const buddyCore = stripExports(readFileSync(path.join(projectRoot, "app", "shared", "buddy-core.js"), "utf8"));
  const searchPlan = stripExports(readFileSync(path.join(projectRoot, "app", "shared", "search-plan.js"), "utf8"));
  const worker = readFileSync(path.join(projectRoot, "app", "search-worker.js"), "utf8").replace(/^import .*$/gm, "");
  const app = stripImports(readFileSync(path.join(projectRoot, "app", "app.js"), "utf8"));
  const workerSource = `${buddyCore}\n${searchPlan}\n${worker}`;
  const script = `${messages}\n${buddyCore}\n${searchPlan}\nwindow.__CLAUDE_BUDDY_WORKER_SOURCE__ = ${JSON.stringify(workerSource)};\n${app}`;

  return html
    .replace('<link rel="stylesheet" href="./styles.css" />', `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="./app.js"></script>', `<script type="module">\n${script}\n</script>`);
}

function buildStandaloneNodeApplyScript() {
  const configStore = stripExports(readFileSync(path.join(projectRoot, "src", "config-store.mjs"), "utf8"));
  const cli = `
const args = process.argv.slice(2);
const userId = args.find((arg) => !arg.startsWith("--"));

if (!userId) {
  console.error("Usage: node apply-userid.mjs <userId> [--no-backup] [--keep-companion] [--keep-account-uuid]");
  process.exitCode = 1;
} else {
  try {
    const result = await applyUserId({
      userId,
      backup: !args.includes("--no-backup"),
      removeCompanion: !args.includes("--keep-companion"),
      removeAccountUuid: !args.includes("--keep-account-uuid"),
    });

    console.log(\`Applied \${result.userId}\`);
    if (result.backupPath) {
      console.log(\`Backup: \${result.backupPath}\`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
`;

  return `${configStore}\n${cli}`.trimStart();
}

function main() {
  mkdirSync(distDir, { recursive: true });

  for (const target of ["ClaudeBuddyLocal.html", "apply-userid.mjs", "apply-userid.ps1", "ClaudeBuddyLocal-release.zip"]) {
    const filePath = path.join(distDir, target);
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
    }
  }

  writeFileSync(path.join(distDir, "ClaudeBuddyLocal.html"), buildInlineHtml(), "utf8");
  writeFileSync(path.join(distDir, "apply-userid.mjs"), `${buildStandaloneNodeApplyScript()}\n`, "utf8");
  copyFileSync(path.join(projectRoot, "scripts", "apply-userid.ps1"), path.join(distDir, "apply-userid.ps1"));

  console.log(`Built ${path.join(distDir, "ClaudeBuddyLocal.html")}`);
}

main();
