const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const schemas = require('./cli-contracts.schemas');

function runCli(args, extraEnv) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    LOG_LEVEL: 'error',
    USE_LOCAL_EMBEDDINGS: 'false',
    ...(extraEnv || {}),
  };

  delete env.WORKSPACE_FOLDER;
  delete env.AMBIANCE_BASE_DIR;

  const result = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register', 'src/cli.ts', ...args],
    {
      encoding: 'utf8',
      env,
    }
  );

  if (result.error) {
    const details = [
      `spawnSync failed: ${result.error.message}`,
      `code=${result.error.code || 'unknown'}`,
      `syscall=${result.error.syscall || 'unknown'}`,
      `path=${result.error.path || process.execPath}`,
      `args=${JSON.stringify(['-r', 'ts-node/register', 'src/cli.ts', ...args])}`,
    ].join('\n');
    throw new Error(details);
  }

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseJsonStdout(stdout) {
  const trimmed = String(stdout).trim();
  expect(trimmed.length).toBeGreaterThan(0);
  return JSON.parse(trimmed);
}

describe('CLI JSON contracts', () => {
  test('doctor --json returns valid JSON', () => {
    const res = runCli(['doctor', '--json']);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.doctorSchema.parse(payload);
  });

  test('skill verify --json returns valid JSON', () => {
    const res = runCli(['skill', 'verify', '--json']);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.skillVerifySchema.parse(payload);
  });

  test('skill verify --json returns success=false + exit code 1 when skills dir is missing', () => {
    const res = runCli(['skill', 'verify', '--json'], {
      AMBIANCE_SKILLS_DIR: path.join(process.cwd(), 'test-storage', `missing-skills-${Date.now()}`),
    });
    expect(res.status).toBe(1);
    const payload = parseJsonStdout(res.stdout);
    schemas.jsonEnvelopeSchema.parse(payload);
    expect(payload.command).toBe('skill');
    expect(payload.success).toBe(false);
    expect(payload.exitCode).toBe(1);
    expect(payload.skills.errors.join('\n')).toContain('skills/ambiance directory not found');
  });

  test('migrate mcp-map --json returns valid JSON', () => {
    const res = runCli(['migrate', 'mcp-map', '--json']);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.migrateMcpMapSchema.parse(payload);
  });

  test('hints --json returns valid JSON', () => {
    const res = runCli([
      'hints',
      '--json',
      '--project-path',
      process.cwd(),
      '--max-files',
      '5',
    ]);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.hintsSchema.parse(payload);
    expect(payload.success).toBe(true);
  });

  test('context --json returns valid JSON', () => {
    const res = runCli([
      'context',
      '--json',
      '--project-path',
      process.cwd(),
      '--query',
      'High-level overview',
      '--max-tokens',
      '200',
    ]);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.contextSchema.parse(payload);
    expect(payload.success).toBe(true);
  });

  test('debug --json returns valid JSON', () => {
    const res = runCli([
      'debug',
      '--json',
      '--project-path',
      process.cwd(),
      'Error: Something went wrong\n    at Object.<anonymous> (src/cli.ts:1:1)',
      '--max-matches',
      '3',
    ]);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.debugSchema.parse(payload);
    expect(payload.success).toBe(true);
  });

  test('frontend --json returns valid JSON', () => {
    const res = runCli([
      'frontend',
      '--json',
      '--project-path',
      process.cwd(),
      '--subtree',
      'src',
      '--max-files',
      '3',
    ]);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.frontendSchema.parse(payload);
    expect(payload.success).toBe(true);
  });

  test('grep --json returns valid JSON', () => {
    const pattern = 'export function $A($B) { $$$ }';
    const res = runCli([
      'grep',
      '--json',
      '--project-path',
      process.cwd(),
      '--language',
      'typescript',
      pattern,
    ]);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.grepSchema.parse(payload);
    expect(payload.success).toBe(true);
    expect(payload.pattern).toBe(pattern);
  });

  test('grep rejects unknown options with usage error envelope', () => {
    const res = runCli([
      'grep',
      '--json',
      '--project-path',
      process.cwd(),
      '--not-a-real-flag',
      '1',
      'function $NAME($ARGS) { $BODY }',
    ]);
    expect(res.status).toBe(2);
    const payload = parseJsonStdout(res.stdout);
    schemas.errorEnvelopeSchema.parse(payload);
    expect(payload.command).toBe('grep');
    expect(payload.error).toContain('Unknown grep option');
  });

  test('grep validates --rule-json input before execution', () => {
    const res = runCli([
      'grep',
      '--json',
      '--project-path',
      process.cwd(),
      '--rule-json',
      '{not-json}',
    ]);
    expect(res.status).toBe(2);
    const payload = parseJsonStdout(res.stdout);
    schemas.errorEnvelopeSchema.parse(payload);
    expect(payload.command).toBe('grep');
    expect(payload.error).toContain('Invalid JSON provided to --rule-json');
  });

  test('embeddings status --json returns valid JSON', () => {
    const res = runCli(['embeddings', 'status', '--json', '--project-path', process.cwd()]);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.embeddingsStatusSchema.parse(payload);
    expect(payload.success).toBe(true);
  });

  test('summary --json returns valid JSON', () => {
    const res = runCli(['summary', 'src/cli.ts', '--json']);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.summarySchema.parse(payload);
    expect(payload.success).toBe(true);
  });

  test('packs create/get/list/delete --json works end-to-end', () => {
    const packsDir = path.join(
      process.cwd(),
      'test-storage',
      `packs-contracts-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    fs.mkdirSync(packsDir, { recursive: true });

    const env = { AMBIANCE_PACKS_DIR: packsDir };

    const createRes = runCli(
      ['packs', 'create', '--json', '--name', 'arch', '--query', 'Architecture overview'],
      env
    );
    expect(createRes.status).toBe(0);
    const created = parseJsonStdout(createRes.stdout);
    schemas.packsCreateSchema.parse(created);
    expect(created.pack.name).toBe('arch');

    const packId = created.pack.id;

    const listRes = runCli(['packs', 'list', '--json'], env);
    expect(listRes.status).toBe(0);
    const listed = parseJsonStdout(listRes.stdout);
    schemas.packsListSchema.parse(listed);
    expect(listed.packs.some(p => p.id === packId)).toBe(true);

    const getRes = runCli(['packs', 'get', packId, '--json'], env);
    expect(getRes.status).toBe(0);
    const fetched = parseJsonStdout(getRes.stdout);
    schemas.packsGetSchema.parse(fetched);
    expect(fetched.pack.id).toBe(packId);

    const delRes = runCli(['packs', 'delete', packId, '--json'], env);
    expect(delRes.status).toBe(0);
    const deleted = parseJsonStdout(delRes.stdout);
    schemas.packsDeleteSchema.parse(deleted);
    expect(deleted.deleted).toBe(true);

    const listAfterRes = runCli(['packs', 'list', '--json'], env);
    expect(listAfterRes.status).toBe(0);
    const listedAfter = parseJsonStdout(listAfterRes.stdout);
    expect(listedAfter.packs.some(p => p.id === packId)).toBe(false);
  });

  test('packs template --json returns valid JSON', () => {
    const res = runCli(['packs', 'template', '--json']);
    expect(res.status).toBe(0);
    const payload = parseJsonStdout(res.stdout);
    schemas.packsTemplateSchema.parse(payload);
    expect(payload.success).toBe(true);
  });

  test('packs ui --json returns JSON envelope + exit code 2 (non-interactive)', () => {
    const res = runCli(['packs', 'ui', '--json']);
    expect(res.status).toBe(2);
    const payload = parseJsonStdout(res.stdout);
    schemas.errorEnvelopeSchema.parse(payload);
    expect(payload.command).toBe('packs');
    expect(payload.exitCode).toBe(2);
  });

  test('compare --json returns JSON envelope + exit code 2 when prompt is missing', () => {
    const res = runCli(['compare', '--json']);
    expect(res.status).toBe(2);
    const payload = parseJsonStdout(res.stdout);
    schemas.errorEnvelopeSchema.parse(payload);
    expect(payload.command).toBe('compare');
    expect(payload.exitCode).toBe(2);
  });

  test('embeddings create --json returns JSON envelope + exit code 2 (confirmation required)', () => {
    const res = runCli(['embeddings', 'create', '--json', '--project-path', process.cwd()]);
    expect(res.status).toBe(2);
    const payload = parseJsonStdout(res.stdout);
    schemas.errorEnvelopeSchema.parse(payload);
    expect(payload.command).toBe('embeddings');
    expect(payload.exitCode).toBe(2);
  });

  test('usage errors return JSON envelope + exit code 2', () => {
    const res = runCli(['summary', '--json']);
    expect(res.status).toBe(2);
    const payload = parseJsonStdout(res.stdout);
    schemas.errorEnvelopeSchema.parse(payload);
    expect(payload.exitCode).toBe(2);
  });
});
