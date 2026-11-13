import * as fs from 'fs';
import * as path from 'path';

import type { NormalizedHandoffEvent, SessionAdapter, SessionSummary } from '../types';
import {
  cleanTitle,
  extractText,
  isSubstantiveUserText,
  readJsonlSample,
  truncateText,
} from '../utils';
import {
  asRecord,
  asString,
  buildEvent,
  classifyToolOutput,
  dedupeEvents,
  normalizeToolOutput,
  readJsonl,
  sourceHome,
  stringifyToolInput,
} from './shared';

interface CodexSessionMetadata {
  title: string;
}

let metadataCache:
  | {
      filePath: string;
      sizeBytes: number;
      mtimeMs: number;
      sessions: Map<string, CodexSessionMetadata>;
    }
  | undefined;

function resolveCodexSessionIndexPath(): string {
  const override = process.env.AMBIANCE_CODEX_SESSION_INDEX?.trim();
  if (override) return path.resolve(override);
  return path.join(path.dirname(path.resolve(sourceHome('codex'))), 'session_index.jsonl');
}

function readCodexSessionMetadata(): Map<string, CodexSessionMetadata> {
  const filePath = resolveCodexSessionIndexPath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return new Map();
  }
  if (
    metadataCache?.filePath === filePath &&
    metadataCache.sizeBytes === stat.size &&
    metadataCache.mtimeMs === stat.mtimeMs
  ) {
    return metadataCache.sessions;
  }

  const sessions = new Map<string, CodexSessionMetadata>();
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        const id = asString(row.id);
        const title = asString(row.thread_name);
        if (id && title) {
          sessions.set(id, {
            title: cleanTitle(title),
          });
        }
      } catch {
        // A live metadata index may end in a partially-written JSONL record.
      }
    }
  } catch {
    return new Map();
  }
  metadataCache = {
    filePath,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    sessions,
  };
  return sessions;
}

function canonicalCodexSessionId(filePath: string): string | undefined {
  const basename = path.basename(filePath);
  const match = basename.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
  );
  return match?.[1];
}

function isLikelyInjectedCodexText(value: string): boolean {
  return /^(?:#\s*AGENTS\.md instructions\b|<recommended_plugins>|<environment_context>|<codex_internal_context>)/i.test(
    value.trim()
  );
}

function findCodexTitle(rows: unknown[]): string | undefined {
  for (const rowValue of rows) {
    const row = asRecord(rowValue);
    const payload = asRecord(row?.payload);
    if (!row || !payload) continue;
    if (row.type === 'event_msg' && payload.type === 'thread_goal_updated') {
      const goal = asRecord(payload.goal);
      const objective = asString(payload.objective) || asString(goal?.objective);
      if (objective) return cleanTitle(objective);
    }
    if (row.type === 'event_msg' && payload.type === 'user_message') {
      const message = asString(payload.message);
      if (message && isSubstantiveUserText(message) && !isLikelyInjectedCodexText(message))
        return cleanTitle(message);
    }
    if (row.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      const message = extractText(payload.content).find(isSubstantiveUserText);
      if (message && !isLikelyInjectedCodexText(message)) return cleanTitle(message);
    }
  }
  return undefined;
}

function enrichCodexSummary(session: SessionSummary): SessionSummary {
  const metadata = readCodexSessionMetadata().get(session.sessionId);
  return metadata ? { ...session, title: metadata.title } : session;
}

export const codexAdapter: SessionAdapter = {
  source: 'codex',

  resolveRoot(): string {
    return path.resolve(sourceHome('codex'));
  },

  inspect(filePath: string): SessionSummary | undefined {
    const stat = fs.statSync(filePath);
    const rows = readJsonlSample(filePath);
    const canonicalSessionId = canonicalCodexSessionId(filePath);
    let sessionId = canonicalSessionId || path.basename(filePath, path.extname(filePath));
    let cwd: string | undefined;
    let model: string | undefined;
    let createdAt: string | undefined;

    for (const rowValue of rows) {
      const row = asRecord(rowValue);
      const payload = asRecord(row?.payload);
      if (!row || !payload) continue;
      if (row.type === 'session_meta') {
        if (!canonicalSessionId) {
          sessionId = asString(payload.session_id) || asString(payload.id) || sessionId;
        }
        cwd = asString(payload.cwd) || cwd;
        createdAt = asString(payload.timestamp) || asString(row.timestamp) || createdAt;
      } else if (row.type === 'turn_context') {
        cwd = asString(payload.cwd) || cwd;
        model = asString(payload.model) || model;
      }
    }

    return enrichCodexSummary({
      sessionId,
      source: 'codex',
      title: findCodexTitle(rows) || cleanTitle(undefined),
      sourcePath: filePath,
      cwd,
      model,
      createdAt,
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    });
  },

  enrichSummary(session: SessionSummary): SessionSummary {
    return enrichCodexSummary(session);
  },

  async loadEvents(session: SessionSummary): Promise<NormalizedHandoffEvent[]> {
    const events: NormalizedHandoffEvent[] = [];
    await readJsonl(session.sourcePath, (row, line) => {
      const payload = asRecord(row.payload);
      if (!payload) return;
      const timestamp = asString(row.timestamp) || asString(payload.timestamp);
      const payloadType = asString(payload.type);
      const eventId = asString(payload.id) || asString(payload.call_id);
      const turnId = asString(payload.turn_id);

      const push = (event: NormalizedHandoffEvent | undefined) => {
        if (event) events.push(event);
      };

      if (row.type === 'turn_context') {
        const summary = asString(payload.summary);
        if (summary) {
          push(buildEvent({ session, line, kind: 'summary', text: summary, timestamp, turnId }));
        }
        return;
      }

      if (row.type === 'event_msg') {
        if (payloadType === 'user_message') {
          const message = asString(payload.message);
          if (message && isSubstantiveUserText(message))
            push(buildEvent({ session, line, kind: 'user', text: message, timestamp, turnId }));
        } else if (payloadType === 'agent_message') {
          const message = asString(payload.message);
          if (message)
            push(
              buildEvent({ session, line, kind: 'assistant', text: message, timestamp, turnId })
            );
        } else if (payloadType === 'task_complete') {
          const message = asString(payload.last_agent_message) || asString(payload.message);
          if (message)
            push(
              buildEvent({ session, line, kind: 'assistant', text: message, timestamp, turnId })
            );
        } else if (payloadType === 'thread_goal_updated') {
          const goal = asRecord(payload.goal);
          const objective = asString(payload.objective) || asString(goal?.objective);
          if (objective) {
            push(
              buildEvent({
                session,
                line,
                kind: 'summary',
                text: `Active goal: ${objective}`,
                timestamp,
                turnId,
              })
            );
          }
        }
        return;
      }

      if (row.type !== 'response_item') return;
      if (payloadType === 'reasoning') return;

      if (payloadType === 'message') {
        const role = asString(payload.role);
        if (role !== 'user' && role !== 'assistant') return;
        const kind = role === 'user' ? 'user' : 'assistant';
        for (const text of extractText(payload.content)) {
          if (kind === 'user' && !isSubstantiveUserText(text)) continue;
          push(buildEvent({ session, line, kind, text, timestamp, eventId, turnId }));
        }
      } else if (payloadType === 'custom_tool_call' || payloadType === 'function_call') {
        const toolName = asString(payload.name) || 'tool';
        const input = payload.input ?? payload.arguments;
        push(
          buildEvent({
            session,
            line,
            kind: 'tool_call',
            text: truncateText(stringifyToolInput(input), 8_000),
            timestamp,
            eventId,
            toolName,
            turnId,
          })
        );
      } else if (
        payloadType === 'custom_tool_call_output' ||
        payloadType === 'function_call_output'
      ) {
        const output = normalizeToolOutput(payload.output);
        push(
          buildEvent({
            session,
            line,
            kind: classifyToolOutput(output),
            text: output,
            timestamp,
            eventId,
            toolName: asString(payload.name),
            turnId,
          })
        );
      }
    });
    return dedupeEvents(events);
  },
};
