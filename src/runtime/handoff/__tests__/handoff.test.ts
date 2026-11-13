import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { classifyToolOutput, normalizeToolOutput } from '../adapters/shared';
import { listSessions } from '../catalog';
import { captureRepositoryState, extractReferencedFiles } from '../repository';
import { handleHandoffCommand } from '../service';
import { readHandoffEvidence } from '../storage';
import { cleanTitle } from '../utils';
import type {
  HandoffArtifactPaths,
  HandoffV1,
  NormalizedHandoffEvent,
  SessionSummary,
} from '../types';

function fileHash(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('portable handoffs', () => {
  let root: string;
  let projectPath: string;
  let codexRoot: string;
  let claudeRoot: string;
  let handoffsRoot: string;
  let codexSessionIndex: string;
  const previousEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-handoff-'));
    projectPath = path.join(root, 'project');
    codexRoot = path.join(root, 'codex');
    claudeRoot = path.join(root, 'claude');
    handoffsRoot = path.join(root, 'handoffs');
    codexSessionIndex = path.join(root, 'session_index.jsonl');
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
    fs.writeFileSync(
      codexSessionIndex,
      `${JSON.stringify({
        id: 'codex-fixture-session',
        thread_name: 'Codex provider indexed handoff title',
        updated_at: '2026-07-14T10:00:01.000Z',
      })}\n`
    );
    const older = new Date('2026-07-14T10:05:00.000Z');
    const newer = new Date('2026-07-14T11:05:00.000Z');
    fs.utimesSync(path.join(codexRoot, 'codex.jsonl'), older, older);
    fs.utimesSync(path.join(claudeRoot, 'claude.jsonl'), newer, newer);

    for (const key of [
      'AMBIANCE_CODEX_SESSIONS_DIR',
      'AMBIANCE_CODEX_SESSION_INDEX',
      'AMBIANCE_CLAUDE_PROJECTS_DIR',
      'AMBIANCE_HANDOFF_CACHE_DIR',
      'AMBIANCE_HANDOFFS_DIR',
      'CODEX_THREAD_ID',
    ]) {
      previousEnv[key] = process.env[key];
    }
    process.env.AMBIANCE_CODEX_SESSIONS_DIR = codexRoot;
    process.env.AMBIANCE_CODEX_SESSION_INDEX = codexSessionIndex;
    process.env.AMBIANCE_CLAUDE_PROJECTS_DIR = claudeRoot;
    process.env.AMBIANCE_HANDOFF_CACHE_DIR = path.join(root, 'cache');
    process.env.AMBIANCE_HANDOFFS_DIR = handoffsRoot;
    delete process.env.CODEX_THREAD_ID;
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
      title: 'Codex provider indexed handoff title',
    });
    expect(listed.listId).toMatch(/^[a-f0-9]{16}$/);
    expect(fs.existsSync(path.join(root, 'cache', 'handoff-catalog-v1.json'))).toBe(true);
  });

  test('uses the rollout filename as the canonical Codex id and provider metadata as its title', () => {
    const canonicalId = '11111111-2222-4333-8444-555555555555';
    const sourcePath = path.join(codexRoot, `rollout-2026-07-14T10-00-00-${canonicalId}.jsonl`);
    fs.writeFileSync(
      sourcePath,
      [
        `{"timestamp":"2026-07-14T10:00:00.000Z","type":"session_meta","payload":{"session_id":"legacy-compacted-id","cwd":"${projectPath.replace(/\\/g, '\\\\')}"}}`,
        '{"timestamp":"2026-07-14T10:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"Fallback transcript title"}}',
      ].join('\n') + '\n'
    );
    fs.appendFileSync(
      codexSessionIndex,
      `${JSON.stringify({
        id: canonicalId,
        thread_name: 'Canonical Codex UI title',
        updated_at: '2026-07-14T10:00:02.000Z',
      })}\n`
    );

    const listed = listSessions({ projectPath, sources: ['codex'], limit: 10 });
    expect(listed.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: canonicalId,
          title: 'Canonical Codex UI title',
        }),
      ])
    );
    expect(listed.sessions.some(session => session.sessionId === 'legacy-compacted-id')).toBe(
      false
    );
  });

  test('excludes the active Codex task unless explicitly requested', () => {
    process.env.CODEX_THREAD_ID = 'codex-fixture-session';
    expect(listSessions({ projectPath, sources: ['codex'] }).sessions).toHaveLength(0);
    expect(
      listSessions({ projectPath, sources: ['codex'], includeCurrent: true }).sessions
    ).toHaveLength(1);
  });

  test('ranks redacted normalized conversation text with an incremental FTS cache', async () => {
    const first = await handleHandoffCommand({
      action: 'search',
      query: 'normalized adapter',
      projectPath,
      sources: ['codex'],
      limit: 5,
    });
    const results = first.results as Array<{
      sessionId: string;
      score: number;
      snippet: string;
    }>;
    expect(results[0]).toMatchObject({ sessionId: 'codex-fixture-session' });
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].snippet).toMatch(/normalized/i);
    expect(first.indexing).toMatchObject({ indexedSessions: 1, reusedSessions: 0 });
    expect(fs.existsSync(path.join(root, 'cache', 'handoff-search-v1.sqlite'))).toBe(true);

    const redactedSecret = await handleHandoffCommand({
      action: 'search',
      query: 'super-secret-fixture-value',
      projectPath,
      sources: ['codex'],
      limit: 5,
    });
    expect(redactedSecret.results).toEqual([]);

    const second = await handleHandoffCommand({
      action: 'search',
      query: 'normalized adapter',
      projectPath,
      sources: ['codex'],
      limit: 5,
    });
    expect(second.indexing).toMatchObject({ indexedSessions: 0, reusedSessions: 1 });

    const privateReasoning = await handleHandoffCommand({
      action: 'search',
      query: 'private reasoning',
      projectPath,
      sources: ['claude'],
      limit: 5,
    });
    expect(privateReasoning.results).toEqual([]);
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

  test('refreshes handoff code evidence without enabling or maintaining project embeddings', async () => {
    fs.writeFileSync(path.join(projectPath, 'package.json'), '{}\n');
    const semanticCompact = await import('../../context/semanticCompact');
    const contextSpy = jest.spyOn(semanticCompact, 'handleSemanticCompact').mockResolvedValue({
      jumpTargets: [
        {
          file: path.join(projectPath, 'src', 'index.ts'),
          symbol: 'fixture',
          start: 1,
          end: 1,
        },
      ],
    });
    const session: SessionSummary = {
      sessionId: 'bounded-repository-refresh',
      source: 'claude',
      title: 'Bounded repository refresh',
      sourcePath: path.join(claudeRoot, 'claude.jsonl'),
      cwd: projectPath,
      updatedAt: new Date().toISOString(),
      sizeBytes: 1,
    };
    const events = [
      {
        id: 'event-1',
        kind: 'assistant',
        text: 'Review src/index.ts and the fixture symbol.',
        sourceRef: {
          id: 'event-1',
          source: 'claude',
          sessionId: session.sessionId,
          sourcePath: session.sourcePath,
          line: 1,
          contentHash: 'hash',
        },
      },
    ] as NormalizedHandoffEvent[];

    try {
      const repository = await captureRepositoryState({ projectPath, session, events });
      expect(repository.codeEvidence).toEqual([
        expect.objectContaining({ file: 'src/index.ts', symbol: 'fixture' }),
      ]);
      expect(contextSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          useEmbeddings: false,
          disableEmbeddings: true,
          generateEmbeddingsIfMissing: false,
          autoSync: false,
        })
      );
    } finally {
      contextSpy.mockRestore();
    }
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
