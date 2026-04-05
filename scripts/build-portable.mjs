import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const desktopProject = path.join(projectRoot, "desktop", "ClaudeBuddyPortable", "ClaudeBuddyPortable.csproj");
const buildDir = path.join(projectRoot, "build", "portable-publish");
const dotnetHome = path.join(projectRoot, "build", "dotnet-home");
const nugetPackages = path.join(projectRoot, "build", "nuget-packages");
const distDir = path.join(projectRoot, "dist");
const portableDir = path.join(distDir, "portable");
const rootPortableExe = path.join(projectRoot, "ClaudeBuddyLocalPortable.exe");

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
  cleanDir(buildDir);
  cleanDir(portableDir);
  mkdirSync(buildDir, { recursive: true });
  mkdirSync(dotnetHome, { recursive: true });
  mkdirSync(nugetPackages, { recursive: true });
  mkdirSync(portableDir, { recursive: true });

  execFileSync(
    "dotnet",
    [
      "publish",
      desktopProject,
      "-c",
      "Release",
      "-r",
      "win-x64",
      "--self-contained",
      "true",
      "-o",
      buildDir,
      "/p:RestoreIgnoreFailedSources=true",
      "/p:NuGetAudit=false",
      "/p:PublishSingleFile=true",
      "/p:EnableCompressionInSingleFile=true",
      "/p:DebugType=None",
      "/p:DebugSymbols=false",
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        DOTNET_CLI_HOME: dotnetHome,
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
        NUGET_PACKAGES: nugetPackages,
      },
      stdio: "inherit",
    },
  );

  const builtExe = path.join(buildDir, "ClaudeBuddyLocalPortable.exe");
  const portableExe = path.join(portableDir, "ClaudeBuddyLocalPortable.exe");
  cpSync(builtExe, portableExe);
  cpSync(builtExe, rootPortableExe);

  console.log(`Built ${portableExe}`);
  console.log(`Updated ${rootPortableExe}`);
}

main();
