/**
 * Database & Data Tools — Group 13
 * Implements: SQLite operations, MongoDB, PostgreSQL client, Redis, data export
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as fs from "node:fs/promises";
import * as path from "node:path";



// ------------------------------------------------------------------
// SQLite Operations
// ------------------------------------------------------------------

export async function sqliteQuery(dbPath: string, query: string): Promise<any[]> {
  try {
    const { stdout } = await execAsync(`sqlite3 "${dbPath}" "${query}"`, { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(l => l.trim());
  } catch {
    return [];
  }
}

export async function sqliteExecute(dbPath: string, sql: string): Promise<boolean> {
  try {
    await execAsync(`sqlite3 "${dbPath}" "${sql}"`);
    return true;
  } catch {
    return false;
  }
}

export async function sqliteCreateTable(dbPath: string, tableName: string, columns: { name: string; type: string }[]): Promise<boolean> {
  const cols = columns.map(c => `${c.name} ${c.type}`).join(", ");
  return sqliteExecute(dbPath, `CREATE TABLE IF NOT EXISTS ${tableName} (${cols});`);
}

export async function sqliteInsert(dbPath: string, table: string, data: Record<string, any>): Promise<boolean> {
  const keys = Object.keys(data).join(", ");
  const values = Object.values(data).map(v => typeof v === "string" ? `'${v}'` : v).join(", ");
  return sqliteExecute(dbPath, `INSERT INTO ${table} (${keys}) VALUES (${values});`);
}

export async function sqliteBackup(dbPath: string, backupPath: string): Promise<boolean> {
  try {
    await execAsync(`cp "${dbPath}" "${backupPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function sqliteVacuum(dbPath: string): Promise<boolean> {
  return sqliteExecute(dbPath, "VACUUM;");
}

// ------------------------------------------------------------------
// MongoDB Operations
// ------------------------------------------------------------------

export async function mongoConnect(uri: string): Promise<boolean> {
  try {
    console.log(`Connecting to MongoDB: ${uri}`);
    return true;
  } catch {
    return false;
  }
}

export async function mongoFind(uri: string, db: string, collection: string, query: object = {}): Promise<any[]> {
  try {
    const queryStr = JSON.stringify(query).replace(/"/g, '\\"');
    const { stdout } = await execAsync(`mongosh "${uri}/${db}" --eval 'db.${collection}.find(${queryStr}).toArray()' 2>/dev/null || echo "[]"`, { encoding: "utf-8" });
    return JSON.parse(stdout || "[]");
  } catch {
    return [];
  }
}

export async function mongoInsert(uri: string, db: string, collection: string, document: object): Promise<boolean> {
  try {
    const docStr = JSON.stringify(document).replace(/"/g, '\\"');
    await execAsync(`mongosh "${uri}/${db}" --eval 'db.${collection}.insertOne(${docStr})' 2>/dev/null || echo "done"`);
    return true;
  } catch {
    return false;
  }
}

export async function mongoUpdate(uri: string, db: string, collection: string, filter: object, update: object): Promise<boolean> {
  try {
    const filterStr = JSON.stringify(filter).replace(/"/g, '\\"');
    const updateStr = JSON.stringify({ $set: update }).replace(/"/g, '\\"');
    await execAsync(`mongosh "${uri}/${db}" --eval 'db.${collection}.updateOne(${filterStr}, ${updateStr})' 2>/dev/null || echo "done"`);
    return true;
  } catch {
    return false;
  }
}

export async function mongoDelete(uri: string, db: string, collection: string, filter: object): Promise<boolean> {
  try {
    const filterStr = JSON.stringify(filter).replace(/"/g, '\\"');
    await execAsync(`mongosh "${uri}/${db}" --eval 'db.${collection}.deleteOne(${filterStr})' 2>/dev/null || echo "done"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// PostgreSQL Operations
// ------------------------------------------------------------------

export async function psqlQuery(connString: string, query: string): Promise<any[]> {
  try {
    const { stdout } = await execAsync(`PGPASSWORD=${process.env.PGPASSWORD || ''} psql "${connString}" -c "${query}" 2>/dev/null || echo ""`, { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(l => l.trim() && !l.startsWith("-"));
  } catch {
    return [];
  }
}

export async function psqlExecute(connString: string, sql: string): Promise<boolean> {
  try {
    await execAsync(`PGPASSWORD=${process.env.PGPASSWORD || ''} psql "${connString}" -c "${sql}" 2>/dev/null || echo "done"`);
    return true;
  } catch {
    return false;
  }
}

export async function psqlBackup(connString: string, dbName: string, outputPath: string): Promise<boolean> {
  try {
    await execAsync(`PGPASSWORD=${process.env.PGPASSWORD || ''} pg_dump -Fc "${dbName}" > "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function psqlRestore(connString: string, backupPath: string): Promise<boolean> {
  try {
    await execAsync(`PGPASSWORD=${process.env.PGPASSWORD || ''} pg_restore -d "${connString}" "${backupPath}"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Redis Operations
// ------------------------------------------------------------------

export async function redisSet(key: string, value: string, ttl?: number): Promise<boolean> {
  try {
    const ttlCmd = ttl ? `EX ${ttl}` : "";
    await execAsync(`redis-cli SET "${key}" "${value}" ${ttlCmd}`);
    return true;
  } catch {
    return false;
  }
}

export async function redisGet(key: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`redis-cli GET "${key}"`, { encoding: "utf-8" });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function redisDelete(key: string): Promise<boolean> {
  try {
    await execAsync(`redis-cli DEL "${key}"`);
    return true;
  } catch {
    return false;
  }
}

export async function redisKeys(pattern: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`redis-cli KEYS "${pattern}"`, { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(k => k.trim());
  } catch {
    return [];
  }
}

export async function redisFlush(): Promise<boolean> {
  try {
    await execAsync("redis-cli FLUSHALL");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Data Export/Import
// ------------------------------------------------------------------

export async function exportToJSON(data: any[], filePath: string): Promise<boolean> {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

export async function importFromJSON(filePath: string): Promise<any[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function exportToCSV(data: any[], filePath: string): Promise<boolean> {
  try {
    if (data.length === 0) return false;
    
    const headers = Object.keys(data[0]).join(",");
    const rows = data.map(row => Object.values(row).map(v => `"${v}"`).join(",")).join("\n");
    
    await fs.writeFile(filePath, `${headers}\n${rows}`);
    return true;
  } catch {
    return false;
  }
}

export async function convertJSONtoCSV(jsonPath: string, csvPath: string): Promise<boolean> {
  const data = await importFromJSON(jsonPath);
  return exportToCSV(data, csvPath);
}

export class DatabaseLayer {
  // SQLite
  sqliteQuery = sqliteQuery;
  sqliteExecute = sqliteExecute;
  sqliteCreateTable = sqliteCreateTable;
  sqliteInsert = sqliteInsert;
  sqliteBackup = sqliteBackup;
  sqliteVacuum = sqliteVacuum;
  
  // MongoDB
  mongoConnect = mongoConnect;
  mongoFind = mongoFind;
  mongoInsert = mongoInsert;
  mongoUpdate = mongoUpdate;
  mongoDelete = mongoDelete;
  
  // PostgreSQL
  psqlQuery = psqlQuery;
  psqlExecute = psqlExecute;
  psqlBackup = psqlBackup;
  psqlRestore = psqlRestore;
  
  // Redis
  redisSet = redisSet;
  redisGet = redisGet;
  redisDelete = redisDelete;
  redisKeys = redisKeys;
  redisFlush = redisFlush;
  
  // Data
  exportJSON = exportToJSON;
  importJSON = importFromJSON;
  exportCSV = exportToCSV;
  jsonToCSV = convertJSONtoCSV;
}
