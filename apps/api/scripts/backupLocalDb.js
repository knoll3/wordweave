const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dataDir = path.resolve(__dirname, "..", "data");
const sourcePath = path.join(dataDir, "craft.db");
const backupDir = path.join(dataDir, "backups");

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

async function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source database not found: ${sourcePath}`);
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const label = process.argv[2]?.trim();
  const safeLabel = label ? `.${label.replace(/[^a-zA-Z0-9._-]+/g, "-")}` : "";
  const backupPath = path.join(
    backupDir,
    `craft.db.${formatTimestamp(new Date())}${safeLabel}.bak`
  );

  if (fs.existsSync(backupPath)) {
    throw new Error(`Refusing to overwrite existing backup: ${backupPath}`);
  }

  const sourceDb = new Database(sourcePath, { fileMustExist: true });

  try {
    await sourceDb.backup(backupPath);
  } finally {
    sourceDb.close();
  }

  const stats = fs.statSync(backupPath);
  console.log(`Source DB: ${sourcePath}`);
  console.log(`Backup DB: ${backupPath}`);
  console.log(`Backup size: ${stats.size} bytes`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
