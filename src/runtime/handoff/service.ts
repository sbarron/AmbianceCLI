import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { getAdapter } from './adapters';
import { listSessions, resolveSessionSelection } from './catalog';
import { compactEvents, fitHandoffToBudget } from './compact';
import { captureRepositoryState } from './repository';
import {
  readHandoff,
  readHandoffEvidence,
  resolveArtifactPaths,
  writeHandoffArtifact,
} from './storage';
import type { HandoffEventKind, HandoffSource, HandoffV1 } from './types';
import { hashText } from './utils';

export interface HandoffCommandArgs {
  action?: 'list' | 'search' | 'create' | 'show' | 'evidence';
  projectPath: string;
  sources?: HandoffSource[];
  allProjects?: boolean;
  limit?: number;
  includeCurrent?: boolean;
  query?: string;
  selection?: number;
  sessionId?: string;
  listId?: string;
  compact?: boolean;
  maxTokens?: number;
  handoffsDir?: string;
  includeTranscript?: boolean;
  identifier?: string;
  evidenceId?: string;
  kind?: HandoffEventKind;
  tests?: boolean;
  turns?: string;
}

export function parseHandoffSources(value: unknown): HandoffSource[] | undefined {
  if (value === undefined) return undefined;
  const items = (Array.isArray(value) ? value : String(value).split(','))
    .map(item => String(item).trim().toLowerCase())
    .filter(Boolean);
  const invalid = items.filter(item => item !== 'codex' && item !== 'claude');
  if (invalid.length > 0) {
    throw new Error(
      `Unsupported handoff source(s): ${invalid.join(', ')} (supported: codex, claude)`
    );
  }
  return Array.from(new Set(items)) as HandoffSource[];
}

function formatAge(timestamp: string): string {
  const ageMs = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(ageMs) || ageMs < 0) return timestamp;
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatSessionList(result: ReturnType<typeof listSessions>): string {
  if (result.sessions.length === 0) {
    return `No Codex or Claude sessions found${result.projectPath ? ` for ${result.projectPath}` : ''}.`;
  }
  const lines = [
    `Available sessions${result.projectPath ? ` for ${path.basename(result.projectPath)}` : ''}:`,
    '',
  ];
  for (const session of result.sessions) {
    lines.push(
      `${session.selection}. ${session.title}`,
      `   ${session.source} | ${session.model || 'unknown model'} | updated ${formatAge(session.updatedAt)}`,
      `   id: ${session.sessionId}`,
      ''
    );
  }
  lines.push('Run: ambiance handoff create <number> [--compact]');
  return lines.join('\n').trimEnd();
}

function formatSearchResults(
  result: Awaited<ReturnType<typeof import('./search').searchSessions>>
): string {
  if (result.results.length === 0) {
    return `No Codex or Claude sessions matched "${result.query}".`;
  }
  const lines = [`Conversation matches for "${result.query}":`, ''];
  for (const session of result.results) {
    lines.push(
      `${session.selection}. ${session.title}`,
      `   ${session.source} | score ${session.score.toFixed(6)} | updated ${formatAge(session.updatedAt)}`,
      `   ${session.snippet}`,
      `   id: ${session.sessionId}`,
      ''
    );
  }
  lines.push(
    `Retrieve with: ambiance handoff create --session-id <id> --compact${
      result.projectPath ? '' : ' --all-projects'
    }`
  );
  return lines.join('\n').trimEnd();
}

function parseLineRange(value: string | undefined): { start: number; end: number } | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+)(?:\.\.|-|:)(\d+)$/);
  if (!match) throw new Error('--turns must be a range such as 28..34');
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end < start) throw new Error('--turns range is invalid');
  return { start, end };
}

async function createHandoff(args: HandoffCommandArgs): Promise<Record<string, unknown>> {
  const resolved = resolveSessionSelection({
    projectPath: args.projectPath,
    sources: args.sources,
    allProjects: args.allProjects,
    limit: args.sessionId ? Math.max(args.limit ?? 20, 10_000) : args.limit,
    includeCurrent: args.sessionId ? true : args.includeCurrent,
    selection: args.selection,
    sessionId: args.sessionId,
    listId: args.listId,
  });
  const session = resolved.session;
  const adapter = getAdapter(session.source);
  const events = await adapter.loadEvents(session);
  if (events.length === 0) {
    throw new Error(
      `Session ${session.sessionId} contained no portable messages or tool evidence.`
    );
  }

  const repository = await captureRepositoryState({
    projectPath: args.projectPath,
    session,
    events,
  });
  const mode = args.compact === true ? 'compact' : 'standard';
  const maxTokens = Math.max(
    500,
    Math.floor(args.maxTokens ?? (mode === 'compact' ? 2_000 : 6_000))
  );
  const id = crypto.randomUUID();
  const paths = resolveArtifactPaths({
    projectPath: args.projectPath,
    handoffId: id,
    handoffsDir: args.handoffsDir,
    includeTranscript: args.includeTranscript,
  });
  const redactions = events.reduce((total, event) => total + (event.redactions || 0), 0);
  const warnings: string[] = [];
  if (redactions > 0) warnings.push(`${redactions} likely secret value(s) were redacted`);
  if (repository.stale)
    warnings.push('repository state differs from evidence retained by the source session');
  if (repository.codeEvidence.length === 0) {
    warnings.push(
      'no refreshed symbol-level code evidence was available; file and Git state were still checked'
    );
  }
  if (args.includeTranscript) {
    warnings.push(
      'the raw source transcript was explicitly copied and may contain sensitive material'
    );
  }

  const initial: HandoffV1 = {
    version: 1,
    id,
    title: session.title,
    createdAt: new Date().toISOString(),
    sourceSession: session,
    projectPath: path.resolve(args.projectPath),
    mode,
    maxTokens,
    estimatedTokens: 0,
    sections: compactEvents({ events, repository, mode }),
    repository,
    evidenceFile: paths.evidenceJsonl,
    markdownFile: paths.handoffMarkdown,
    sourceFingerprint: hashText(
      `${session.source}:${session.sourcePath}:${session.sizeBytes}:${session.updatedAt}`
    ),
    warnings,
  };
  const fitted = fitHandoffToBudget(initial);
  writeHandoffArtifact({
    handoff: fitted.handoff,
    markdown: fitted.markdown,
    events,
    paths,
    sourcePath: args.includeTranscript ? session.sourcePath : undefined,
  });

  return {
    success: true,
    timestamp: new Date().toISOString(),
    action: 'create',
    listId: resolved.list.listId,
    selection: session.selection,
    sessionId: session.sessionId,
    handoff: fitted.handoff,
    paths,
    content: fitted.markdown,
  };
}

export async function handleHandoffCommand(
  args: HandoffCommandArgs
): Promise<Record<string, unknown>> {
  const action = args.action || 'list';
  if (action === 'list') {
    const listed = listSessions({
      projectPath: args.projectPath,
      sources: args.sources,
      allProjects: args.allProjects,
      limit: args.limit,
      includeCurrent: args.includeCurrent,
    });
    return {
      success: true,
      timestamp: new Date().toISOString(),
      action: 'list',
      ...listed,
      content: formatSessionList(listed),
    };
  }

  if (action === 'search') {
    if (!args.query) throw new Error('handoff search requires a query');
    const { searchSessions } = await import('./search');
    const searched = await searchSessions({
      query: args.query,
      projectPath: args.projectPath,
      sources: args.sources,
      allProjects: args.allProjects,
      limit: args.limit,
      includeCurrent: args.includeCurrent,
    });
    return {
      success: true,
      timestamp: new Date().toISOString(),
      action: 'search',
      ...searched,
      content: formatSearchResults(searched),
    };
  }

  if (action === 'create') return createHandoff(args);

  if (!args.identifier) throw new Error(`handoff ${action} requires a handoff identifier`);
  if (action === 'show') {
    const loaded = readHandoff(args.identifier, args.handoffsDir);
    return {
      success: true,
      timestamp: new Date().toISOString(),
      action: 'show',
      handoff: loaded.handoff,
      directory: loaded.directory,
      content: loaded.markdown,
    };
  }

  const evidence = await readHandoffEvidence({
    identifier: args.identifier,
    handoffsDir: args.handoffsDir,
    id: args.evidenceId,
    kind: args.kind,
    tests: args.tests,
    lines: parseLineRange(args.turns),
    limit: args.limit,
  });
  const content =
    evidence.events.length === 0
      ? 'No matching handoff evidence found.'
      : evidence.events
          .map(
            event =>
              `[${event.id}] ${event.kind} | line ${event.sourceRef.line}${event.toolName ? ` | ${event.toolName}` : ''}\n${event.text}`
          )
          .join('\n\n');
  return {
    success: true,
    timestamp: new Date().toISOString(),
    action: 'evidence',
    evidenceFile: evidence.evidenceFile,
    events: evidence.events,
    content,
  };
}

export function handoffSourceExists(source: HandoffSource): boolean {
  return fs.existsSync(getAdapter(source).resolveRoot());
}
