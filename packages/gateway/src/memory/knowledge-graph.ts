import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger.js";
import type { MemoryEntry } from "../session/memory-pal.js";

export interface KGEntity {
  id: string;
  type: "app" | "person" | "location" | "project" | "device" | "preference" | "credential";
  name: string;
  properties: Record<string, string>;
  confidence: number;
  source: "user" | "inferred" | "memory-pal";
  updatedAt: string;
}

export interface KGRelation {
  id: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  confidence: number;
  source: "user" | "inferred" | "memory-pal";
  updatedAt: string;
}

export class KnowledgeGraph {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  addEntity(e: Omit<KGEntity, "id" | "updatedAt">): string {
    const id = uuid();
    this.db
      .prepare(
        `INSERT INTO kg_entities (id, type, name, properties_json, confidence, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(id, e.type, e.name, JSON.stringify(e.properties), e.confidence, e.source);
    return id;
  }

  addRelation(r: Omit<KGRelation, "id" | "updatedAt">): string {
    const id = uuid();
    this.db
      .prepare(
        `INSERT INTO kg_relations (id, subject_id, predicate, object_id, confidence, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(id, r.subjectId, r.predicate, r.objectId, r.confidence, r.source);
    return id;
  }

  findEntity(query: { type?: KGEntity["type"]; name?: string }): KGEntity[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.type) {
      conditions.push("type = ?");
      params.push(query.type);
    }
    if (query.name) {
      conditions.push("name LIKE ?");
      params.push(`%${query.name}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM kg_entities ${where} ORDER BY confidence DESC`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map(rowToEntity);
  }

  getRelated(
    entityId: string,
    predicate?: string,
  ): Array<{ relation: KGRelation; entity: KGEntity }> {
    const predicateClause = predicate ? "AND r.predicate = ?" : "";
    const params: unknown[] = predicate
      ? [entityId, entityId, predicate]
      : [entityId, entityId];

    const rows = this.db
      .prepare(
        `SELECT
           r.id AS r_id, r.subject_id, r.predicate, r.object_id,
           r.confidence AS r_confidence, r.source AS r_source, r.updated_at AS r_updated_at,
           e.id AS e_id, e.type AS e_type, e.name AS e_name,
           e.properties_json, e.confidence AS e_confidence,
           e.source AS e_source, e.updated_at AS e_updated_at
         FROM kg_relations r
         JOIN kg_entities e
           ON (r.subject_id = ? AND r.object_id = e.id)
           OR (r.object_id = ? AND r.subject_id = e.id)
         ${predicateClause}
         ORDER BY r.confidence DESC`,
      )
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      relation: {
        id: row["r_id"] as string,
        subjectId: row["subject_id"] as string,
        predicate: row["predicate"] as string,
        objectId: row["object_id"] as string,
        confidence: row["r_confidence"] as number,
        source: row["r_source"] as KGRelation["source"],
        updatedAt: row["r_updated_at"] as string,
      },
      entity: {
        id: row["e_id"] as string,
        type: row["e_type"] as KGEntity["type"],
        name: row["e_name"] as string,
        properties: safeParseJson(row["properties_json"] as string),
        confidence: row["e_confidence"] as number,
        source: row["e_source"] as KGEntity["source"],
        updatedAt: row["e_updated_at"] as string,
      },
    }));
  }

  resolveReference(text: string): KGEntity | null {
    const words = text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (words.length === 0) return null;

    const rows = this.db
      .prepare("SELECT * FROM kg_entities ORDER BY confidence DESC")
      .all() as Array<Record<string, unknown>>;

    let best: KGEntity | null = null;
    let bestScore = 0;

    for (const row of rows) {
      const entity = rowToEntity(row);
      const nameLower = entity.name.toLowerCase();
      const textLower = text.toLowerCase();

      // Full name match gets highest score
      if (textLower.includes(nameLower)) {
        const score = entity.confidence + nameLower.length / 100;
        if (score > bestScore) {
          bestScore = score;
          best = entity;
        }
        continue;
      }

      // Word-level match
      const nameWords = nameLower.split(/\s+/);
      const matchCount = nameWords.filter((nw) => words.includes(nw)).length;
      if (matchCount > 0) {
        const score = (matchCount / nameWords.length) * entity.confidence;
        if (score > bestScore) {
          bestScore = score;
          best = entity;
        }
      }
    }

    return best;
  }

  importFromMemoryPal(entries: MemoryEntry[]): { entities: number; relations: number } {
    let entityCount = 0;
    let relationCount = 0;

    const personEntities: Map<string, string> = new Map(); // key -> entityId

    const insert = this.db.transaction(() => {
      for (const entry of entries) {
        const category = entry.category;

        if (category === "password") {
          const id = this.addEntity({
            type: "credential",
            name: entry.key,
            properties: { value: entry.sensitive ? "••••••••" : entry.value },
            confidence: 1.0,
            source: "memory-pal",
          });
          entityCount++;
          logger.debug(`[kg] imported credential: ${id}`);
        } else if (category === "contact") {
          const id = this.addEntity({
            type: "person",
            name: entry.key,
            properties: { contact: entry.value },
            confidence: 1.0,
            source: "memory-pal",
          });
          personEntities.set(entry.key, id);
          entityCount++;
        } else if (category === "address") {
          const locId = this.addEntity({
            type: "location",
            name: entry.key,
            properties: { address: entry.value },
            confidence: 1.0,
            source: "memory-pal",
          });
          entityCount++;

          // Try to link to a person if the key contains a known contact name
          for (const [personKey, personId] of personEntities) {
            if (entry.key.toLowerCase().includes(personKey.toLowerCase())) {
              this.addRelation({
                subjectId: personId,
                predicate: "HAS_ADDRESS",
                objectId: locId,
                confidence: 0.9,
                source: "memory-pal",
              });
              relationCount++;
            }
          }
        } else if (category === "birthday") {
          // Upsert as property on existing person or create new person entity
          const existing = personEntities.get(entry.key);
          if (existing) {
            // Add birthday as property by re-inserting with merged props — simplest approach:
            // create a new entity representing the birthday fact
            const rows = this.db
              .prepare("SELECT properties_json FROM kg_entities WHERE id = ?")
              .get(existing) as { properties_json: string } | undefined;
            if (rows) {
              const props = safeParseJson(rows.properties_json);
              props["birthday"] = entry.value;
              this.db
                .prepare("UPDATE kg_entities SET properties_json = ?, updated_at = datetime('now') WHERE id = ?")
                .run(JSON.stringify(props), existing);
            }
          } else {
            const id = this.addEntity({
              type: "person",
              name: entry.key,
              properties: { birthday: entry.value },
              confidence: 1.0,
              source: "memory-pal",
            });
            personEntities.set(entry.key, id);
            entityCount++;
          }
        } else if (category === "preference") {
          this.addEntity({
            type: "preference",
            name: entry.key,
            properties: { value: entry.value },
            confidence: 1.0,
            source: "memory-pal",
          });
          entityCount++;
        } else if (category === "note") {
          // Infer type from key — simple heuristics
          const keyLower = entry.key.toLowerCase();
          const inferredType: KGEntity["type"] = keyLower.includes("app")
            ? "app"
            : keyLower.includes("project")
              ? "project"
              : keyLower.includes("device")
                ? "device"
                : "preference";

          this.addEntity({
            type: inferredType,
            name: entry.key,
            properties: { note: entry.value },
            confidence: 0.8,
            source: "memory-pal",
          });
          entityCount++;
        }
      }
    });

    insert();

    return { entities: entityCount, relations: relationCount };
  }

  toContextSnippet(relevantEntities: KGEntity[], maxTokens = 1500): string {
    const lines: string[] = [];
    // Approximate 4 chars per token
    const charLimit = maxTokens * 4;
    let totalChars = 0;

    for (const e of relevantEntities) {
      const propsStr = Object.entries(e.properties)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      const line = `Entity: ${e.name} (${e.type})${propsStr ? ` — ${propsStr}` : ""}`;
      if (totalChars + line.length > charLimit) break;
      lines.push(line);
      totalChars += line.length + 1;
    }

    return lines.join("\n");
  }
}

function rowToEntity(row: Record<string, unknown>): KGEntity {
  return {
    id: row["id"] as string,
    type: row["type"] as KGEntity["type"],
    name: row["name"] as string,
    properties: safeParseJson(row["properties_json"] as string),
    confidence: row["confidence"] as number,
    source: row["source"] as KGEntity["source"],
    updatedAt: row["updated_at"] as string,
  };
}

function safeParseJson(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, string>;
  } catch {
    // ignore
  }
  return {};
}
