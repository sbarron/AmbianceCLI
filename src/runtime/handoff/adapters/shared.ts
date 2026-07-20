import * as fs from 'fs';
import * as readline from 'readline';

import type {
  HandoffEventKind,
  HandoffSource,
  NormalizedHandoffEvent,
  SessionSummary,
} from '../types';
import { extractText, hashText, redactSecrets, truncateText } from '../utils';

export async function readJsonl(
  filePath: string,
  visit: (row: Record<string, unknown>, line: number) => void
): Promise<void> {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let line = 0;
  for await (const raw of lines) {
    line += 1;
    if (!raw.trim().startsWith('{')) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        visit(parsed as Record<string, unknown>, line);
      }
    } catch {
      // A live session may end with a partially-written record. Keep prior evidence.
    }
  }
}

export function buildEvent(args: {
  session: SessionSummary;
  line: number;
  kind: HandoffEventKind;
  text: string;
  timestamp?: string;
  eventId?: string;
  toolName?: string;
  turnId?: string;
}): NormalizedHandoffEvent | undefined {
  const raw = truncateText(args.text, 20_000);
  if (!raw) return undefined;
  const redacted = redactSecrets(raw);
  const contentHash = hashText(raw);
  const id = hashText(
    `${args.session.source}:${args.session.sessionId}:${args.line}:${args.kind}:${contentHash}`
  ).slice(0, 24);
  return {
    id,
    kind: args.kind,
    text: redacted.text,
    timestamp: args.timestamp,
    toolName: args.toolName,
    turnId: args.turnId,
    redactions: redacted.redactions || undefined,
    sourceRef: {
      id,
      source: args.session.source,
      sessionId: args.session.sessionId,
      sourcePath: args.session.sourcePath,
      line: args.line,
      eventId: args.eventId,
      timestamp: args.timestamp,
      contentHash,
    },
  };
}

export function dedupeEvents(events: NormalizedHandoffEvent[]): NormalizedHandoffEvent[] {
  const seen = new Set<string>();
  return events.filter(event => {
    const key = `${event.kind}:${event.toolName || ''}:${event.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sourceHome(source: HandoffSource): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (source === 'codex') {
    return process.env.AMBIANCE_CODEX_SESSIONS_DIR?.trim() || `${home}/.codex/sessions`;
  }
  return process.env.AMBIANCE_CLAUDE_PROJECTS_DIR?.trim() || `${home}/.claude/projects`;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function stringifyToolInput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return String(value);
  }
}

export function normalizeToolOutput(value: unknown): string {
  if (typeof value !== 'string') {
    const texts = extractText(value);
    return texts.length > 0 ? texts.join('\n') : stringifyToolInput(value);
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const texts = extractText(JSON.parse(trimmed));
      if (texts.length > 0) return texts.join('\n');
    } catch {
      // Not JSON: keep the raw textual output.
    }
  }
  return value;
}

export function classifyToolOutput(output: string): 'tool_result' | 'error' {
  if (/^script failed/i.test(output)) return 'error';
  if (/^script completed/i.test(output)) return 'tool_result';
  const exit = output.match(/\bexit code:?\s*(\d+)/i);
  if (exit) return exit[1] === '0' ? 'tool_result' : 'error';
  return /\b(?:error|failed)\b/i.test(output) ? 'error' : 'tool_result';
}
