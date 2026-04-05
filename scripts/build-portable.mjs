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

  try {
    cpSync(buildExe, rootPortableExe);
    console.log(`Updated ${rootPortableExe}`);
  } catch (error) {
    if (["EPERM", "EACCES", "EBUSY", "EIO"].includes(error?.code)) {
      console.warn(`Portable build succeeded, but the root exe is in use: ${rootPortableExe}`);
      console.warn("Close the running Portable app and rebuild if you want to refresh the visible root exe.");
      return;
    }

    throw error;
  }

}

main();
