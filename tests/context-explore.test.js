const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('agent-directed context exploration through the real runtime', () => {
  let root, home, beforeHome;
  const write = (file, source) => {
    const dest = path.join(root, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, source);
  };
  // Use actual Node modules: this repository's Jest globby/tree-sitter mocks
  // must not substitute a canned file list for these integration fixtures.
  const run = async args => {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `
      delete process.env.JEST_WORKER_ID;
      require('./dist/src/runtime/api').executeRuntime('explore',JSON.parse(process.env.EXPLORE_ARGS))
        .then(r=>process.stdout.write(JSON.stringify(r)))
        .catch(e=>{process.stderr.write(e.message);process.exitCode=1;});
    `,
      ],
      {
        cwd: path.resolve(__dirname, '..'),
        env: {
          ...process.env,
          LOG_LEVEL: 'silent',
          EXPLORE_ARGS: JSON.stringify({ projectPath: root, ...args }),
        },
        encoding: 'utf8',
      }
    );
    if (child.status !== 0) throw Error(child.stderr);
    return JSON.parse(child.stdout);
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-explore-project-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-explore-state-'));
    beforeHome = process.env.AMBIANCE_HOME;
    process.env.AMBIANCE_HOME = home;
    write('package.json', '{"name":"explore-fixture"}');
    write(
      'tsconfig.json',
      '{/* aliases */ "compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]},},}'
    );
    write(
      'src/app/api/launch/route.ts',
      `import { Client } from '@/client';
export async function POST() {
${Array.from({ length: 90 }, (_, i) => `  // unrelated setup ${i}`).join('\n')}
  const client = new Client();
  return client.createRun();
}
`
    );
    write(
      'src/client.ts',
      `import { apiPrefix } from './config';
export class Client {
  createRun() { return this.request('/runs'); }
  private request(p: string) { return fetch(apiPrefix + p); }
}
`
    );
    write('src/config.ts', `export const apiPrefix = '/api/v1';`);
    write(
      'remote/app/api/v1/runs/route.ts',
      'export async function POST() { return "versioned-handler"; }'
    );
    write(
      'remote/app/api/runs/route.ts',
      'export async function POST() { return "legacy-handler"; }'
    );
    write('.gitignore', 'hidden.ts\n');
    write('hidden.ts', 'export function hiddenSecret() {}');
  });
  afterEach(() => {
    if (beforeHome === undefined) delete process.env.AMBIANCE_HOME;
    else process.env.AMBIANCE_HOME = beforeHome;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });
  test('search is compact, state persists, and read preserves the entire function beyond a prefix', async () => {
    const found = await run({ action: 'search', query: 'client.createRun' });
    expect(found.evidence).toEqual([]);
    expect(found.targets).toHaveLength(1);
    const node = found.targets[0];
    expect(node.symbol).toBe('POST');
    const read = await run({ action: 'read', sessionId: found.sessionId, targetIds: [node.id] });
    expect(read.evidence[0].content).toContain('return client.createRun();');
    expect(read.evidence[0].end).toBeGreaterThan(90);
    expect(read.evidence[0].completeSymbol).toBe(true);
    const again = await run({
      action: 'search',
      query: 'client.createRun',
      sessionId: found.sessionId,
    });
    expect(again.targets).toEqual([]);
    expect(again.known[0].id).toBe(node.id);
    expect(again.evidence).toEqual([]);
  });
  test('object-literal and arrow-property methods retain their full boundaries and qualified owners', async () => {
    write(
      'src/objects.ts',
      `export const first = { async send(input: string) {\n${Array.from({ length: 90 }, (_, i) => `// setup ${i}`).join('\n')}\nreturn input;\n}, arrow: (x: number) => { return x + 1; } };\nexport const second = { send() { return 'other'; } };`
    );
    const result = await run({ action: 'read', filePath: 'src/objects.ts', symbol: 'first.send' });
    expect(result.evidence[0].completeSymbol).toBe(true);
    expect(result.evidence[0].end).toBeGreaterThan(90);
    expect(result.evidence[0].content).toContain('return input;');
    const arrow = await run({ action: 'read', filePath: 'src/objects.ts', symbol: 'first.arrow' });
    expect(arrow.evidence[0].completeSymbol).toBe(true);
    expect(arrow.evidence[0].content).toContain('x + 1');
  });
  test('agent-selected dependency hops resolve alias, class method, local method, and config', async () => {
    const first = await run({
      action: 'read',
      filePath: 'src/app/api/launch/route.ts',
      symbol: 'POST',
    });
    const deps = await run({
      action: 'follow',
      sessionId: first.sessionId,
      targetIds: [first.evidence[0].targetId],
    });
    const method = deps.targets.find(t => t.symbol === 'Client.createRun');
    expect(method.file).toBe('src/client.ts');
    expect(deps.targets.some(t => t.file.includes('remote/'))).toBe(false);
    const next = await run({
      action: 'follow',
      sessionId: first.sessionId,
      targetIds: [method.id],
    });
    const request = next.targets.find(t => t.symbol === 'Client.request');
    expect(request).toBeDefined();
    const config = await run({
      action: 'follow',
      sessionId: first.sessionId,
      targetIds: [request.id],
    });
    expect(config.targets.some(t => t.file === 'src/config.ts')).toBe(true);
  });
  test('does not guess across an HTTP prefix; an agent-verified path selects the versioned route', async () => {
    const read = await run({
      action: 'read',
      filePath: 'src/client.ts',
      symbol: 'Client.createRun',
    });
    const base = {
      action: 'follow',
      relation: 'routes',
      sessionId: read.sessionId,
      targetIds: [read.evidence[0].targetId],
    };
    const unknown = await run(base);
    expect(unknown.targets).toEqual([]);
    expect(unknown.unresolved[0].reason).toMatch(/base URL/);
    const resolved = await run({ ...base, query: '/api/v1/runs' });
    expect(resolved.targets.map(t => t.file)).toEqual(['remote/app/api/v1/runs/route.ts']);
    expect(resolved.targets[0].reason.kind).toBe('route_path_candidate');
    const scoped = await run({ action: 'search', query: 'POST', scope: 'remote/app/api/v1' });
    expect(scoped.targets.map(t => t.file)).toEqual(['remote/app/api/v1/runs/route.ts']);
    const pathSearch = await run({ action: 'search', query: '/api/launch' });
    expect(pathSearch.targets.find(t => t.file === 'src/app/api/launch/route.ts').symbol).toBe(
      'POST'
    );
  });
  test('changed source invalidates old IDs and re-search returns its new revision', async () => {
    const found = await run({ action: 'search', query: 'client.createRun' });
    const old = found.targets[0];
    write(old.file, 'export function POST() { return "changed"; }');
    await expect(
      run({ action: 'read', sessionId: found.sessionId, targetIds: [old.id] })
    ).rejects.toThrow(/Stale target/);
    const status = await run({ action: 'status', sessionId: found.sessionId });
    expect(status.state.staleTargets).toContain(old.id);
    const fresh = await run({ action: 'search', sessionId: found.sessionId, query: 'changed' });
    expect(fresh.targets[0].id).not.toBe(old.id);
  });
  test('defers oversized source atomically instead of cutting a function or marking it returned', async () => {
    const result = await run({
      action: 'read',
      filePath: 'src/app/api/launch/route.ts',
      symbol: 'POST',
      maxTokens: 256,
    });
    expect(result.evidence).toEqual([]);
    expect(result.deferred).toHaveLength(1);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1024);
    const status = await run({ action: 'status', sessionId: result.sessionId });
    expect(status.state.returnedSourceTargets).toBe(0);
    const retried = await run({
      action: 'read',
      sessionId: result.sessionId,
      targetIds: [result.deferred[0].id],
      maxTokens: 6000,
    });
    expect(retried.evidence[0].completeSymbol).toBe(true);
  });
  test('ignores excluded source, rejects path escape and project/session mixing', async () => {
    await expect(run({ action: 'read', filePath: 'hidden.ts' })).rejects.toThrow(
      /non-ignored source/
    );
    await expect(run({ action: 'read', filePath: '../outside.ts' })).rejects.toThrow(
      /leaves project/
    );
    const found = await run({ action: 'search', query: 'client.createRun' });
    await expect(
      run({ projectPath: home, action: 'status', sessionId: found.sessionId })
    ).rejects.toThrow(/another project/);
  });
  test('CLI sessions work across fresh processes and do not load embedding/model providers', () => {
    const probe = spawnSync(
      process.execPath,
      [
        '-e',
        `
      const {executeRuntime}=require('./dist/src/runtime/api');
      executeRuntime('explore',{projectPath:process.env.EXPLORE_FIXTURE,query:'client.createRun'}).then(r=>{
        if(Object.keys(require.cache).some(p=>/embeddingGenerator|localEmbeddingProvider|openaiService/.test(p)))throw Error('provider loaded');
        process.stdout.write(JSON.stringify(r));
      }).catch(e=>{console.error(e);process.exitCode=1;});
    `,
      ],
      {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, EXPLORE_FIXTURE: root },
        encoding: 'utf8',
      }
    );
    expect(probe.status).toBe(0);
    const found = JSON.parse(probe.stdout);
    const read = spawnSync(
      process.execPath,
      [
        'dist/src/cli.js',
        'explore',
        'read',
        '--session-id',
        found.sessionId,
        '--target-ids',
        found.targets[0].id,
        '--project-path',
        root,
        '--json',
      ],
      { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8' }
    );
    expect(read.status).toBe(0);
    expect(JSON.parse(read.stdout).evidence[0].content).toContain('client.createRun');
  });
  test('discovers multi-term words, batches queries fairly, and reads copied references', async () => {
    write(
      'src/upload.ts',
      `export function cancelUploadAfterRetry() {\n  return abortUpload();\n}\nexport function abortUpload() { return 'cancelled'; }`
    );
    const literal = await run({ action: 'search', query: 'cancel upload retry' });
    expect(literal.targets).toEqual([]);
    expect(literal.nextAction).toMatchObject({ action: 'discover', query: 'cancel upload retry' });
    const found = await run({
      action: 'discover',
      queries: ['cancel upload retry', 'createRun'],
      maxTokens: 2000,
    });
    expect(found.results).toHaveLength(2);
    expect(found.results[0].targets[0].symbol).toBe('cancelUploadAfterRetry');
    expect(found.results[1].targets[0].symbol).toBe('Client.createRun');
    const refs = found.results.map(g => g.targets[0].ref);
    const read = await run({
      action: 'read',
      selections: [{ ref: refs[0] }, { ref: refs[1] }, { filePath: 'missing.ts' }],
    });
    expect(read.results.map(r => r.outcome)).toEqual(['delivered', 'delivered', 'error']);
    expect(read.evidence.map(e => e.symbol)).toEqual([
      'cancelUploadAfterRetry',
      'Client.createRun',
    ]);
    const hop = await run({ action: 'follow', ref: refs[0] });
    expect([...hop.targets, ...hop.known].some(t => t.symbol === 'abortUpload')).toBe(true);
    write('src/upload.ts', `export function cancelUploadAfterRetry() { return 'new'; }`);
    await expect(run({ action: 'read', ref: refs[0] })).rejects.toThrow(/Stale target/);
    await expect(run({ action: 'read', projectPath: home, ref: refs[1] })).rejects.toThrow(
      /another project/
    );
  });
  test('batch reads report deferred and invalid items while retaining later small bodies', async () => {
    const result = await run({
      action: 'read',
      selections: [
        { filePath: 'src/app/api/launch/route.ts', symbol: 'POST' },
        { filePath: 'src/config.ts', startLine: 1, endLine: 1 },
        { ref: 'bad' },
      ],
      maxTokens: 700,
    });
    expect(result.results.map(r => r.outcome)).toEqual(['budget_deferred', 'delivered', 'error']);
    expect(result.deferred[0].ref).toMatch(/^e1\./);
    expect(result.evidence[0].content).toContain('apiPrefix');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2800);
    const retried = await run({ action: 'read', ref: result.deferred[0].ref });
    expect(retried.evidence[0].completeSymbol).toBe(true);
  });
  test('hybrid discovery reports an unavailable ready index and falls back to lexical', async () => {
    const result = await run({ action: 'discover', query: 'createRun', mode: 'hybrid' });
    expect(result.effectiveMode).toBe('lexical');
    expect(result.indexStatus).toBe('unavailable');
    expect(result.targets[0].symbol).toBe('Client.createRun');
  });
  test('finds exact constants, unicode and single-character identifiers', async () => {
    write(
      'src/names.ts',
      'export const stopRetry = true;\nexport const z = 1;\nexport const café = 2;'
    );
    for (const query of ['stopRetry', 'z', 'café']) {
      const result = await run({ action: 'discover', query });
      expect(result.targets[0].symbol).toBe(query);
      expect(result.targets[0].reason.kind).toBe('exact_identifier_or_path');
    }
  });
  test('compactly accounts for ten queries under a small overall budget', async () => {
    const queries = Array.from({ length: 10 }, (_, i) => `createRun ${i} ${'x'.repeat(100)}`);
    const result = await run({ action: 'discover', queries, maxTokens: 256 });
    expect(result.results).toHaveLength(10);
    expect(result.results.map((g, i) => g.index ?? i)).toEqual(queries.map((_, i) => i));
    expect(result.results.some(g => g.outcome === 'budget_deferred')).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1024);
  });
  test('keeps batch read dispositions when errors and large selections exceed budget', async () => {
    const selections = Array.from({ length: 10 }, (_, i) => ({
      filePath: `missing-${i}-${'x'.repeat(100)}.ts`,
    }));
    const result = await run({ action: 'read', selections, maxTokens: 256 });
    expect(result.results.map(r => r.outcome)).toEqual(selections.map(() => 'error'));
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1024);
  });
});
