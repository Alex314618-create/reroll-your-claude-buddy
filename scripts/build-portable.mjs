import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const cargoManifest = path.join(projectRoot, "native", "claude_buddy_portable", "Cargo.toml");
const cargoTargetDir = path.join(projectRoot, "build", "cargo-target");
const distDir = path.join(projectRoot, "dist");
const rootPortableExe = path.join(projectRoot, "ClaudeBuddyLocalPortable.exe");
const buildExe = path.join(cargoTargetDir, "release", "claude_buddy_portable.exe");
const staleDistFiles = [
  path.join(distDir, "ClaudeBuddyLocalPortable.exe"),
];

function cleanDir(target) {
  if (!existsSync(target)) {
    return;
  }

  try {
    rmSync(target, { recursive: true, force: true });
  } catch (error) {
    if (error?.code === "EPERM") {
      throw new Error(`Cannot rebuild while ${target} is in use. Close the running Portable app and try again.`);
    }

    throw error;
  }
}

function main() {
  for (const target of staleDistFiles) {
    cleanDir(target);
  }
  mkdirSync(cargoTargetDir, { recursive: true });
  mkdirSync(distDir, { recursive: true });

  execFileSync(
    "cargo",
    [
      "build",
      "--manifest-path",
      cargoManifest,
      "--release",
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: cargoTargetDir,
      },
      stdio: "inherit",
    },
  );

  cpSync(buildExe, rootPortableExe);

  console.log(`Updated ${rootPortableExe}`);
}

main();
