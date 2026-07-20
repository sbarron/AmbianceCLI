import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { classifyToolOutput, normalizeToolOutput } from '../adapters/shared';
import { listSessions } from '../catalog';
import { extractReferencedFiles } from '../repository';
import { handleHandoffCommand } from '../service';
import { readHandoffEvidence } from '../storage';
import { cleanTitle } from '../utils';
import type { HandoffArtifactPaths, HandoffV1, NormalizedHandoffEvent } from '../types';

function fileHash(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('portable handoffs', () => {
  let root: string;
  let projectPath: string;
  let codexRoot: string;
  let claudeRoot: string;
  let handoffsRoot: string;
  const previousEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-handoff-'));
    projectPath = path.join(root, 'project');
    codexRoot = path.join(root, 'codex');
    claudeRoot = path.join(root, 'claude');
    handoffsRoot = path.join(root, 'handoffs');
    for (const directory of [projectPath, codexRoot, claudeRoot, handoffsRoot]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'src', 'index.ts'), 'export const fixture = true;\n');

    const fixtures = path.resolve('tests', 'fixtures', 'handoff');
    const writeFixture = (name: string, destination: string) => {
      const contents = fs
        .readFileSync(path.join(fixtures, name), 'utf8')
        .replace(/__PROJECT__/g, projectPath.replace(/\\/g, '\\\\'));
      fs.writeFileSync(destination, contents);
    };
    writeFixture('codex-session.jsonl', path.join(codexRoot, 'codex.jsonl'));
    writeFixture('claude-session.jsonl', path.join(claudeRoot, 'claude.jsonl'));
    const older = new Date('2026-07-14T10:05:00.000Z');
    const newer = new Date('2026-07-14T11:05:00.000Z');
    fs.utimesSync(path.join(codexRoot, 'codex.jsonl'), older, older);
    fs.utimesSync(path.join(claudeRoot, 'claude.jsonl'), newer, newer);

    for (const key of [
      'AMBIANCE_CODEX_SESSIONS_DIR',
      'AMBIANCE_CLAUDE_PROJECTS_DIR',
      'AMBIANCE_HANDOFF_CACHE_DIR',
      'AMBIANCE_HANDOFFS_DIR',
    ]) {
      previousEnv[key] = process.env[key];
    }
    process.env.AMBIANCE_CODEX_SESSIONS_DIR = codexRoot;
    process.env.AMBIANCE_CLAUDE_PROJECTS_DIR = claudeRoot;
    process.env.AMBIANCE_HANDOFF_CACHE_DIR = path.join(root, 'cache');
    process.env.AMBIANCE_HANDOFFS_DIR = handoffsRoot;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('lists numbered Codex and Claude titles in deterministic updated order', () => {
    const listed = listSessions({ projectPath, limit: 10 });
    expect(listed.sessions).toHaveLength(2);
    expect(listed.sessions[0]).toMatchObject({
      selection: 1,
      source: 'claude',
      title: 'Claude portable handoff fixture',
    });
    expect(listed.sessions[1]).toMatchObject({
      selection: 2,
      source: 'codex',
      sessionId: 'codex-fixture-session',
      title: 'Implement portable handoffs for src/index.ts without writing provider session files.',
    });
    expect(listed.listId).toMatch(/^[a-f0-9]{16}$/);
    expect(fs.existsSync(path.join(root, 'cache', 'handoff-catalog-v1.json'))).toBe(true);
  });

  test('creates a compact, redacted, evidence-linked handoff without changing the source', async () => {
    const sourcePath = path.join(codexRoot, 'codex.jsonl');
    const before = fileHash(sourcePath);
    const result = await handleHandoffCommand({
      action: 'create',
      projectPath,
      sources: ['codex'],
      selection: 1,
      compact: true,
      handoffsDir: handoffsRoot,
    });

    const handoff = result.handoff as HandoffV1;
    const paths = result.paths as HandoffArtifactPaths;
    expect(handoff.mode).toBe('compact');
    expect(handoff.estimatedTokens).toBeLessThanOrEqual(2_000);
    expect(handoff.sections.goal.length).toBeGreaterThan(0);
    expect(handoff.sections.decisions.length).toBeGreaterThan(0);
    expect(handoff.sections.completedWork.length).toBeGreaterThan(0);
    expect(handoff.sections.verification.length).toBeGreaterThan(0);
    expect(handoff.sections.relevantFiles).toContain('src/index.ts');
    expect(handoff.sections.relevantFiles).not.toContain('src/removed.ts');
    expect(handoff.repository.missingReferencedFiles).toContain('src/removed.ts');
    expect(fs.readFileSync(paths.handoffMarkdown, 'utf8')).not.toContain(
      'super-secret-fixture-value'
    );
    expect(fs.readFileSync(paths.evidenceJsonl, 'utf8')).toContain('[REDACTED]');
    expect(fs.existsSync(paths.handoffJson)).toBe(true);
    expect(fileHash(sourcePath)).toBe(before);

    const evidence = await readHandoffEvidence({
      identifier: handoff.id,
      handoffsDir: handoffsRoot,
      tests: true,
    });
    expect(evidence.events.some(event => /tests passed/i.test(event.text))).toBe(true);
    expect(evidence.events.some(event => /private reasoning/i.test(event.text))).toBe(false);

    const toolResults = await readHandoffEvidence({
      identifier: handoff.id,
      handoffsDir: handoffsRoot,
      kind: 'tool_result',
    });
    const unwrapped = toolResults.events.find(event =>
      /lint found no error strings/.test(event.text)
    );
    expect(unwrapped).toBeDefined();
    expect(unwrapped!.text).not.toContain('input_text');
  });

  test('unwraps JSON content-block tool output and classifies by explicit markers', () => {
    expect(normalizeToolOutput('[{"type":"input_text","text":"Exit code: 0\\nAll good"}]')).toBe(
      'Exit code: 0\nAll good'
    );
    expect(normalizeToolOutput('plain text output')).toBe('plain text output');
    expect(classifyToolOutput('Script completed\nOutput:\nno error strings found')).toBe(
      'tool_result'
    );
    expect(classifyToolOutput('Script failed\nWall time 1.0 seconds')).toBe('error');
    expect(classifyToolOutput('Exit code: 2\nsomething broke')).toBe('error');
    expect(classifyToolOutput('Exit code: 0\nerror handling docs updated')).toBe('tool_result');
    expect(classifyToolOutput('fatal error: cannot continue')).toBe('error');
  });

  test('rejects a stale numbered list fingerprint', async () => {
    await expect(
      handleHandoffCommand({
        action: 'create',
        projectPath,
        sources: ['codex'],
        selection: 1,
        listId: 'stale-list-id',
      })
    ).rejects.toThrow('Session list changed');
  });

  test('session titles redact likely secret values', () => {
    const title = cleanTitle('api_key=super-secret-title-value fix the auth flow for src/index.ts');
    expect(title).not.toContain('super-secret-title-value');
    expect(title).toContain('[REDACTED]');
    expect(cleanTitle('Bearer abcdefghijklmnop should never surface')).not.toContain(
      'abcdefghijklmnop'
    );
  });

  test('normalizes escaped tool output into credible file references', () => {
    const event = {
      text: '128ms\\ntests/cli-contracts.test.js\\n\\u001b[90msrc/runtime/handoff/catalog.ts\\u001b[39m\\n--json/nskills/ambiance/README.md',
    } as NormalizedHandoffEvent;
    expect(extractReferencedFiles(projectPath, [event])).toEqual([
      'src/runtime/handoff/catalog.ts',
      'tests/cli-contracts.test.js',
    ]);
  });

  test('Claude normalization omits thinking blocks', async () => {
    const result = await handleHandoffCommand({
      action: 'create',
      projectPath,
      sources: ['claude'],
      selection: 1,
      compact: true,
      handoffsDir: handoffsRoot,
    });
    const paths = result.paths as HandoffArtifactPaths;
    const evidence = fs.readFileSync(paths.evidenceJsonl, 'utf8');
    expect(evidence).toContain('compact handoff option');
    expect(evidence).toContain('src/index.ts exists');
    expect(evidence).not.toContain('private reasoning');
    expect(evidence).not.toContain('Base directory for this skill');
  });
});
