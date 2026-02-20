/**
 * @fileOverview: Intelligent file discovery and filtering for code analysis with multi-language support
 * @module: FileDiscovery
 * @keyFunctions:
 *   - discoverFiles(): Find all parseable source files in project with intelligent filtering
 *   - filterFiles(): Apply size, extension and ignore pattern filtering
 *   - detectLanguage(): Identify programming language from file extension
 *   - loadIgnorePatterns(): Load and parse .gitignore-style ignore patterns
 *   - toAbsolute(): Convert paths to absolute with proper normalization
 * @dependencies:
 *   - globby: File pattern matching and discovery with glob support
 *   - fs/promises: File system operations for stat and path resolution
 *   - path: Path manipulation and normalization utilities
 *   - SupportedLanguage: Language detection and mapping interface
 * @context: Provides intelligent file discovery that identifies parseable source files while respecting ignore patterns and file size limits for efficient code analysis
 */

function importEsmModule<TModule = unknown>(specifier: string): Promise<TModule> {
  // In tests, prefer require() so Jest's moduleNameMapper/__mocks__ can intercept.
  if (process.env.JEST_WORKER_ID) {
    return Promise.resolve(require(specifier) as TModule);
  }

  // In CommonJS output, TypeScript may downlevel `import()` to `require()`.
  // Using Function forces Node's native dynamic import, which works for ESM-only deps.
  const importer = new Function('s', 'return import(s)') as (s: string) => Promise<TModule>;
  return importer(specifier);
}

async function runGlobby(patterns: string[], options: any): Promise<string[]> {
  const mod: any = await importEsmModule<any>('globby');
  const fn = mod.globby || mod.default?.globby || mod.default || mod;
  if (typeof fn !== 'function') {
    throw new Error('Failed to import globby function');
  }
  return fn(patterns, options);
}
import { stat, access } from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger';

export interface FileInfo {
  absPath: string; // 🔑 Use absolute path as authoritative
  relPath: string; // Relative path for reporting only
  size: number;
  ext: string;
  language: string;
}

export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'cpp'
  | 'markdown'
  | 'json'
  | 'html';

const LANGUAGE_MAP: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.astro': 'html',
  '.vue': 'html',
  '.svelte': 'html',
  '.css': 'html',
  '.scss': 'html',
  '.sass': 'html',
  '.less': 'html',
  '.yaml': 'json',
  '.yml': 'json',
};

export class FileDiscovery {
  private basePath: string;
  private maxFileSize: number;
  private supportedExtensions: string[];
  private readonly hardExcludedSegments = new Set<string>([
    'node_modules',
    'venv',
    '.venv',
    '__pycache__',
    'site-packages',
    '.pytest_cache',
    '.mypy_cache',
    '.git',
    'dist',
    'build',
    'out',
    'target',
    '.next',
    '.turbo',
    '.vercel',
    'coverage',
    '.cache',
    'tmp',
    'temp',
  ]);

  constructor(
    basePath: string,
    options: {
      maxFileSize?: number;
      supportedExtensions?: string[];
    } = {}
  ) {
    // Normalize the base path to ensure it's absolute and properly formatted
    this.basePath = path.resolve(basePath);
    this.maxFileSize = options.maxFileSize || 100000; // 100KB default
    this.supportedExtensions = options.supportedExtensions || Object.keys(LANGUAGE_MAP);
  }

  /**
   * Convert a path to absolute, handling both relative and absolute paths correctly
   * 🔑 Never re-prefix absolute paths - treat them as authoritative
   */
  private toAbsolute(p: string, baseDir: string): string {
    const normalized = path.normalize(p);
    return path.isAbsolute(normalized)
      ? normalized
      : path.normalize(path.join(baseDir, normalized));
  }

  /**
   * Defense-in-depth: reject known dependency/build/cache paths even if glob ignores miss them.
   */
  private isHardExcludedPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const segments = normalized.split('/').filter(Boolean);
    return segments.some(segment => this.hardExcludedSegments.has(segment));
  }

  /**
   * Discover all parseable source files in the project
   */
  async discoverFiles(): Promise<FileInfo[]> {
    logger.info('Starting file discovery', { basePath: this.basePath });
    try {
      await access(this.basePath);
    } catch {
      logger.warn(`Base path does not exist: ${this.basePath}`);
      return [];
    }

    // Remove debugging lines

    const patterns = [
      // Include common source file patterns
      '**/*.{ts,tsx,js,jsx,mjs,cjs,html,htm,astro,vue,svelte}',
      '**/*.{py,go,rs,java}',
      '**/*.{cpp,c,h,hpp,cc,cxx}',
      '**/*.{md,mdx,json,yaml,yml,xml,css,scss,sass,less}',
      '**/README*',
      '**/package.json',
      '**/Cargo.toml',
      '**/go.mod',
    ];

    const ignorePatterns = [
      // Standard ignore patterns
      'node_modules/**',
      '**/node_modules/**',
      'venv/**',
      '**/venv/**',
      '.venv/**',
      '**/.venv/**',
      '__pycache__/**',
      '**/__pycache__/**',
      'site-packages/**',
      '**/site-packages/**',
      '.pytest_cache/**',
      '**/.pytest_cache/**',
      '.mypy_cache/**',
      '**/.mypy_cache/**',

      // Verifier #3: Build artifacts exclusion
      'dist/**',
      '**/dist/**',
      'build/**',
      '**/build/**',
      'out/**',
      '**/out/**',
      'target/**',
      '**/target/**',
      '.next/**',
      '**/.next/**',
      '.turbo/**',
      '**/.turbo/**',
      'coverage/**',
      '**/coverage/**',
      '.vercel/**',
      '**/.vercel/**',

      // Version control
      '.git/**',
      '.svn/**',
      '.hg/**',

      // IDE/Editor files
      '.vscode/**',
      '.idea/**',
      '*.swp',
      '*.swo',
      '*~',

      // OS files
      '.DS_Store',
      'Thumbs.db',

      // Lock files and package managers
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',

      // Test and generated files (relaxed for project hints)
      '**/*.min.js',
      '**/*.bundle.js',
      '**/*.map',

      // Files that often cause parsing issues
      '**/*.d.ts.map',
      '**/*.js.map',
      '**/*.min.css',
      '**/*.min.map',

      // Binary and non-text files
      '**/*.png',
      '**/*.jpg',
      '**/*.jpeg',
      '**/*.gif',
      '**/*.ico',
      '**/*.svg',
      '**/*.woff',
      '**/*.woff2',
      '**/*.ttf',
      '**/*.eot',
      '**/*.pdf',
      '**/*.zip',
      '**/*.tar',
      '**/*.gz',
      '**/*.exe',
      '**/*.dll',
      '**/*.so',
      '**/*.dylib',
      '**/webpack.config.*',
      '**/rollup.config.*',

      // Cache directories
      '.cache/**',
      '.tmp/**',
      'tmp/**',
      '.next/**',
      '.nuxt/**',

      // Documentation that's likely auto-generated
      '**/docs/api/**',
      '**/typedoc/**',

      // Deprecated, old, legacy, and backup folders/files
      '**/old/**',
      '**/OLD/**',
      '**/_old/**',
      '**/_OLD/**',
      '**/deprecated/**',
      '**/DEPRECATED/**',
      '**/_deprecated/**',
      '**/_DEPRECATED/**',
      '**/legacy/**',
      '**/LEGACY/**',
      '**/_legacy/**',
      '**/_LEGACY/**',
      '**/backup/**',
      '**/BACKUP/**',
      '**/_backup/**',
      '**/_BACKUP/**',
      '**/archive/**',
      '**/ARCHIVE/**',
      '**/_archive/**',
      '**/_ARCHIVE/**',
      '**/outdated/**',
      '**/OUTDATED/**',
      '**/_outdated/**',
      '**/_OUTDATED/**',
      '**/obsolete/**',
      '**/OBSOLETE/**',
      '**/_obsolete/**',
      '**/_OBSOLETE/**',
      '**/temp/**',
      '**/TEMP/**',
      '**/_temp/**',
      '**/_TEMP/**',
      '**/tmp/**',
      '**/TMP/**',
      '**/_tmp/**',
      '**/_TMP/**',
      '**/bak/**',
      '**/BAK/**',
      '**/_bak/**',
      '**/_BAK/**',
      '**/save/**',
      '**/SAVE/**',
      '**/_save/**',
      '**/_SAVE/**',
      '**/stash/**',
      '**/STASH/**',
      '**/_stash/**',
      '**/_STASH/**',
      '**/trash/**',
      '**/TRASH/**',
      '**/_trash/**',
      '**/_TRASH/**',
      '**/bin/**',
      '**/BIN/**',
      '**/_bin/**',
      '**/_BIN/**',
      '**/junk/**',
      '**/JUNK/**',
      '**/_junk/**',
      '**/_JUNK/**',
      '**/unused/**',
      '**/UNUSED/**',
      '**/_unused/**',
      '**/_UNUSED/**',
      '**/dead/**',
      '**/DEAD/**',
      '**/_dead/**',
      '**/_DEAD/**',
      '**/zombie/**',
      '**/ZOMBIE/**',
      '**/_zombie/**',
      '**/_ZOMBIE/**',
      '**/retired/**',
      '**/RETIRED/**',
      '**/_retired/**',
      '**/_RETIRED/**',
      '**/sunset/**',
      '**/SUNSET/**',
      '**/_sunset/**',
      '**/_SUNSET/**',
      '**/v1/**',
      '**/v2/**',
      '**/v3/**',
      '**/v4/**',
      '**/v5/**',
      '**/v6/**',
      '**/v7/**',
      '**/v8/**',
      '**/v9/**',
      '**/v10/**',
      '**/version1/**',
      '**/version2/**',
      '**/version3/**',
      '**/version4/**',
      '**/version5/**',
      '**/version6/**',
      '**/version7/**',
      '**/version8/**',
      '**/version9/**',
      '**/version10/**',
      '**/old-*/**',
      '**/OLD-*/**',
      '**/_old-*/**',
      '**/_OLD-*/**',
      '**/deprecated-*/**',
      '**/DEPRECATED-*/**',
      '**/_deprecated-*/**',
      '**/_DEPRECATED-*/**',
      '**/legacy-*/**',
      '**/LEGACY-*/**',
      '**/_legacy-*/**',
      '**/_LEGACY-*/**',
      '**/*-old/**',
      '**/*-OLD/**',
      '**/*_old/**',
      '**/*_OLD/**',
      '**/*-deprecated/**',
      '**/*-DEPRECATED/**',
      '**/*_deprecated/**',
      '**/*_DEPRECATED/**',
      '**/*-legacy/**',
      '**/*-LEGACY/**',
      '**/*_legacy/**',
      '**/*_LEGACY/**',
      '**/*-backup/**',
      '**/*-BACKUP/**',
      '**/*_backup/**',
      '**/*_BACKUP/**',
      '**/*-archive/**',
      '**/*-ARCHIVE/**',
      '**/*_archive/**',
      '**/*_ARCHIVE/**',
      '**/*-bak/**',
      '**/*-BAK/**',
      '**/*_bak/**',
      '**/*_BAK/**',
      '**/*-save/**',
      '**/*-SAVE/**',
      '**/*_save/**',
      '**/*_SAVE/**',
      '**/*-stash/**',
      '**/*-STASH/**',
      '**/*_stash/**',
      '**/*_STASH/**',
      '**/*-temp/**',
      '**/*-TEMP/**',
      '**/*_temp/**',
      '**/*_TEMP/**',
      '**/*-tmp/**',
      '**/*-TMP/**',
      '**/*_tmp/**',
      '**/*_TMP/**',
      '**/*-junk/**',
      '**/*-JUNK/**',
      '**/*_junk/**',
      '**/*_JUNK/**',
      '**/*-unused/**',
      '**/*-UNUSED/**',
      '**/*_unused/**',
      '**/*_UNUSED/**',
      '**/*-dead/**',
      '**/*-DEAD/**',
      '**/*_dead/**',
      '**/*_DEAD/**',
      '**/*-zombie/**',
      '**/*-ZOMBIE/**',
      '**/*_zombie/**',
      '**/*_ZOMBIE/**',
      '**/*-retired/**',
      '**/*-RETIRED/**',
      '**/*_retired/**',
      '**/*_RETIRED/**',
      '**/*-sunset/**',
      '**/*-SUNSET/**',
      '**/*_sunset/**',
      '**/*_SUNSET/**',
      // Additional patterns for compound names
      '**/backup-*/**',
      '**/BACKUP-*/**',
      '**/_backup-*/**',
      '**/_BACKUP-*/**',
      '**/temp-*/**',
      '**/TEMP-*/**',
      '**/_temp-*/**',
      '**/_TEMP-*/**',
      '**/tmp-*/**',
      '**/TMP-*/**',
      '**/_tmp-*/**',
      '**/_TMP-*/**',
      '**/bak-*/**',
      '**/BAK-*/**',
      '**/_bak-*/**',
      '**/_BAK-*/**',
      '**/save-*/**',
      '**/SAVE-*/**',
      '**/_save-*/**',
      '**/_SAVE-*/**',
      '**/stash-*/**',
      '**/STASH-*/**',
      '**/_stash-*/**',
      '**/_STASH-*/**',
      '**/trash-*/**',
      '**/TRASH-*/**',
      '**/_trash-*/**',
      '**/_TRASH-*/**',
      '**/junk-*/**',
      '**/JUNK-*/**',
      '**/_junk-*/**',
      '**/_JUNK-*/**',
      '**/unused-*/**',
      '**/UNUSED-*/**',
      '**/_unused-*/**',
      '**/_UNUSED-*/**',
      '**/dead-*/**',
      '**/DEAD-*/**',
      '**/_dead-*/**',
      '**/_DEAD-*/**',
      '**/zombie-*/**',
      '**/ZOMBIE-*/**',
      '**/_zombie-*/**',
      '**/_ZOMBIE-*/**',
      '**/retired-*/**',
      '**/RETIRED-*/**',
      '**/_retired-*/**',
      '**/_RETIRED-*/**',
      '**/sunset-*/**',
      '**/SUNSET-*/**',
      '**/_sunset-*/**',
      '**/_SUNSET-*/**',
    ];

    try {
      // Only check for non-existent directories (ENOENT), let other edge cases pass through
      try {
        await stat(this.basePath);
      } catch (error) {
        if ((error as any).code === 'ENOENT') {
          throw new Error(`Directory ${this.basePath} does not exist`);
        }
        // For other errors (permissions, etc), let them propagate
        throw error;
      }

      const filePaths = await runGlobby(patterns, {
        cwd: this.basePath,
        ignore: ignorePatterns,
        gitignore: true,
        ignoreFiles: ['.gitignore', '.cursorignore', '.vscodeignore', '.ambianceignore'],
        absolute: false,
        onlyFiles: true,
        followSymbolicLinks: false,
      });

      const initiallyHardExcluded = filePaths.filter(filePath => this.isHardExcludedPath(filePath))
        .length;
      const candidateFilePaths = filePaths.filter(filePath => !this.isHardExcludedPath(filePath));

      logger.info('Found potential files', {
        count: filePaths.length,
        hardExcluded: initiallyHardExcluded,
        afterHardExclusions: candidateFilePaths.length,
      });

      // Safety check: cap huge scans instead of hard-failing on valid large repositories.
      const maxCandidateFiles = 10000;
      const filePathsToProcess =
        candidateFilePaths.length > maxCandidateFiles
          ? candidateFilePaths.slice(0, maxCandidateFiles)
          : candidateFilePaths;

      if (candidateFilePaths.length > maxCandidateFiles) {
        logger.warn(
          `File discovery found ${candidateFilePaths.length} candidates after hard exclusions; capping to ${maxCandidateFiles}`,
          {
            basePath: this.basePath,
            currentWorkingDir: process.cwd(),
            workspaceFolder: process.env.WORKSPACE_FOLDER,
          }
        );
      }

      const fileInfos: FileInfo[] = [];
      const skippedCount = 0;
      let extensionFilteredCount = 0;
      let sizeFilteredCount = 0;
      let hardExcludedCount = initiallyHardExcluded;

      for (const filePath of filePathsToProcess) {
        try {
          if (this.isHardExcludedPath(filePath)) {
            hardExcludedCount++;
            continue;
          }
          // 🔑 Use baseDir (temp fixture dir) for path resolution, not project root
          const absPath = this.toAbsolute(filePath, this.basePath);
          const fileStats = await stat(absPath);

          // Skip files that are too large
          if (fileStats.size > this.maxFileSize) {
            sizeFilteredCount++;
            continue;
          }

          const ext = path.extname(absPath).toLowerCase();

          // Skip unsupported extensions (but allow README files)
          if (!this.supportedExtensions.includes(ext) && !absPath.includes('README')) {
            extensionFilteredCount++;
            continue;
          }

          const language = LANGUAGE_MAP[ext] || 'unknown';

          fileInfos.push({
            absPath, // 🔑 Store absolute path
            relPath: path.relative(this.basePath, absPath), // Relative for reporting only
            size: fileStats.size,
            ext,
            language,
          });
        } catch (error) {
          logger.warn('Failed to process file during discovery', {
            filePath,
            error: (error as Error).message,
          });
        }
      }

      // Enhanced logging to track each stage as recommended in errorsfixes.md
      logger.info('File discovery breakdown', {
        candidatesFound: filePaths.length,
        candidatesAfterHardExclusions: candidateFilePaths.length,
        candidatesProcessed: filePathsToProcess.length,
        keptByExtension: fileInfos.length,
        skippedBySize: sizeFilteredCount,
        hardExcluded: hardExcludedCount,
        finalSupportedFiles: fileInfos.length,
      });

      // 🔑 Debug: Log first few absolute paths to catch re-prefixing regressions
      if (fileInfos.length > 0) {
        logger.debug('Sample discovered paths', {
          firstThreePaths: fileInfos.slice(0, 3).map(f => f.absPath),
        });
      }

      logger.info('File discovery completed', {
        filesForAnalysis: fileInfos.length,
        skippedLargeFiles: skippedCount,
      });

      // Log language distribution
      const languageStats = fileInfos.reduce(
        (acc, file) => {
          acc[file.language] = (acc[file.language] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      logger.info('Language distribution', { languageStats });

      // Verifier #3: Source preference over build artifacts
      const preferredFiles = this.preferSourceOverBuild(fileInfos);

      logger.info('Source preference applied', {
        originalCount: fileInfos.length,
        afterPreference: preferredFiles.length,
        filteredOut: fileInfos.length - preferredFiles.length,
      });

      return preferredFiles;
    } catch (error) {
      logger.error('File discovery failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(`File discovery failed: ${(error as Error).message}`);
    }
  }

  /**
   * Filter files by language
   */
  filterByLanguage(files: FileInfo[], languages: SupportedLanguage[]): FileInfo[] {
    return files.filter(file => languages.includes(file.language as SupportedLanguage));
  }

  /**
   * Sort files by relevance (entry points first, then by size/importance)
   */
  sortByRelevance(files: FileInfo[]): FileInfo[] {
    const getRelevanceScore = (file: FileInfo): number => {
      let score = 0;

      // Entry points get highest priority
      if (
        file.relPath.includes('index') ||
        file.relPath.includes('main') ||
        file.relPath.includes('app')
      ) {
        score += 100;
      }

      // README and documentation
      if (file.relPath.toLowerCase().includes('readme')) {
        score += 80;
      }

      // Package configuration files
      if (
        file.relPath.includes('package.json') ||
        file.relPath.includes('Cargo.toml') ||
        file.relPath.includes('go.mod')
      ) {
        score += 70;
      }

      // Source files in src/ or lib/ directories
      if (file.relPath.includes('src/') || file.relPath.includes('lib/')) {
        score += 50;
      }

      // TypeScript/JavaScript files (often more important)
      if (file.language === 'typescript' || file.language === 'javascript') {
        score += 30;
      }

      // Bonus for reasonable file size (not too small, not too large)
      if (file.size > 500 && file.size < 50000) {
        score += 10;
      }

      // Small penalty for very deeply nested files
      const depth = file.relPath.split(path.sep).length;
      if (depth > 5) {
        score -= depth;
      }

      return score;
    };

    return [...files].sort((a, b) => getRelevanceScore(b) - getRelevanceScore(a));
  }

  /**
   * Verifier #3: Prefer source files over build artifacts when both exist
   */
  private preferSourceOverBuild(files: FileInfo[]): FileInfo[] {
    const fileMap = new Map<string, FileInfo[]>();

    // Group files by their module stem (path without extension)
    for (const file of files) {
      const moduleStem = this.getModuleStem(file.relPath);
      if (!fileMap.has(moduleStem)) {
        fileMap.set(moduleStem, []);
      }
      fileMap.get(moduleStem)!.push(file);
    }

    const preferredFiles: FileInfo[] = [];

    for (const [stem, candidates] of fileMap) {
      if (candidates.length === 1) {
        preferredFiles.push(candidates[0]);
        continue;
      }

      // Multiple candidates for same module - apply preference rules
      const sourceFile = this.selectSourceFile(candidates);
      preferredFiles.push(sourceFile);
    }

    return preferredFiles;
  }

  /**
   * Get module stem for grouping (remove extension and normalize path)
   */
  private getModuleStem(relPath: string): string {
    const normalized = relPath.replace(/\\/g, '/');
    const withoutExt = normalized.replace(/\.[^/.]+$/, '');
    return withoutExt;
  }

  /**
   * Select the preferred source file from candidates
   */
  private selectSourceFile(candidates: FileInfo[]): FileInfo {
    // Preference order (higher priority first)
    const sourcePreference = [
      // TypeScript sources
      (f: FileInfo) => f.relPath.includes('/src/') && f.ext === '.ts',
      (f: FileInfo) => f.relPath.includes('/src/') && f.ext === '.tsx',
      (f: FileInfo) => f.ext === '.ts' && !this.isBuildArtifact(f.relPath),
      (f: FileInfo) => f.ext === '.tsx' && !this.isBuildArtifact(f.relPath),

      // JavaScript sources
      (f: FileInfo) => f.relPath.includes('/src/') && (f.ext === '.js' || f.ext === '.jsx'),
      (f: FileInfo) => (f.ext === '.js' || f.ext === '.jsx') && !this.isBuildArtifact(f.relPath),

      // Other sources
      (f: FileInfo) => f.relPath.includes('/src/') && !this.isBuildArtifact(f.relPath),
      (f: FileInfo) => !this.isBuildArtifact(f.relPath),
    ];

    // Try each preference rule in order
    for (const preferenceCheck of sourcePreference) {
      const matches = candidates.filter(preferenceCheck);
      if (matches.length > 0) {
        // If multiple matches at same preference level, pick shortest path
        return matches.sort((a, b) => a.relPath.length - b.relPath.length)[0];
      }
    }

    // Fallback: shortest path
    return candidates.sort((a, b) => a.relPath.length - b.relPath.length)[0];
  }

  /**
   * Check if a file path indicates it's a build artifact
   */
  private isBuildArtifact(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/').toLowerCase();

    const buildPaths = [
      '/dist/',
      '/build/',
      '/out/',
      '/.next/',
      '/.turbo/',
      '/coverage/',
      '/target/',
      '/node_modules/',
    ];

    return buildPaths.some(buildPath => normalized.includes(buildPath));
  }
}
