import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const zipPath = path.join(distDir, "ClaudeBuddyLocal-release.zip");

execFileSync(process.execPath, [path.join(projectRoot, "scripts", "build-release.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (existsSync(zipPath)) {
  rmSync(zipPath, { force: true });
}

execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -LiteralPath '${path.join(distDir, "ClaudeBuddyLocal.html")}', '${path.join(distDir, "apply-userid.ps1")}', '${path.join(distDir, "apply-userid.mjs")}' -DestinationPath '${zipPath}' -Force`,
], {
  cwd: projectRoot,
  stdio: "inherit",
});

console.log(`Built ${zipPath}`);
