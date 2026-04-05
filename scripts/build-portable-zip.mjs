import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const cargoTargetDir = path.join(projectRoot, "build", "cargo-target");
const distDir = path.join(projectRoot, "dist");
const portableExe = path.join(cargoTargetDir, "release", "claude_buddy_portable.exe");
const zipPath = path.join(distDir, "ClaudeBuddyLocalPortable.zip");

execFileSync(process.execPath, [path.join(projectRoot, "scripts", "build-portable.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (existsSync(zipPath)) {
  rmSync(zipPath, { force: true });
}

execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `try { if (Test-Path -LiteralPath '${zipPath}') { Remove-Item -LiteralPath '${zipPath}' -Force -ErrorAction Stop }; Compress-Archive -Path '${portableExe}' -DestinationPath '${zipPath}' -Force -ErrorAction Stop } catch { Write-Error $_; exit 1 }`,
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
  },
);

if (!existsSync(zipPath)) {
  throw new Error(`Portable zip was not created at ${zipPath}`);
}

console.log(`Built ${zipPath}`);
