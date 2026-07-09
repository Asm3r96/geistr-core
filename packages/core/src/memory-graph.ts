import type { MemoryLinkType, MemoryRecord, MemoryType, SqliteDatabase } from "./session-persistence";
import { ensureSessionSchema } from "./session-persistence";

type Row = Record<string, unknown>;

export interface MemoryGraphNode {
  id: string;
  content: string;
  memoryType: MemoryType;
  category: string;
  status: "active" | "cold";
  importance: number;
  stability: number;
  currentStrength: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sourceSessionId: string | null;
  sourceMessageId: string | null;
  recallCount: number;
}

export interface MemoryGraphLink {
  id: string;
  source: string;
  target: string;
  linkType: MemoryLinkType;
  strength: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryGraphStats {
  totalMemories: number;
  activeCount: number;
  coldCount: number;
  linkCount: number;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  links: MemoryGraphLink[];
  stats: MemoryGraphStats;
}

export interface GetMemoryGraphOptions {
  /** Cap nodes returned (newest by updated_at). Default 2500. */
  maxNodes?: number;
}

export function getMemoryGraph(db: SqliteDatabase, options: GetMemoryGraphOptions = {}): MemoryGraph {
  ensureSessionSchema(db);
  const maxNodes = Math.max(1, Math.min(10_000, Math.trunc(options.maxNodes ?? 2500)));
  const rows = db
    .prepare(
      `SELECT * FROM memory_items
       WHERE status IN ('active', 'cold')
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(maxNodes) as Row[];

  const nodes = rows.map(rowToGraphNode);
  const nodeIds = new Set(nodes.map((n) => n.id));
  let activeCount = 0;
  let coldCount = 0;
  for (const node of nodes) {
    if (node.status === "active") activeCount += 1;
    else coldCount += 1;
  }

  const ids = [...nodeIds];
  const placeholders = ids.map(() => "?").join(",");
  const linkRows = ids.length === 0
    ? []
    : (db
        .prepare(
          `SELECT id, from_memory_id, to_memory_id, link_type, strength, created_at, updated_at
           FROM memory_links
           WHERE from_memory_id IN (${placeholders}) AND to_memory_id IN (${placeholders})`,
        )
        .all(...ids, ...ids) as Row[]);

  const links: MemoryGraphLink[] = [];
  const seen = new Set<string>();
  for (const row of linkRows) {
    const source = asString(row.from_memory_id);
    const target = asString(row.to_memory_id);
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) continue;
    const linkType = asString(row.link_type) as MemoryLinkType;
    const key = `${source}|${target}|${linkType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      id: asString(row.id),
      source,
      target,
      linkType,
      strength: asNumber(row.strength, 5),
      createdAt: asNumber(row.created_at),
      updatedAt: asNumber(row.updated_at),
    });
  }

  return {
    nodes,
    links,
    stats: {
      totalMemories: nodes.length,
      activeCount,
      coldCount,
      linkCount: links.length,
    },
  };
}

function rowToGraphNode(row: Row): MemoryGraphNode {
  const record = rowToMemoryRecord(row);
  return {
    id: record.id,
    content: record.content,
    memoryType: record.memoryType,
    category: record.category,
    status: record.status === "cold" ? "cold" : "active",
    importance: record.importance,
    stability: record.stability,
    currentStrength: record.currentStrength,
    tags: record.tags,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sourceSessionId: record.sourceSessionId,
    sourceMessageId: record.sourceMessageId,
    recallCount: record.recallCount,
  };
}

function rowToMemoryRecord(row: Row): MemoryRecord {
  return {
    id: asString(row.id),
    content: asString(row.content),
    category: asString(row.category),
    memoryType: normalizeMemoryType(row.memory_type) ?? "fact",
    importance: asNumber(row.importance, 5),
    stability: asNumber(row.stability, 5),
    currentStrength: asNumber(row.current_strength, 5),
    status: normalizeStatus(row.status) ?? "active",
    tags: parseTags(row.tags_json),
    threadId: nullableString(row.thread_id),
    sourceSessionId: nullableString(row.source_session_id),
    sourceMessageId: nullableString(row.source_message_id),
    supersededByMemoryId: nullableString(row.superseded_by_memory_id),
    recallCount: asNumber(row.recall_count),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

const MEMORY_TYPES = new Set<MemoryType>(["fact", "preference", "goal", "episode", "person_context", "lesson"]);

function normalizeMemoryType(value: unknown): MemoryType | null {
  return MEMORY_TYPES.has(value as MemoryType) ? (value as MemoryType) : null;
}

function normalizeStatus(value: unknown): MemoryRecord["status"] | null {
  const s = asString(value);
  return s === "active" || s === "cold" || s === "deleted" ? s : null;
}

function parseTags(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}