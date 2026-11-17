const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { analyzeProjectIndexableFiles } = require('../dist/src/runtime/embeddings/projectManagement.js');

test('coverage discovery honors nested project ignores and excludes textless files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-discovery-'));
  const write = (file, content) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  try {
    write('app/.gitignore', '/src/generated/\nnext-env.d.ts\n');
    write('app/src/generated/client.ts', 'export const generated = true;');
    write('app/next-env.d.ts', '/// <reference types="next" />');
    write('app/src/entry.ts', 'export const entry = 1;');
    write('app/service/main.py', 'def ready():\n    return True\n');
    write('app/service/__init__.py', '\uFEFF\n \t');
    write('app/empty.ts', '');
    write('app/package-lock.json', '{"lockfileVersion":3}');
    write('app/src/entry.test.ts', 'export const test = true;');
    const result = await analyzeProjectIndexableFiles(root);
    assert.equal(result.scanSuccessful, true);
    assert.deepEqual(result.indexablePaths.map(p => p.replace(/\\/g, '/')).sort(),
      ['app/service/main.py', 'app/src/entry.ts']);
    assert.equal(result.indexableFiles, 2);
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-discovery-state-'));
    try {
      const probe = `const {checkStaleFiles}=require(${JSON.stringify(require.resolve('../dist/src/runtime/embeddings/manageEmbeddings.js'))});checkStaleFiles({projectPath:process.argv[1],autoUpdate:false}).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});`;
      const child = spawnSync(process.execPath, ['-e', probe, root], {
        encoding: 'utf8', timeout: 30000,
        env: { ...process.env, LOG_LEVEL: 'silent', NODE_NO_WARNINGS: '1', USE_LOCAL_EMBEDDINGS: 'true',
          USE_OPENAI_EMBEDDINGS: 'false', AMBIANCE_HOME: path.join(state, 'home'),
          LOCAL_STORAGE_PATH: path.join(state, 'storage') },
      });
      assert.equal(child.status, 0, child.stderr);
      const stale = JSON.parse(child.stdout);
      assert.deepEqual(stale.newFiles.map(f => f.filePath.replace(/\\/g, '/')).sort(),
        ['app/service/main.py', 'app/src/entry.ts']);
    } finally {
      if (!path.resolve(state).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unexpected state path');
      fs.rmSync(state, { recursive: true, force: true });
    }
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unexpected fixture path');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
