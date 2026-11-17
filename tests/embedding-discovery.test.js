const path = require('path');
const { spawnSync } = require('child_process');

test('real embedding discovery follows nested ignores and skips textless files', () => {
  const result = spawnSync(process.execPath, ['--test', 'tests/embedding-discovery.node.cjs'], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30000,
  });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  expect(result.status).toBe(0);
});
