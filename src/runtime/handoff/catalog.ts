import * as fs from 'fs';
import * as path from 'path';

import { getAdapters } from './adapters';
import type {
  HandoffListResult,
  HandoffSource,
  SessionCatalogEntry,
  SessionCatalogV1,
  SessionSummary,
} from './types';
import {
  atomicWriteFileSync,
  hashText,
  listJsonlFiles,
  pathsMatch,
  resolveHandoffCacheDir,
} from './utils';

function resolveCatalogPath(): string {
  return path.join(resolveHandoffCacheDir(), 'handoff-catalog-v1.json');
}

function readCatalog(): SessionCatalogV1 {
  const catalogPath = resolveCatalogPath();
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as SessionCatalogV1;
    if (
      parsed.version === 1 &&
      parsed.inspectorVersion === 3 &&
      parsed.entries &&
      typeof parsed.entries === 'object'
    )
      return parsed;
  } catch {
    // Missing or invalid caches are safely rebuilt from source files.
  }
  return { version: 1, inspectorVersion: 3, updatedAt: new Date(0).toISOString(), entries: {} };
}

function cacheKey(source: HandoffSource, sourcePath: string): string {
  const normalized = process.platform === 'win32' ? sourcePath.toLowerCase() : sourcePath;
  return `${source}:${normalized}`;
}

function refreshAdapterEntries(
  catalog: SessionCatalogV1,
  source: HandoffSource,
  root: string,
  inspect: (filePath: string) => SessionSummary | undefined,
  enrich?: (session: SessionSummary) => SessionSummary
): void {
  const files = listJsonlFiles(root);
  const currentKeys = new Set<string>();
  for (const filePath of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    const key = cacheKey(source, filePath);
    currentKeys.add(key);
    const cached = catalog.entries[key];
    if (cached && cached.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
      if (enrich) cached.summary = enrich(cached.summary);
      continue;
    }
    try {
      const summary = inspect(filePath);
      if (!summary) continue;
      const entry: SessionCatalogEntry = {
        source,
        sourcePath: filePath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        summary,
      };
      catalog.entries[key] = entry;
    } catch {
      // One unreadable provider record should not hide the rest of the catalog.
    }
  }

  for (const [key, entry] of Object.entries(catalog.entries)) {
    if (entry.source === source && !currentKeys.has(key)) delete catalog.entries[key];
  }
}

export function listSessions(args: {
  projectPath?: string;
  sources?: HandoffSource[];
  allProjects?: boolean;
  limit?: number;
  includeCurrent?: boolean;
}): HandoffListResult {
  const adapters = getAdapters(args.sources);
  const catalog = readCatalog();
  for (const adapter of adapters) {
    refreshAdapterEntries(
      catalog,
      adapter.source,
      adapter.resolveRoot(),
      filePath => adapter.inspect(filePath),
      adapter.enrichSummary ? session => adapter.enrichSummary!(session) : undefined
    );
  }
  catalog.updatedAt = new Date().toISOString();
  atomicWriteFileSync(resolveCatalogPath(), `${JSON.stringify(catalog, null, 2)}\n`);

  const allowedSources = new Set(adapters.map(adapter => adapter.source));
  const filtered = Object.values(catalog.entries)
    .map(entry => entry.summary)
    .filter(session => allowedSources.has(session.source))
    .filter(
      session =>
        args.allProjects === true || !args.projectPath || pathsMatch(session.cwd, args.projectPath)
    )
    .filter(
      session =>
        args.includeCurrent === true ||
        session.source !== 'codex' ||
        !process.env.CODEX_THREAD_ID ||
        session.sessionId !== process.env.CODEX_THREAD_ID
    )
    .sort((left, right) => {
      const byTime = right.updatedAt.localeCompare(left.updatedAt);
      if (byTime !== 0) return byTime;
      return left.sessionId.localeCompare(right.sessionId);
    })
    .slice(0, Math.max(1, args.limit ?? 20))
    .map((session, index) => ({ ...session, selection: index + 1 }));

  const listId = hashText(
    filtered
      .map(session => `${session.source}:${session.sessionId}:${session.updatedAt}`)
      .join('\n')
  ).slice(0, 16);

  return {
    sessions: filtered,
    listId,
    projectPath: args.allProjects === true ? undefined : args.projectPath,
    scannedSources: adapters.map(adapter => adapter.source),
  };
}

export function resolveSessionSelection(args: {
  projectPath?: string;
  sources?: HandoffSource[];
  allProjects?: boolean;
  limit?: number;
  includeCurrent?: boolean;
  selection?: number;
  sessionId?: string;
  listId?: string;
}): { session: SessionSummary; list: HandoffListResult } {
  const list = listSessions(args);
  if (args.listId && args.listId !== list.listId) {
    throw new Error(
      `Session list changed (expected ${args.listId}, current ${list.listId}). Run "ambiance handoff list --json" again or select by --session-id.`
    );
  }

  const session = args.sessionId
    ? list.sessions.find(candidate => candidate.sessionId === args.sessionId)
    : list.sessions.find(candidate => candidate.selection === args.selection);
  if (!session) {
    const requested = args.sessionId
      ? `session id ${args.sessionId}`
      : `selection ${args.selection}`;
    throw new Error(`Handoff source ${requested} was not found in the current session list.`);
  }
  return { session, list };
}
