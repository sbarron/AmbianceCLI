import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import type {
  HandoffArtifactPaths,
  HandoffEventKind,
  HandoffV1,
  NormalizedHandoffEvent,
} from './types';
import { atomicWriteFileSync, ensureDirSync, hashText, resolveAmbianceHome } from './utils';

export function resolveHandoffsRoot(override?: string): string {
  const envOverride = process.env.AMBIANCE_HANDOFFS_DIR?.trim();
  return path.resolve(override || envOverride || path.join(resolveAmbianceHome(), 'handoffs'));
}

export function resolveArtifactPaths(args: {
  projectPath: string;
  handoffId: string;
  handoffsDir?: string;
  includeTranscript?: boolean;
}): HandoffArtifactPaths {
  const projectHash = hashText(path.resolve(args.projectPath).toLowerCase()).slice(0, 16);
  const directory = path.join(resolveHandoffsRoot(args.handoffsDir), projectHash, args.handoffId);
  return {
    directory,
    handoffJson: path.join(directory, 'handoff.json'),
    handoffMarkdown: path.join(directory, 'handoff.md'),
    evidenceJsonl: path.join(directory, 'evidence.jsonl'),
    sourceTranscript: args.includeTranscript ? path.join(directory, 'source.jsonl') : undefined,
  };
}

export function writeHandoffArtifact(args: {
  handoff: HandoffV1;
  markdown: string;
  events: NormalizedHandoffEvent[];
  paths: HandoffArtifactPaths;
  sourcePath?: string;
}): void {
  ensureDirSync(args.paths.directory);
  atomicWriteFileSync(args.paths.handoffJson, `${JSON.stringify(args.handoff, null, 2)}\n`);
  atomicWriteFileSync(args.paths.handoffMarkdown, args.markdown);
  atomicWriteFileSync(
    args.paths.evidenceJsonl,
    args.events.map(event => JSON.stringify(event)).join('\n') +
      (args.events.length > 0 ? '\n' : '')
  );
  if (args.paths.sourceTranscript && args.sourcePath) {
    const temporary = `${args.paths.sourceTranscript}.${process.pid}.${Date.now()}.tmp`;
    fs.copyFileSync(args.sourcePath, temporary);
    fs.renameSync(temporary, args.paths.sourceTranscript);
  }
}

function validateIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new Error(`Invalid handoff identifier: ${identifier}`);
  }
  return trimmed;
}

export function findHandoffDirectory(identifier: string, handoffsDir?: string): string {
  const safeId = validateIdentifier(identifier);
  const root = resolveHandoffsRoot(handoffsDir);
  if (!fs.existsSync(root)) throw new Error(`No handoffs found in ${root}`);
  for (const projectEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!projectEntry.isDirectory()) continue;
    const candidate = path.join(root, projectEntry.name, safeId);
    if (fs.existsSync(path.join(candidate, 'handoff.json'))) return candidate;
  }
  throw new Error(`Handoff not found: ${identifier}`);
}

export function readHandoff(
  identifier: string,
  handoffsDir?: string
): {
  handoff: HandoffV1;
  markdown: string;
  directory: string;
} {
  const directory = findHandoffDirectory(identifier, handoffsDir);
  const handoff = JSON.parse(
    fs.readFileSync(path.join(directory, 'handoff.json'), 'utf8')
  ) as HandoffV1;
  const markdown = fs.readFileSync(path.join(directory, 'handoff.md'), 'utf8');
  return { handoff, markdown, directory };
}

export async function readHandoffEvidence(args: {
  identifier: string;
  handoffsDir?: string;
  id?: string;
  kind?: HandoffEventKind;
  tests?: boolean;
  lines?: { start: number; end: number };
  limit?: number;
}): Promise<{ events: NormalizedHandoffEvent[]; evidenceFile: string }> {
  const directory = findHandoffDirectory(args.identifier, args.handoffsDir);
  const evidenceFile = path.join(directory, 'evidence.jsonl');
  const events: NormalizedHandoffEvent[] = [];
  const input = fs.createReadStream(evidenceFile, { encoding: 'utf8' });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  const limit = Math.max(1, args.limit ?? 100);

  for await (const line of reader) {
    if (!line.trim()) continue;
    let event: NormalizedHandoffEvent;
    try {
      event = JSON.parse(line) as NormalizedHandoffEvent;
    } catch {
      continue;
    }
    if (args.id && event.id !== args.id) continue;
    if (args.kind && event.kind !== args.kind) continue;
    if (
      args.tests &&
      !/\b(test|tests|build|lint|typecheck|verify|passed|exit code)\b/i.test(event.text)
    ) {
      continue;
    }
    if (
      args.lines &&
      (event.sourceRef.line < args.lines.start || event.sourceRef.line > args.lines.end)
    ) {
      continue;
    }
    events.push(event);
    if (events.length >= limit) break;
  }
  return { events, evidenceFile };
}
