import { applyUserId } from "../src/config-store.mjs";

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

    console.log(`Applied ${result.userId}`);
    if (result.backupPath) {
      console.log(`Backup: ${result.backupPath}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
