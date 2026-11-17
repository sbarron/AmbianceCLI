import { logger } from '../../utils/logger';
import { loadIgnorePatterns } from '../../local/projectIdentifier';
import { importEsm } from '../utils/esmImport';
import * as fs from 'fs';
import * as path from 'path';

const INDEXABLE_FILE_PATTERNS = [
  '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,py,go,rs,java,cpp,c,cc,cxx,h,hpp,hh,hxx,cs,rb,php,swift,kt,kts,scala,clj,hs,lhs,ml,r,sql,sh,bash,zsh,ex,exs,lua,md,mdx,json,yaml,yml,xml,html,htm,css,scss,sass,less,astro,vue,svelte}',
];

const DEFAULT_INDEX_IGNORE_PATTERNS = [
  '**/node_modules/**',
  'node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.git/**',
  '**/.svn/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/.cache/**',
  '**/tmp/**',
  '**/temp/**',
  '**/.tmp/**',
  '**/*.log',
  '**/*.map',
  '**/*.tsbuildinfo',
  '**/package-lock.json',
  '**/yarn.lock',
];

function shouldIgnoreIndexableFile(filePath: string): boolean {
  const pathParts = filePath.split(/[/\\]/);
  for (const part of pathParts) {
    if (
      part === 'node_modules' ||
      part === '.git' ||
      part === 'dist' ||
      part === 'build' ||
      part === '.next' ||
      part === 'coverage' ||
      part.startsWith('.') ||
      part.includes('.min.') ||
      part.includes('.test.') ||
      part.includes('.spec.')
    ) {
      return true;
    }
  }
  return false;
}

async function loadAdditionalIgnorePatterns(projectPath: string): Promise<string[]> {
  const ignorePatterns: string[] = [];

  try {
    ignorePatterns.push(...(await loadIgnorePatterns(projectPath)));
  } catch (error) {
    logger.debug('Failed to load .gitignore patterns for stale scan', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  for (const ignoreFile of ['.cursorignore', '.vscodeignore', '.ambianceignore']) {
    const ignorePath = path.join(projectPath, ignoreFile);
    try {
      if (fs.existsSync(ignorePath)) {
        const patterns = fs
          .readFileSync(ignorePath, 'utf8')
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0 && !line.startsWith('#'));
        ignorePatterns.push(...patterns);
      }
    } catch (error) {
      logger.debug(`Failed to load ${ignoreFile} patterns for stale scan`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  ignorePatterns.push(...DEFAULT_INDEX_IGNORE_PATTERNS);
  return ignorePatterns;
}

export async function discoverIndexableProjectFiles(projectPath: string): Promise<string[]> {
  const { globby } = await importEsm<typeof import('globby')>('globby');
  const ignore = await loadAdditionalIgnorePatterns(projectPath);
  const files = await globby(INDEXABLE_FILE_PATTERNS, {
    cwd: projectPath,
    gitignore: true,
    ignoreFiles: ['.gitignore', '.cursorignore', '.vscodeignore', '.ambianceignore'],
    ignore,
    absolute: false,
    dot: false,
    onlyFiles: true,
    suppressErrors: true,
  });

  return files
    .map(file => path.normalize(file))
    .filter(file => !shouldIgnoreIndexableFile(file))
    .filter(file => fs.readFileSync(path.join(projectPath, file), 'utf8').trim().length > 0)
    .sort();
}
