const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

jest.setTimeout(120000);
test('published upload workflow executes across CLI processes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-entrypoint-'));
  const root = path.join(temp, 'project');
  const home = path.join(temp, 'home');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"upload-fixture"}');
  fs.writeFileSync(
    path.join(root, 'src', 'ui.ts'),
    'export const label = "Cancel upload after a retry";\n'
  );
  fs.writeFileSync(
    path.join(root, 'src', 'retry.ts'),
    "import { abortUpload } from './adapterA';\nexport function retryUpload() { return abortUpload(); }\n"
  );
  fs.writeFileSync(
    path.join(root, 'src', 'adapterA.ts'),
    'export function abortUpload() { return "adapter-a"; }\n'
  );
  fs.writeFileSync(
    path.join(root, 'src', 'adapterB.ts'),
    'export function abortUpload() { return "adapter-b"; }\n'
  );
  const run = (...args) => {
    const child = spawnSync(
      process.execPath,
      ['dist/src/cli.js', 'explore', ...args, '--json', '--project-path', root],
      {
        cwd: path.resolve(__dirname, '..'),
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, AMBIANCE_HOME: home, LOG_LEVEL: 'silent' },
      }
    );
    if (child.status !== 0)
      throw new Error(`CLI exited ${child.status}: ${child.stderr}\n${child.stdout}`);
    return JSON.parse(child.stdout);
  };
  try {
    const literal = run('search', 'cancel upload retry');
    expect(literal.targets).toHaveLength(0);
    expect(literal.nextAction.action).toBe('discover');
    expect(literal.nextAction.query).toBe('cancel upload retry');
    const found = run(literal.nextAction.action, literal.nextAction.query);
    const handler = found.targets.find(t => t.file.endsWith('retry.ts'));
    expect(handler).toBeDefined();
    expect(handler.reason).toBeTruthy();
    const read = run('read', '--ref', handler.ref);
    expect(read.evidence.some(e => e.content.includes('abortUpload'))).toBe(true);
    const followed = run('follow', '--ref', handler.ref, '--relation', 'dependencies');
    expect(followed.success).toBe(true);
    const candidates = run('discover', 'abortUpload');
    const adapters = candidates.targets.filter(t => /adapter[AB]\.ts$/.test(t.file));
    expect(adapters).toHaveLength(2);
    const both = run('read', '--selections', JSON.stringify(adapters.map(t => ({ ref: t.ref }))));
    expect(both.evidence.map(e => e.content).join('\n')).toContain('adapter-a');
    expect(both.evidence.map(e => e.content).join('\n')).toContain('adapter-b');
    const partial = run(
      'read',
      '--selections',
      JSON.stringify([{ ref: adapters[0].ref }, { ref: 'bad-ref' }])
    );
    expect(partial.results.map(r => r.outcome)).toEqual(['delivered', 'error']);
    expect(partial.evidence).toHaveLength(1);
    const batch = run('discover', '--queries', JSON.stringify(['retry upload', 'abortUpload']));
    expect(batch.results.map(r => r.query)).toEqual(['retry upload', 'abortUpload']);
    const direct = run('read', '--file-path', 'src/retry.ts', '--symbol', 'retryUpload');
    expect(direct.evidence[0].content).toContain('abortUpload');
    for (const args of [
      ['discover', '--queries', 'invalid-json'],
      ['discover', '--queries', '[]'],
      ['discover', '--query', 'retry', '--queries', '["upload"]'],
      ['discover', 'retry', '--mode', 'bogus'],
      ['search', 'retry', '--mode', 'bogus'],
      ['unknown', 'retry'],
      ['read', '--selections', '{}'],
    ]) {
      const invalid = spawnSync(
        process.execPath,
        ['dist/src/cli.js', 'explore', ...args, '--json', '--project-path', root],
        {
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf8',
          env: { ...process.env, AMBIANCE_HOME: home },
        }
      );
      expect(invalid.status).not.toBe(0);
      expect(JSON.parse(invalid.stdout).success).toBe(false);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
