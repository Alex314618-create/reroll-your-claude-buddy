import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const portableDir = path.join(distDir, "portable");
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
    `Compress-Archive -Path '${path.join(portableDir, "*")}' -DestinationPath '${zipPath}' -Force`,
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
