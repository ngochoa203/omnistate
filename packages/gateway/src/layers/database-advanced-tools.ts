/**
 * Database Advanced Tools — PostgreSQL, MySQL, Redis, MongoDB.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// PostgreSQL
export async function pgListDatabases(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`psql -l -t -F '|' 2>/dev/null || echo ""`, { encoding: "utf-8" });
    return stdout.split("\n").filter(l => l.trim()).map(l => l.split("|")[0]?.trim() || "").filter(Boolean);
  } catch { return []; }
}

export async function pgListTables(database: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`psql -d "${database}" -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public'" 2>/dev/null || echo ""`, { encoding: "utf-8" });
    return stdout.split("\n").map(l => l.trim()).filter(Boolean);
  } catch { return []; }
}

export async function pgBackup(database: string, outputPath: string): Promise<boolean> { try { await execAsync(`pg_dump -Fc "${database}" -f "${outputPath}"`); return true; } catch { return false; } }
export async function pgRestore(backupPath: string, targetDatabase: string): Promise<boolean> { try { await execAsync(`pg_restore -d "${targetDatabase}" "${backupPath}"`); return true; } catch { return false; } }

// MySQL
export async function mysqlListDatabases(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`mysql -e "SHOW DATABASES" -t 2>/dev/null || echo ""`, { encoding: "utf-8" });
    return stdout.split("\n").filter(l => l.trim()).filter(l => l !== "Database");
  } catch { return []; }
}

export async function mysqlListTables(database: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`mysql -D "${database}" -e "SHOW TABLES" -t 2>/dev/null || echo ""`, { encoding: "utf-8" });
    return stdout.split("\n").map(l => l.trim()).filter(Boolean);
  } catch { return []; }
}

export async function mysqlBackup(database: string, outputPath: string): Promise<boolean> { try { await execAsync(`mysqldump "${database}" > "${outputPath}"`); return true; } catch { return false; } }
export async function mysqlRestore(backupPath: string, database: string): Promise<boolean> { try { await execAsync(`mysql "${database}" < "${backupPath}"`); return true; } catch { return false; } }

// Redis
export async function redisListKeys(pattern = "*", limit = 100): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`redis-cli --scan --pattern "${pattern}" | head -${limit}`, { encoding: "utf-8" });
    return stdout.split("\n").filter(Boolean);
  } catch { return []; }
}

export async function redisGet(key: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`redis-cli GET "${key}"`, { encoding: "utf-8" });
    return stdout.trim() || null;
  } catch { return null; }
}

export async function redisSet(key: string, value: string, ttl?: number): Promise<boolean> {
  try {
    const t = ttl ? `EX ${ttl}` : "";
    await execAsync(`redis-cli SET "${key}" "${value}" ${t}`);
    return true;
  } catch { return false; }
}

export async function redisFlush(pattern?: string): Promise<boolean> {
  try {
    if (pattern) {
      await execAsync(`redis-cli --scan --pattern "${pattern}" | xargs redis-cli DEL`);
    } else {
      await execAsync(`redis-cli FLUSHALL`);
    }
    return true;
  } catch { return false; }
}

export async function redisInfo(): Promise<Record<string, string>> {
  try {
    const { stdout } = await execAsync(`redis-cli INFO`, { encoding: "utf-8" });
    const info: Record<string, string> = {};
    stdout.split("\n").forEach(line => { if (line.includes(":")) { const [key, value] = line.split(":"); info[key] = value; } });
    return info;
  } catch { return {}; }
}

// MongoDB
export async function mongoListCollections(database: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`mongosh --quiet --eval "db.getMongo().getDB('${database}').getCollectionNames().join('\\n')" 2>/dev/null || echo ""`, { encoding: "utf-8" });
    return stdout.split("\n").filter(Boolean);
  } catch { return []; }
}

export async function mongoBackup(database: string, outputPath: string): Promise<boolean> { try { await execAsync(`mongodump --db "${database}" --out "${outputPath}"`); return true; } catch { return false; } }
export async function mongoRestore(backupPath: string, database: string): Promise<boolean> { try { await execAsync(`mongorestore --db "${database}" "${backupPath}/${database}"`); return true; } catch { return false; } }

export class DatabaseAdvancedLayer {
  pgListDatabases = pgListDatabases; pgListTables = pgListTables; pgBackup = pgBackup; pgRestore = pgRestore;
  mysqlListDatabases = mysqlListDatabases; mysqlListTables = mysqlListTables; mysqlBackup = mysqlBackup; mysqlRestore = mysqlRestore;
  redisListKeys = redisListKeys; redisGet = redisGet; redisSet = redisSet; redisFlush = redisFlush; redisInfo = redisInfo;
  mongoListCollections = mongoListCollections; mongoBackup = mongoBackup; mongoRestore = mongoRestore;
}
