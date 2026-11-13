const { spawnSync } = require('child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

jest.setTimeout(120000);

let fixtureRoot;
let fixtureProject;
beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-skill-workflows-'));
  fixtureProject = path.join(fixtureRoot, 'project');
  fs.mkdirSync(path.join(fixtureProject, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureProject, 'package.json'),
    JSON.stringify({ name: 'workflow-fixture', version: '1.0.0' })
  );
  fs.writeFileSync(
    path.join(fixtureProject, 'src', 'service.ts'),
    'export function runService() { return "architecture fixture"; }\n'
  );
  fs.writeFileSync(
    path.join(fixtureProject, 'README.md'),
    '# Architecture\nThe service implements the local application.\n'
  );
});
afterAll(() => {
  if (
    path.dirname(fixtureRoot) !== os.tmpdir() ||
    !path.basename(fixtureRoot).startsWith('ambiance-skill-workflows-')
  )
    throw new Error('Unexpected workflow fixture');
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

const SKILLS_DIR = path.join(process.cwd(), 'skills', 'ambiance');
const WORKFLOWS_DIR = path.join(SKILLS_DIR, 'workflows');

function runCli(args, extraEnv) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    LOG_LEVEL: 'error',
    USE_LOCAL_EMBEDDINGS: 'false',
    USE_OPENAI_EMBEDDINGS: 'false',
    LOCAL_EMBEDDING_MODEL: 'all-MiniLM-L6-v2',
    LOCAL_STORAGE_PATH: path.join(fixtureRoot, 'storage'),
    ...(extraEnv || {}),
  };

  delete env.WORKSPACE_FOLDER;
  delete env.AMBIANCE_BASE_DIR;

  const result = spawnSync(process.execPath, ['-r', 'ts-node/register', 'src/cli.ts', ...args], {
    encoding: 'utf8',
    env,
    timeout: 60000,
    windowsHide: true,
  });

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

function resolveTemplateArg(arg, vars) {
  if (typeof arg !== 'string') {
    return String(arg);
  }

  return arg.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, key) => {
    const value = vars[key];
    if (value === undefined || value === null) {
      throw new Error(`Missing workflow template value for ${key}`);
    }
    return String(value);
  });
}

describe('Skill workflows execute through CLI', () => {
  test('capabilities workflows execute all steps with JSON output', () => {
    const capabilitiesPath = path.join(SKILLS_DIR, 'capabilities.json');
    const capabilities = JSON.parse(fs.readFileSync(capabilitiesPath, 'utf8'));

    expect(Array.isArray(capabilities.workflows)).toBe(true);
    expect(capabilities.workflows.length).toBeGreaterThan(0);

    const vars = {
      projectPath: fixtureProject,
      query: 'High-level architecture overview',
      logText: 'TypeError undefined',
    };

    for (const workflowName of capabilities.workflows) {
      const workflowPath = path.join(WORKFLOWS_DIR, `${workflowName}.json`);
      const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

      expect(Array.isArray(workflow.steps)).toBe(true);
      expect(workflow.steps.length).toBeGreaterThan(0);

      for (const [index, step] of workflow.steps.entries()) {
        const resolvedArgs = (step.args || []).map(arg => resolveTemplateArg(arg, vars));
        const cliArgs = [step.command, ...resolvedArgs];

        const res = runCli(cliArgs, { AMBIANCE_SKILLS_DIR: SKILLS_DIR });

        if (res.status !== 0) {
          throw new Error(
            `workflow=${workflowName} step=${index + 1} command=${step.command}\nstdout=${res.stdout}\nstderr=${res.stderr}`
          );
        }

        const payload = parseJsonStdout(res.stdout);
        expect(payload.success).toBe(true);
        expect(payload.command).toBe(step.command);
        expect(payload.exitCode).toBe(0);
      }
    }
  });
});
