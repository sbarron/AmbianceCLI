import * as fs from 'fs';
import * as path from 'path';

import Database from 'better-sqlite3';

import { getAdapter } from './adapters';
import { listSessions } from './catalog';
import type {
  HandoffSearchResultSet,
  HandoffSource,
  NormalizedHandoffEvent,
  SessionSummary,
} from './types';
import {
  ensureDirSync,
  hashText,
  normalizeFsPath,
  resolveHandoffCacheDir,
  truncateText,
} from './utils';

const SEARCH_DOCUMENT_MAX_CHARS = 2_000_000;
const SEARCH_EVENT_MAX_CHARS = 8_000;
const SEARCHABLE_EVENT_KINDS = new Set(['user', 'assistant', 'summary']);
const SEARCH_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'with',
]);

interface IndexedSearchDocument {
  source_path: string;
  source: HandoffSource;
  session_id: string;
  title: string;
  cwd: string;
  updated_at: string;
  size_bytes: number;
  mtime_ms: number;
  cwd_key: string;
}

interface RawSearchResult extends IndexedSearchDocument {
  rank: number;
  snippet: string;
}

function resolveSearchDatabasePath(): string {
  return path.join(resolveHandoffCacheDir(), 'handoff-search-v1.sqlite');
}

function prepareSearchQuery(query: string): string {
  const tokens = Array.from(
    new Set(
      query
        .normalize('NFKC')
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}_]{2,}/gu)
        ?.filter(token => !SEARCH_STOPWORDS.has(token)) || []
    )
  );
  if (tokens.length === 0) {
    throw new Error('handoff search requires at least one meaningful keyword');
  }
  return tokens.map(token => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

function buildSearchBody(events: NormalizedHandoffEvent[]): string {
  const parts = events
    .filter(event => SEARCHABLE_EVENT_KINDS.has(event.kind))
    .map(event => truncateText(event.text, SEARCH_EVENT_MAX_CHARS))
    .filter(Boolean);
  const full = parts.join('\n\n');
  if (full.length <= SEARCH_DOCUMENT_MAX_CHARS) return full;

  const perEventBudget = Math.max(
    256,
    Math.min(SEARCH_EVENT_MAX_CHARS, Math.floor(SEARCH_DOCUMENT_MAX_CHARS / parts.length))
  );
  return truncateText(
    parts.map(part => truncateText(part, perEventBudget)).join('\n\n'),
    SEARCH_DOCUMENT_MAX_CHARS
  );
}

function initializeSearchDatabase(database: Database.Database): void {
  database.pragma('journal_mode = WAL');
  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS handoff_search USING fts5(
      source_path UNINDEXED,
      source UNINDEXED,
      session_id UNINDEXED,
      title,
      cwd,
      body,
      updated_at UNINDEXED,
      size_bytes UNINDEXED,
      mtime_ms UNINDEXED,
      cwd_key UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
}

function documentIsCurrent(
  indexed: IndexedSearchDocument | undefined,
  session: SessionSummary
): boolean {
  return (
    indexed?.source === session.source &&
    indexed.session_id === session.sessionId &&
    indexed.title === session.title &&
    indexed.cwd === (session.cwd || '') &&
    indexed.updated_at === session.updatedAt &&
    Number(indexed.size_bytes) === session.sizeBytes &&
    Number(indexed.mtime_ms) === Date.parse(session.updatedAt)
  );
}

function cleanupMissingDocuments(database: Database.Database): number {
  const rows = database.prepare('SELECT source_path FROM handoff_search').all() as Array<{
    source_path: string;
  }>;
  const remove = database.prepare('DELETE FROM handoff_search WHERE source_path = ?');
  let removed = 0;
  const transaction = database.transaction((sourcePaths: string[]) => {
    for (const sourcePath of sourcePaths) {
      remove.run(sourcePath);
      removed += 1;
    }
  });
  transaction(rows.filter(row => !fs.existsSync(row.source_path)).map(row => row.source_path));
  return removed;
}

export async function searchSessions(args: {
  query: string;
  projectPath?: string;
  sources?: HandoffSource[];
  allProjects?: boolean;
  limit?: number;
  includeCurrent?: boolean;
}): Promise<HandoffSearchResultSet> {
  const matchQuery = prepareSearchQuery(args.query);
  const listed = listSessions({
    projectPath: args.projectPath,
    sources: args.sources,
    allProjects: args.allProjects,
    includeCurrent: args.includeCurrent,
    limit: 100_000,
  });
  const databasePath = resolveSearchDatabasePath();
  ensureDirSync(path.dirname(databasePath));
  const database = new Database(databasePath);
  const errors: string[] = [];
  let indexedSessions = 0;
  let reusedSessions = 0;
  let removedSessions = 0;

  try {
    initializeSearchDatabase(database);
    removedSessions = cleanupMissingDocuments(database);

    const findDocument = database.prepare(
      `SELECT source_path, source, session_id, title, cwd, updated_at, size_bytes, mtime_ms, cwd_key
       FROM handoff_search
       WHERE source_path = ?
       LIMIT 1`
    );
    const deleteDocument = database.prepare('DELETE FROM handoff_search WHERE source_path = ?');
    const insertDocument = database.prepare(
      `INSERT INTO handoff_search(
        source_path, source, session_id, title, cwd, body, updated_at, size_bytes, mtime_ms, cwd_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const replaceDocument = database.transaction((session: SessionSummary, body: string) => {
      deleteDocument.run(session.sourcePath);
      insertDocument.run(
        session.sourcePath,
        session.source,
        session.sessionId,
        session.title,
        session.cwd || '',
        body,
        session.updatedAt,
        session.sizeBytes,
        Date.parse(session.updatedAt),
        normalizeFsPath(session.cwd) || ''
      );
    });

    for (const session of listed.sessions) {
      const indexed = findDocument.get(session.sourcePath) as IndexedSearchDocument | undefined;
      if (documentIsCurrent(indexed, session)) {
        reusedSessions += 1;
        continue;
      }
      try {
        const events = await getAdapter(session.source).loadEvents(session);
        replaceDocument(session, buildSearchBody(events));
        indexedSessions += 1;
      } catch (error) {
        const removed = deleteDocument.run(session.sourcePath);
        if (removed.changes > 0) removedSessions += 1;
        errors.push(
          `${session.source}:${session.sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    const parameters: Record<string, string | number> = {
      matchQuery,
      limit: Math.max(1, Math.min(100, Math.floor(args.limit ?? 10))),
    };
    const filters = ['handoff_search MATCH @matchQuery'];
    const sources = args.sources?.length ? args.sources : listed.scannedSources;
    filters.push(
      `source IN (${sources
        .map((source, index) => {
          parameters[`source${index}`] = source;
          return `@source${index}`;
        })
        .join(', ')})`
    );
    if (args.allProjects !== true && args.projectPath) {
      filters.push('cwd_key = @projectKey');
      parameters.projectKey = normalizeFsPath(args.projectPath) || '';
    }
    if (args.includeCurrent !== true && process.env.CODEX_THREAD_ID) {
      filters.push("NOT (source = 'codex' AND session_id = @currentSessionId)");
      parameters.currentSessionId = process.env.CODEX_THREAD_ID;
    }

    const rankExpression = 'bm25(handoff_search, 0.0, 0.0, 0.0, 5.0, 2.0, 1.0, 0.0, 0.0, 0.0, 0.0)';
    const rows = database
      .prepare(
        `SELECT
          source_path, source, session_id, title, cwd, updated_at, size_bytes, mtime_ms, cwd_key,
          ${rankExpression} AS rank,
          COALESCE(NULLIF(snippet(handoff_search, 5, '[', ']', '...', 24), ''), title) AS snippet
        FROM handoff_search
        WHERE ${filters.join(' AND ')}
        ORDER BY rank ASC, updated_at DESC
        LIMIT @limit`
      )
      .all(parameters) as RawSearchResult[];

    const strengths = rows.map(row => Math.max(0, -Number(row.rank)));
    const strongest = Math.max(...strengths, 0);
    const results = rows.map((row, index) => ({
      selection: index + 1,
      sessionId: row.session_id,
      source: row.source,
      title: row.title,
      sourcePath: row.source_path,
      cwd: row.cwd || undefined,
      updatedAt: row.updated_at,
      sizeBytes: Number(row.size_bytes),
      score: strongest > 0 ? Number((strengths[index] / strongest).toFixed(6)) : 0,
      snippet: row.snippet,
    }));
    const searchId = hashText(
      [
        args.query,
        ...results.map(
          result =>
            `${result.source}:${result.sessionId}:${result.sourcePath}:${result.updatedAt}:${result.score}`
        ),
      ].join('\n')
    ).slice(0, 16);

    return {
      query: args.query,
      results,
      searchId,
      projectPath: args.allProjects === true ? undefined : args.projectPath,
      scannedSources: listed.scannedSources,
      indexing: {
        scannedSessions: listed.sessions.length,
        indexedSessions,
        reusedSessions,
        removedSessions,
        errors,
      },
    };
  } finally {
    database.close();
  }
}
