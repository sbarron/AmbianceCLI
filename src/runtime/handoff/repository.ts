import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type {
  NormalizedHandoffEvent,
  RepositoryCodeEvidence,
  RepositoryState,
  SessionSummary,
} from './types';
import { normalizeFsPath } from './utils';

const FILE_REFERENCE_PATTERN =
  /(?:[A-Za-z]:[\\/])?(?:[A-Za-z0-9_.@-]+[\\/])+[A-Za-z0-9_.@-]+\.(?:tsx|ts|jsx|mjs|cjs|json|js|py|go|rs|java|kt|cs|cpp|c|h|ya?ml|toml|md|sql)(?::\d+)?/g;

function runGit(projectPath: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', projectPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trimEnd();
  } catch {
    return undefined;
  }
}

function toProjectRelative(projectPath: string, value: string): string | undefined {
  const withoutLine = value.replace(/:\d+$/, '');
  const absolute = path.isAbsolute(withoutLine)
    ? path.resolve(withoutLine)
    : path.resolve(projectPath, withoutLine);
  const normalizedProject = normalizeFsPath(projectPath);
  const normalizedAbsolute = normalizeFsPath(absolute);
  if (!normalizedProject || !normalizedAbsolute) return undefined;
  if (
    normalizedAbsolute !== normalizedProject &&
    !normalizedAbsolute.startsWith(`${normalizedProject}${path.sep}`)
  ) {
    return undefined;
  }
  return path.relative(projectPath, absolute).replace(/\\/g, '/');
}

function isCredibleReference(relative: string): boolean {
  const segments = relative.split('/');
  if (segments[0]?.startsWith('--')) return false;
  return !segments.some(
    segment =>
      segment === 'n' ||
      /^n(?:src|tests|skills|scripts|docs)$/i.test(segment) ||
      /^\d+(?:ms)?$/i.test(segment) ||
      /^\d+m(?:src|tests|skills|scripts|docs)/i.test(segment)
  );
}

export function extractReferencedFiles(
  projectPath: string,
  events: NormalizedHandoffEvent[]
): string[] {
  const references = new Set<string>();
  for (const event of events) {
    const searchable = event.text
      .replace(/\\u001b\[[0-9;]*m/g, '')
      .replace(/\u001b\[[0-9;]*m/g, '')
      .replace(/(?<!:)\\n/g, '\n')
      .replace(/(?<!:)\\r/g, '\n')
      .replace(/(?<!:)\\t/g, ' ');
    for (const match of searchable.match(FILE_REFERENCE_PATTERN) || []) {
      const relative = toProjectRelative(projectPath, match);
      if (relative && isCredibleReference(relative)) references.add(relative);
    }
  }
  return Array.from(references).sort();
}

function parseChangedFiles(status: string | undefined): string[] {
  if (!status) return [];
  const files = new Set<string>();
  for (const line of status.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const raw = line.slice(3).trim();
    const target = raw.includes(' -> ') ? raw.split(' -> ').pop()! : raw;
    if (target) files.add(target.replace(/^"|"$/g, '').replace(/\\/g, '/'));
  }
  return Array.from(files).sort();
}

function extractQueryAnchors(
  events: NormalizedHandoffEvent[],
  referencedFiles: string[]
): string[] {
  const anchors = new Set<string>(referencedFiles.slice(0, 10));
  for (const event of events.slice().reverse()) {
    for (const match of event.text.match(/\b[A-Za-z_$][A-Za-z0-9_$]{4,}\b/g) || []) {
      if (!/[A-Z_$]/.test(match.slice(1)) && !match.includes('_')) continue;
      anchors.add(match);
      if (anchors.size >= 20) return Array.from(anchors);
    }
  }
  return Array.from(anchors);
}

async function refreshCodeEvidence(
  projectPath: string,
  events: NormalizedHandoffEvent[],
  referencedFiles: string[]
): Promise<RepositoryCodeEvidence[]> {
  const projectMarkers = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
  if (!projectMarkers.some(marker => fs.existsSync(path.join(projectPath, marker)))) return [];
  const anchors = extractQueryAnchors(events, referencedFiles);
  if (anchors.length === 0) return [];
  try {
    const { handleSemanticCompact } = await import('../context/semanticCompact');
    const result = (await handleSemanticCompact({
      projectPath,
      query: anchors.join(' '),
      taskType: 'understand',
      format: 'index',
      maxTokens: 900,
      maxSimilarChunks: 8,
      useEmbeddings: false,
      disableEmbeddings: true,
      generateEmbeddingsIfMissing: false,
      autoSync: false,
    })) as Record<string, unknown>;

    const targets = Array.isArray(result.jumpTargets)
      ? result.jumpTargets
      : Array.isArray(result.evidence)
        ? result.evidence
        : [];
    const evidence: RepositoryCodeEvidence[] = [];
    for (const value of targets) {
      if (!value || typeof value !== 'object') continue;
      const target = value as Record<string, unknown>;
      const fileValue = typeof target.file === 'string' ? target.file : undefined;
      if (!fileValue) continue;
      const relative = toProjectRelative(projectPath, fileValue) || fileValue.replace(/\\/g, '/');
      if (!fs.existsSync(path.resolve(projectPath, relative))) continue;
      evidence.push({
        file: relative,
        symbol: typeof target.symbol === 'string' ? target.symbol : undefined,
        start: typeof target.start === 'number' ? target.start : undefined,
        end: typeof target.end === 'number' ? target.end : undefined,
        why: Array.isArray(target.why)
          ? target.why.filter((item): item is string => typeof item === 'string')
          : undefined,
      });
      if (evidence.length >= 12) break;
    }
    return evidence;
  } catch {
    return [];
  }
}

export async function captureRepositoryState(args: {
  projectPath: string;
  session: SessionSummary;
  events: NormalizedHandoffEvent[];
}): Promise<RepositoryState> {
  const projectPath = path.resolve(args.projectPath);
  const extractedReferences = extractReferencedFiles(projectPath, args.events);
  const referencedFiles = extractedReferences.filter(file =>
    fs.existsSync(path.resolve(projectPath, file))
  );
  const recentNarrativeReferences = extractReferencedFiles(
    projectPath,
    args.events
      .filter(
        event => event.kind === 'user' || event.kind === 'assistant' || event.kind === 'summary'
      )
      .slice(-25)
  );
  const missingReferencedFiles = recentNarrativeReferences.filter(file => {
    if (fs.existsSync(path.resolve(projectPath, file))) return false;
    const [topLevel] = file.split('/');
    return !!topLevel && fs.existsSync(path.resolve(projectPath, topLevel));
  });
  const changedFiles = parseChangedFiles(runGit(projectPath, ['status', '--porcelain=v1']));
  const branch = runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = runGit(projectPath, ['rev-parse', 'HEAD']);
  const staleReasons: string[] = [];
  const sessionTime = Date.parse(args.session.updatedAt);

  if (missingReferencedFiles.length > 0) {
    staleReasons.push(`${missingReferencedFiles.length} referenced file(s) no longer exist`);
  }

  const changedReferenced = referencedFiles.filter(file => changedFiles.includes(file));
  if (changedReferenced.length > 0) {
    staleReasons.push(
      `${changedReferenced.length} referenced file(s) currently have uncommitted changes`
    );
  }

  if (Number.isFinite(sessionTime)) {
    const newerReferences = referencedFiles.filter(file => {
      try {
        return fs.statSync(path.resolve(projectPath, file)).mtimeMs > sessionTime;
      } catch {
        return false;
      }
    });
    if (newerReferences.length > 0) {
      staleReasons.push(
        `${newerReferences.length} referenced file(s) changed after the source session`
      );
    }
    const headDate = runGit(projectPath, ['show', '-s', '--format=%cI', 'HEAD']);
    if (headDate && Date.parse(headDate) > sessionTime) {
      staleReasons.push('the repository HEAD commit is newer than the source session');
    }
  }

  const codeEvidence = await refreshCodeEvidence(projectPath, args.events, referencedFiles);
  return {
    projectPath,
    capturedAt: new Date().toISOString(),
    branch,
    head,
    dirty: changedFiles.length > 0,
    changedFiles,
    referencedFiles,
    missingReferencedFiles,
    codeEvidence,
    stale: staleReasons.length > 0,
    staleReasons,
  };
}
