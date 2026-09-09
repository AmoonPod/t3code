// @effect-diagnostics nodeBuiltinImport:off
/**
 * Reads usage records from OpenCode's on-disk message store.
 *
 * OpenCode keeps every session message as a row of the `message` table in
 * `<data dir>/opencode.db`, each row carrying its payload as a JSON document.
 * Unlike the other providers' append-only JSONL transcripts there is nothing to
 * resume or memoise: the window filter runs in SQL and a cold read of a
 * months-deep store is cheap, so each scan opens the database read-only, folds
 * the eligible rows through `parseOpenCodeMessageData`, and closes it.
 *
 * The read is concurrent-safe with a running OpenCode: WAL mode lets read-only
 * connections proceed while OpenCode writes. The result distinguishes "no
 * store on this machine" (an ordinary state, like a missing transcript
 * directory) from "the store could not be read" (a failure the page should
 * surface) because the source status they produce differs.
 *
 * @module opencodeUsageStore
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeSqlite from "node:sqlite";

import { parseOpenCodeMessageData, type UsageRecord } from "./usageTranscripts.ts";

export type OpenCodeStoreRead =
  | { readonly kind: "ok"; readonly records: readonly UsageRecord[] }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string };

/** Node filesystem and SQLite errors carry a stable `code`. */
function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/** Bounds an error for the wire: `UsageSource.message` is a short user-facing string. */
function failureMessage(error: unknown): string {
  const code = errorCode(error);
  const detail = error instanceof Error ? error.message : String(error);
  return `OpenCode store read failed${code ? ` (${code})` : ""}: ${detail.slice(0, 160)}`;
}

/**
 * Reads every assistant message row at or after `sinceMs`, oldest first.
 *
 * A row whose payload no longer parses (an older or newer OpenCode writing an
 * unexpected shape) is skipped individually, mirroring how the JSONL parsers
 * treat unrecognised lines, so one odd row cannot blank out the provider.
 */
export async function readOpenCodeUsageRecords(
  dbPath: string,
  sinceMs: number,
): Promise<OpenCodeStoreRead> {
  try {
    await NodeFSP.stat(dbPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "failed", message: failureMessage(error) };
  }

  let database: NodeSqlite.DatabaseSync;
  try {
    database = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    return { kind: "failed", message: failureMessage(error) };
  }

  try {
    const rows = database
      .prepare("SELECT session_id, data FROM message WHERE time_created >= ? ORDER BY time_created")
      .all(sinceMs);
    const records: UsageRecord[] = [];
    for (const row of rows) {
      const { session_id: sessionId, data } = row as { session_id: unknown; data: unknown };
      if (typeof data !== "string") continue;
      const record = parseOpenCodeMessageData(data, typeof sessionId === "string" ? sessionId : "");
      if (record !== null) records.push(record);
    }
    return { kind: "ok", records };
  } catch (error) {
    return { kind: "failed", message: failureMessage(error) };
  } finally {
    database.close();
  }
}
