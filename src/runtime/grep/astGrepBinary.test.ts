import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveAstGrepBinary, runAstGrepSync } from './astGrepBinary';

describe('ast-grep executable isolation', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-security-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('passes shell metacharacters and AST metavariables literally to the native binary', () => {
    const file = path.join(directory, 'literal & %PATH% $HOME `name`.ts');
    fs.writeFileSync(file, 'console.log("safe");\n');
    const result = runAstGrepSync([
      '--pattern',
      'console.log($VALUE)',
      '--lang',
      'ts',
      '--json=stream',
      '--',
      file,
    ]);
    expect(JSON.parse(result.trim()).text).toBe('console.log("safe")');
  });

  test('ignores executable shims in the inspected project working directory', () => {
    const bin = path.join(directory, 'node_modules', '.bin');
    fs.mkdirSync(bin, { recursive: true });
    const marker = path.join(directory, 'executed.txt');
    fs.writeFileSync(path.join(bin, 'ast-grep.cmd'), '@echo injected>executed.txt\r\n');
    fs.writeFileSync(path.join(bin, 'ast-grep'), '#!/bin/sh\necho injected > executed.txt\n', {
      mode: 0o755,
    });
    const modulePath = path.resolve(__dirname, '../../../dist/src/runtime/grep/astGrepBinary.js');
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `process.stdout.write(require(${JSON.stringify(modulePath)}).runAstGrepSync(['--version']))`,
      ],
      { cwd: directory, encoding: 'utf8', shell: false, timeout: 10_000 }
    );
    expect(output).toMatch(/^ast-grep /);
    expect(fs.existsSync(marker)).toBe(false);
    expect(resolveAstGrepBinary()).not.toContain(directory);
  });
});
