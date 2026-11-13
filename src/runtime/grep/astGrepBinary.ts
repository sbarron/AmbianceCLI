import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

/** Resolve our installed dependency, never an executable from the inspected project. */
export function resolveAstGrepBinary(): string {
  const packageDirectory = path.dirname(require.resolve('@ast-grep/cli/package.json'));
  const binary = path.join(
    packageDirectory,
    process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep'
  );
  if (!existsSync(binary)) {
    throw new Error('Installed ast-grep binary is missing. Run npm rebuild @ast-grep/cli.');
  }
  return binary;
}

export function runAstGrepSync(args: string[]): string {
  return execFileSync(resolveAstGrepBinary(), args, {
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
