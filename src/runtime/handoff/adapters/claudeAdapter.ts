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
  dedupeEvents,
  readJsonl,
  sourceHome,
  stringifyToolInput,
} from './shared';

function findClaudeTitle(rows: unknown[]): string | undefined {
  for (const rowValue of rows) {
    const row = asRecord(rowValue);
    const title = asString(row?.aiTitle);
    if (title) return cleanTitle(title);
  }
  for (const rowValue of rows) {
    const row = asRecord(rowValue);
    if (row?.type !== 'user') continue;
    const message = asRecord(row.message);
    const text = extractText(message?.content).find(isSubstantiveUserText);
    if (text) return cleanTitle(text);
  }
  for (const rowValue of rows) {
    const row = asRecord(rowValue);
    const prompt = asString(row?.lastPrompt);
    if (prompt && isSubstantiveUserText(prompt)) return cleanTitle(prompt);
  }
  return undefined;
}

export const claudeAdapter: SessionAdapter = {
  source: 'claude',

  resolveRoot(): string {
    return path.resolve(sourceHome('claude'));
  },

  inspect(filePath: string): SessionSummary | undefined {
    const stat = fs.statSync(filePath);
    const rows = readJsonlSample(filePath);
    let sessionId = path.basename(filePath, path.extname(filePath));
    let cwd: string | undefined;
    let model: string | undefined;
    let createdAt: string | undefined;

    for (const rowValue of rows) {
      const row = asRecord(rowValue);
      if (!row) continue;
      sessionId = asString(row.sessionId) || sessionId;
      cwd = asString(row.cwd) || cwd;
      createdAt = createdAt || asString(row.timestamp);
      const message = asRecord(row.message);
      model = asString(message?.model) || asString(row.originalModel) || model;
    }

    return {
      sessionId,
      source: 'claude',
      title: findClaudeTitle(rows) || cleanTitle(undefined),
      sourcePath: filePath,
      cwd,
      model,
      createdAt,
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    };
  },

  async loadEvents(session: SessionSummary): Promise<NormalizedHandoffEvent[]> {
    const events: NormalizedHandoffEvent[] = [];
    await readJsonl(session.sourcePath, (row, line) => {
      const type = asString(row.type);
      const timestamp = asString(row.timestamp);
      const eventId = asString(row.uuid) || asString(row.requestId);
      const push = (event: NormalizedHandoffEvent | undefined) => {
        if (event) events.push(event);
      };

      if (type === 'user' || type === 'assistant') {
        const message = asRecord(row.message);
        const content = message?.content;
        if (Array.isArray(content)) {
          for (const blockValue of content) {
            const block = asRecord(blockValue);
            const blockType = asString(block?.type);
            if (!block || blockType === 'thinking') continue;
            if (blockType === 'tool_use') {
              push(
                buildEvent({
                  session,
                  line,
                  kind: 'tool_call',
                  text: truncateText(stringifyToolInput(block.input), 8_000),
                  timestamp,
                  eventId: asString(block.id) || eventId,
                  toolName: asString(block.name) || 'tool',
                })
              );
            } else if (blockType === 'tool_result') {
              const text =
                extractText(block.content).join('\n') || stringifyToolInput(block.content);
              push(
                buildEvent({
                  session,
                  line,
                  kind: block.is_error === true ? 'error' : 'tool_result',
                  text,
                  timestamp,
                  eventId: asString(block.tool_use_id) || eventId,
                })
              );
            } else if (blockType === 'text' || blockType === 'fallback') {
              for (const text of extractText(block)) {
                if (type === 'user' && !isSubstantiveUserText(text)) continue;
                push(buildEvent({ session, line, kind: type, text, timestamp, eventId }));
              }
            }
          }
        } else {
          for (const text of extractText(content)) {
            if (type === 'user' && !isSubstantiveUserText(text)) continue;
            push(buildEvent({ session, line, kind: type, text, timestamp, eventId }));
          }
        }
      } else if (type === 'system') {
        const text = asString(row.content);
        if (text) {
          const subtype = asString(row.subtype) || '';
          push(
            buildEvent({
              session,
              line,
              kind: /error|refusal|failure/i.test(subtype) ? 'error' : 'system',
              text,
              timestamp,
              eventId,
            })
          );
        }
      }
    });
    return dedupeEvents(events);
  },
};
