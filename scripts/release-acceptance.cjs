// Pack and install a consumer candidate, then exercise its real indexing lifecycle.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const repo = path.resolve(__dirname, '..');
const arg = key => {
  const i = process.argv.indexOf(key);
  return i < 0 ? undefined : process.argv[i + 1];
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance release acceptance '));
const out = path.resolve(arg('--out') || path.join(root, 'reports'));
fs.mkdirSync(out, { recursive: true });
assert.ok(
  !fs.existsSync(path.join(out, 'acceptance.json')),
  'Use a new output directory to preserve previous results'
);
const env = {
  ...process.env,
  LOG_LEVEL: 'silent',
  NODE_ENV: 'production',
  USE_LOCAL_EMBEDDINGS: 'true',
  USE_OPENAI_EMBEDDINGS: 'false',
  USE_VOYAGEAI_EMBEDDINGS: 'false',
  LOCAL_EMBEDDING_MODEL: 'all-MiniLM-L6-v2',
  LOCAL_STORAGE_PATH: path.join(root, 'storage'),
  RC_MODEL_CACHE: path.resolve(
    arg('--model-cache') || path.join(repo, 'node_modules/@huggingface/transformers/.cache')
  ),
  RC_OFFLINE: process.argv.includes('--offline') ? '1' : '0',
};
for (const name of [
  'OPENAI_API_KEY',
  'AMBIANCE_API_KEY',
  'ANTHROPIC_API_KEY',
  'NODE_OPTIONS',
  'WORKSPACE_FOLDER',
  'AMBIANCE_BASE_DIR',
  'AMBIANCE_SKIP_INDEXING',
  'npm_lifecycle_event',
])
  delete env[name];
const result = {
  root,
  platform: process.platform,
  node: process.version,
  checks: [],
  commands: [],
};
const save = () =>
  fs.writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function shellNpm(args, cwd, name) {
  const npmCli = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  ].find(p => p && fs.existsSync(p));
  assert.ok(process.platform !== 'win32' || npmCli, 'Cannot locate npm-cli.js');
  const command = npmCli ? process.execPath : npm;
  const argv = npmCli ? [npmCli, ...args] : args;
  const r = spawnSync(command, argv, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 20e6,
    windowsHide: true,
  });
  fs.writeFileSync(path.join(out, name + '.log'), String(r.stdout || '') + String(r.stderr || ''));
  assert.equal(r.status, 0, `${name} failed: ${r.error || String(r.stderr).slice(-600)}`);
  return r.stdout;
}
let tarball = arg('--tarball');
if (!tarball) {
  // npm pack's prepare hook builds only the resolved workspace dist directory.
  assert.equal(path.dirname(path.resolve(repo, 'dist')), repo);
  const packed = shellNpm(['pack', '--json', '--pack-destination', root], repo, 'pack');
  const start = packed.search(/\[\s*\{/);
  assert.ok(start >= 0, 'npm pack did not return its JSON manifest');
  const json = JSON.parse(packed.slice(start));
  tarball = path.join(root, json[0].filename);
}
tarball = path.resolve(tarball);
result.tarball = tarball;
result.tarball_sha256 = createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
const consumer = path.join(root, 'consumer');
fs.mkdirSync(consumer);
fs.writeFileSync(
  path.join(consumer, 'package.json'),
  JSON.stringify({ private: true, name: 'ambiance-rc-consumer', version: '1.0.0' })
);
shellNpm(['install', '--omit=dev', '--no-audit', '--no-fund', tarball], consumer, 'install');
const pkg = path.join(consumer, 'node_modules/@jackjackstudios/ambiance-cli');
env.RC_PACKAGE_ROOT = pkg;
const cli = path.join(pkg, 'dist/src/cli.js');
assert.ok(fs.existsSync(cli));
assert.ok(!fs.existsSync(path.join(pkg, 'src/cli.ts')));
const Database = require(require.resolve('better-sqlite3', { paths: [pkg] }));
const hook = path.join(repo, 'scripts/release-observer.cjs');
let serial = 0;
function command(project, args, extra = {}, expected = 0) {
  const id = String(++serial).padStart(3, '0');
  const usageFile = path.join(out, id + '-usage.json');
  const start = performance.now();
  const r = spawnSync(
    process.execPath,
    ['-r', hook, cli, ...args, '--json', '--project-path', project],
    {
      cwd: consumer,
      env: { ...env, RC_USAGE_FILE: usageFile, ...extra },
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 15e6,
      windowsHide: true,
    }
  );
  fs.writeFileSync(path.join(out, id + '-stdout.txt'), r.stdout || '');
  fs.writeFileSync(path.join(out, id + '-stderr.txt'), r.stderr || '');
  const record = {
    id,
    args,
    project,
    status: r.status,
    seconds: (performance.now() - start) / 1000,
    usage: fs.existsSync(usageFile) ? JSON.parse(fs.readFileSync(usageFile)) : null,
  };
  result.commands.push(record);
  save();
  assert.equal(
    r.status,
    expected,
    `CLI ${id}: ${r.error || String(r.stderr).slice(-300)} ${String(r.stdout).slice(-300)}`
  );
  if (expected !== 0) return record;
  const data = JSON.parse(r.stdout.trim());
  assert.notEqual(
    data.success,
    false,
    `CLI ${id} reported failure: ${JSON.stringify(data).slice(0, 500)}`
  );
  return { ...record, data };
}
function check(name, operation) {
  try {
    operation();
    result.checks.push({ name, passed: true });
    console.log('PASS ' + name);
  } catch (error) {
    result.checks.push({ name, passed: false, error: String(error) });
    console.log('FAIL ' + name + ': ' + error.message);
  }
  save();
}
const db = operation => {
  const d = new Database(path.join(env.LOCAL_STORAGE_PATH, 'embeddings.db'));
  try {
    return operation(d);
  } finally {
    d.close();
  }
};
const projectIds = new Map();
const rows = project =>
  db(d =>
    d
      .prepare(
        'SELECT file_path,chunk_index,content,hex(embedding) vector,metadata_start_line,metadata_end_line,metadata_embedding_input_key FROM embeddings WHERE project_id=? ORDER BY file_path,chunk_index'
      )
      .all(projectIds.get(project))
  );
const files = project =>
  db(d => d.prepare('SELECT * FROM files WHERE project_id=?').all(projectIds.get(project)));
const normalized = value => value.replace(/\\/g, '/');
function write(project, relative, content) {
  const file = path.join(project, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const time = new Date(Date.now() + 2000);
  fs.utimesSync(file, time, time);
}
for (const [name, extension] of [
  ['typescript project', 'ts'],
  ['mixed project', 'js'],
]) {
  const project = path.join(root, name);
  fs.mkdirSync(project);
  const main = 'src/main.' + extension,
    helper = 'src/helper.' + extension;
  const source = n =>
    `import { rate } from './helper';\nexport function invoiceTotal() { return rate + ${n}; }\n`;
  write(
    project,
    'package.json',
    JSON.stringify({ name: name.replace(/ /g, '-'), version: '1.0.0' })
  );
  write(project, main, source(123));
  write(project, helper, 'export const rate = 7;\n');
  write(project, 'dist/ignored.' + extension, 'export const shouldNeverAppear = 99;\n');
  if (extension === 'js')
    write(project, 'notes.py', 'def invoice_notes():\n    return "retained python evidence"\n');
  check(name + ': installed doctor and skill', () => {
    command(project, ['doctor', '--no-embeddings']);
    command(project, ['skill', 'verify', '--no-embeddings']);
  });
  check(name + ': cold index', () => {
    const c = command(project, [
      'embeddings',
      'create',
      '--force',
      'true',
      ...(extension === 'js' ? ['--quantization', 'float32'] : []),
    ]);
    projectIds.set(project, c.data.projectId);
    env.RC_OFFLINE = '1'; // Only the initial model load may download; later processes use the cache.
    assert.ok(c.usage.inferenceInputs > 0);
    const r = rows(project);
    assert.ok(r.length > 2);
    assert.ok(!r.some(x => normalized(x.file_path).startsWith('dist/')));
    const groups = new Map();
    for (const x of r) {
      const values = groups.get(x.file_path) || [];
      values.push(x.chunk_index);
      groups.set(x.file_path, values);
      assert.ok(x.vector.length > 0);
    }
    for (const values of groups.values())
      assert.deepEqual(
        values,
        values.map((_, i) => i)
      );
  });
  check(name + ': unchanged update uses no inference', () => {
    const before = rows(project);
    const c = command(project, ['embeddings', 'update']);
    assert.equal(c.usage.inferenceInputs, 0);
    assert.deepEqual(rows(project), before);
  });
  check(name + ': summary resolves project-relative path', () => {
    command(project, ['summary', main, '--no-embeddings']);
  });
  check(name + ': manifest symbols and AST search', () => {
    const manifest = command(project, ['manifest', '--no-embeddings']);
    assert.ok(JSON.stringify(manifest.data).includes('invoiceTotal'));
    const grep = command(project, [
      'grep',
      'invoiceTotal',
      '--file-pattern',
      'src',
      '--no-embeddings',
    ]);
    assert.ok(JSON.stringify(grep.data).includes('invoiceTotal'));
  });
  check(name + ': installed import graph resolves real project targets', () => {
    const code = `const path=require('node:path');const {buildImportGraph}=require(path.join(process.argv[1],'dist/src/tools/localTools/indexers.js'));const root=process.argv[2],files=JSON.parse(process.argv[3]);buildImportGraph(files.map(relPath=>({absPath:path.join(root,relPath),relPath,language:'typescript'}))).then(graph=>console.log(JSON.stringify([...graph]))).catch(e=>{console.error(e);process.exitCode=1});`;
    const r = spawnSync(
      process.execPath,
      ['-e', code, pkg, project, JSON.stringify([main, helper])],
      { cwd: consumer, env, encoding: 'utf8', timeout: 30000, windowsHide: true }
    );
    assert.equal(r.status, 0, r.stderr);
    const graph = new Map(JSON.parse(r.stdout));
    assert.deepEqual(graph.get(main), [helper]);
  });
  check(name + ': warm context', () => {
    const c = command(project, [
      'context',
      'invoiceTotal rate',
      '--embeddings',
      '--max-tokens',
      '1200',
    ]);
    assert.ok(JSON.stringify(c.data).includes('invoiceTotal'));
    assert.ok(!c.data.embeddingSync?.error);
    assert.equal(c.data.embeddingSync.checked, true);
    assert.equal(c.usage.inferenceInputs, 1);
    assert.ok(
      Number.isFinite(c.data.metadata.renderedTokens) && c.data.metadata.renderedTokens <= 1200
    );
  });
  check(name + ': edited source', () => {
    write(project, main, source(456));
    command(project, ['embeddings', 'update']);
    assert.ok(rows(project).some(x => x.content.includes('456')));
    assert.ok(!rows(project).some(x => x.content.includes('123')));
  });
  const added = 'src/new.' + extension,
    renamed = 'src/renamed.' + extension;
  check(name + ': added source', () => {
    write(project, added, 'export const newEvidence = 17;\n');
    command(project, ['embeddings', 'update']);
    assert.ok(rows(project).some(x => normalized(x.file_path) === added));
  });
  check(name + ': renamed source', () => {
    fs.renameSync(path.join(project, added), path.join(project, renamed));
    command(project, ['embeddings', 'update']);
    assert.ok(rows(project).some(x => normalized(x.file_path) === renamed));
    assert.ok(!files(project).some(x => normalized(x.path) === added));
  });
  check(name + ': deleted source', () => {
    fs.unlinkSync(path.join(project, renamed));
    command(project, ['embeddings', 'update']);
    assert.ok(!rows(project).some(x => normalized(x.file_path) === renamed));
    assert.ok(!files(project).some(x => normalized(x.path) === renamed));
  });
  check(name + ': inference failure is visible and retains old vectors', () => {
    const before = rows(project);
    write(project, main, source(789));
    const c = command(project, ['embeddings', 'update'], { RC_FAIL_INFERENCE: '1' }, 1);
    assert.deepEqual(rows(project), before);
  });
  check(name + ': retry repairs failed source', () => {
    command(project, ['embeddings', 'update']);
    assert.ok(rows(project).some(x => x.content.includes('789')));
  });
  check(name + ': partial inference failure is reported while successful files persist', () => {
    const before = rows(project).filter(x => normalized(x.file_path) === main);
    write(project, main, source(888));
    write(project, helper, 'export const rate = 8;\n');
    const c = command(project, ['embeddings', 'update'], { RC_FAIL_INFERENCE_FILE: main }, 1);
    const data = JSON.parse(fs.readFileSync(path.join(out, c.id + '-stdout.txt'), 'utf8'));
    assert.equal(data.success, false);
    assert.ok(data.result.processedFiles > 0);
    assert.deepEqual(
      rows(project).filter(x => normalized(x.file_path) === main),
      before
    );
    assert.ok(
      rows(project).some(x => normalized(x.file_path) === helper && x.content.includes('8'))
    );
    command(project, ['embeddings', 'update']);
    assert.ok(rows(project).some(x => x.content.includes('888')));
  });
  check(name + ': interrupted write stays incomplete', () => {
    write(project, main, source(999));
    const c = command(project, ['embeddings', 'update'], { RC_INTERRUPT_FILE: main }, 86);
    assert.equal(c.usage.interrupted, true);
    const file = files(project).find(x => normalized(x.path) === main);
    assert.equal(file.chunk_layout_version, null);
  });
  check(name + ': fresh process repairs interrupted write', () => {
    const c = command(project, [
      'context',
      'invoiceTotal rate',
      '--embeddings',
      '--max-tokens',
      '1200',
    ]);
    assert.ok(!c.data.embeddingSync?.error);
    assert.ok(rows(project).some(x => x.content.includes('999')));
    assert.equal(files(project).find(x => normalized(x.path) === main).chunk_layout_version, 2);
  });
  check(name + ': legacy layout repair preserves vectors', () => {
    const before = rows(project);
    db(d =>
      d
        .prepare('UPDATE files SET chunk_layout_version=1 WHERE project_id=?')
        .run(projectIds.get(project))
    );
    command(project, ['context', 'invoiceTotal', '--embeddings', '--max-tokens', '1200']);
    assert.deepEqual(rows(project), before);
    assert.ok(files(project).every(x => x.chunk_layout_version === 2));
  });
}
result.passed = result.checks.every(c => c.passed);
save();
console.log(
  JSON.stringify({
    passed: result.passed,
    checks: result.checks.length,
    failures: result.checks.filter(c => !c.passed).length,
    reports: out,
    root,
  })
);
process.exitCode = result.passed ? 0 : 1;
