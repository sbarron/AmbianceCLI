/**
 * @fileOverview: Hybrid indexing system combining local and git-based project analysis with intelligent change detection
 * @module: HybridIndexer
 * @keyFunctions:
 *   - indexProject(): Index a project with intelligent change detection
 *   - shouldSkipIndexing(): Determine if re-indexing is necessary
 *   - processFile(): Process individual files with AST parsing and symbol extraction
 *   - getFilesToProcess(): Discover files to index with filtering
 * @dependencies:
 *   - ProjectIdentifier: Project detection and workspace context
 *   - TreeSitterProcessor: AST parsing and symbol extraction
 *   - LocalSearch: Local search capabilities
 *   - LocalProjectManager: Project state management
 *   - child_process: Git command execution
 * @context: Provides intelligent project indexing that combines local file analysis with git-based change detection for efficient and accurate code indexing
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ProjectIdentifier, ProjectInfo, WorkspaceContext } from './projectIdentifier';
import { TreeSitterProcessor } from './treeSitterProcessor';
import { LocalSearch } from './search';
import { LocalProjectManager } from './projectManager';
import { logger } from '../utils/logger';

export interface IndexingResult {
  projectId: string;
  projectName: string;
  type: 'git' | 'local';
  filesProcessed: number;
  chunksCreated: number;
  symbolsExtracted: number;
  embeddingsGenerated: number;
  duration: number;
  errors: string[];
}

export interface IndexingOptions {
  force?: boolean;
  incremental?: boolean;
  maxFiles?: number;
  fileTypes?: string[];
}

export class HybridIndexer {
  private projectIdentifier: ProjectIdentifier;
  private treeSitterProcessor: TreeSitterProcessor;
  private localSearch: LocalSearch;
  private projectManager: LocalProjectManager;
  private indexingCache: Map<string, { lastIndexed: Date; fileHashes: Map<string, string> }> =
    new Map();

  constructor() {
    this.projectIdentifier = ProjectIdentifier.getInstance();
    this.treeSitterProcessor = new TreeSitterProcessor();
    this.localSearch = new LocalSearch();
    this.projectManager = new LocalProjectManager();
  }

  /**
   * Index a project (local or git-based) with intelligent change detection
   */
  async indexProject(
    workspacePath?: string,
    options: IndexingOptions = {}
  ): Promise<IndexingResult> {
    const startTime = Date.now();
    const context = await this.projectIdentifier.getWorkspaceContext(workspacePath);
    const project = context.currentProject;

    logger.info(`🔍 Starting indexing for project: ${project.name} (${project.type})`);
    logger.info(`📍 Project path: ${project.path}`);
    logger.info(`🌐 Workspace root: ${project.workspaceRoot}`);

    if (project.type === 'git') {
      logger.info(
        `📋 Git info: ${project.gitInfo?.branch}@${project.gitInfo?.commitSha.substring(0, 7)}`
      );
      if (project.gitInfo?.remoteUrl) {
        logger.info(`🔗 Remote: ${project.gitInfo.remoteUrl}`);
      }
    }

    const result: IndexingResult = {
      projectId: project.id,
      projectName: project.name,
      type: project.type,
      filesProcessed: 0,
      chunksCreated: 0,
      symbolsExtracted: 0,
      embeddingsGenerated: 0,
      duration: 0,
      errors: [],
    };

    try {
      // Check if we need to reindex
      if (!options.force && (await this.shouldSkipIndexing(project))) {
        logger.info(`⏭️  Skipping indexing - project is up to date`);
        result.duration = Date.now() - startTime;
        return result;
      }

      // Get files to process
      const files = await this.getFilesToProcess(project, options);
      logger.info(`📁 Found ${files.length} files to process`);

      // Process files
      for (const filePath of files) {
        try {
          const fileResult = await this.processFile(project, filePath);
          result.filesProcessed++;
          result.chunksCreated += fileResult.chunksCreated;
          result.symbolsExtracted += fileResult.symbolsExtracted;
          result.embeddingsGenerated += fileResult.embeddingsGenerated;
        } catch (error) {
          const errorMsg = `Failed to process ${filePath}: ${(error as Error).message}`;
          logger.error(errorMsg);
          result.errors.push(errorMsg);
        }
      }

      // Update project stats
      await this.updateProjectStats(project, result);

      // Cache indexing results
      await this.cacheIndexingResults(project, files);

      logger.info(`✅ Indexing completed for ${project.name}`);
      logger.info(
        `📊 Results: ${result.filesProcessed} files, ${result.chunksCreated} chunks, ${result.symbolsExtracted} symbols`
      );
    } catch (error) {
      const errorMsg = `Indexing failed: ${(error as Error).message}`;
      logger.error(errorMsg);
      result.errors.push(errorMsg);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Get files that need to be processed (with change detection)
   */
  private async getFilesToProcess(
    project: ProjectInfo,
    options: IndexingOptions
  ): Promise<string[]> {
    const allFiles = await this.discoverFiles(project.path, options.fileTypes);

    if (options.force) {
      return allFiles;
    }

    // For git repositories, use git to detect changes
    if (project.type === 'git' && project.gitInfo) {
      return await this.getChangedFiles(project);
    }

    // For local projects, use file modification times
    return await this.getModifiedFiles(project, allFiles);
  }

  /**
   * Discover all files in a project
   */
  private async discoverFiles(projectPath: string, fileTypes?: string[]): Promise<string[]> {
    const defaultFileTypes = [
      '**/*.{ts,tsx,js,jsx,mjs,cjs}',
      '**/*.{py,go,rs,java}',
      '**/*.{cpp,c,h,hpp,cc,cxx}',
      '**/*.{md,json,yaml,yml}',
      '**/README*',
      '**/package.json',
      '**/Cargo.toml',
      '**/go.mod',
    ];

    const patterns = fileTypes || defaultFileTypes;
    const files: string[] = [];

    for (const pattern of patterns) {
      try {
        const globbyModule = await import('globby');
        const globbyFn =
          (globbyModule as any).default || (globbyModule as any).globby || globbyModule;
        const matches = await globbyFn(pattern, {
          cwd: projectPath,
          absolute: true,
          ignore: [
            'node_modules/**',
            'dist/**',
            'build/**',
            'out/**',
            'target/**',
            '.git/**',
            '.vscode/**',
            '.idea/**',
            'coverage/**',
            '**/*.min.js',
            '**/*.bundle.js',
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
          ],
        });
        files.push(...matches);
      } catch (error) {
        logger.warn(`Failed to process pattern ${pattern}:`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return [...new Set(files)]; // Remove duplicates
  }

  /**
   * Get changed files for git repositories
   */
  private async getChangedFiles(project: ProjectInfo): Promise<string[]> {
    if (!project.gitInfo) return [];

    try {
      // Get files changed since last commit
      const changedFiles = execSync('git diff --name-only HEAD~1', {
        cwd: project.path,
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter(Boolean);

      // Get untracked files
      const untrackedFiles = execSync('git ls-files --others --exclude-standard', {
        cwd: project.path,
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter(Boolean);

      // Get all files if working directory is dirty
      if (!project.gitInfo.isClean) {
        const allFiles = execSync('git ls-files', {
          cwd: project.path,
          encoding: 'utf8',
        })
          .trim()
          .split('\n')
          .filter(Boolean);

        return allFiles.map(file => path.join(project.path, file));
      }

      return [...changedFiles, ...untrackedFiles].map(file => path.join(project.path, file));
    } catch (error) {
      logger.warn('Failed to get git changes, processing all files:', {
        error: error instanceof Error ? error.message : String(error),
      });
      return await this.discoverFiles(project.path);
    }
  }

  /**
   * Get modified files for local projects
   */
  private async getModifiedFiles(project: ProjectInfo, allFiles: string[]): Promise<string[]> {
    const cache = this.indexingCache.get(project.id);
    if (!cache) return allFiles;

    const modifiedFiles: string[] = [];

    for (const filePath of allFiles) {
      try {
        const currentHash = await this.getFileHash(filePath);
        const lastHash = cache.fileHashes.get(filePath);

        if (currentHash !== lastHash) {
          modifiedFiles.push(filePath);
        }
      } catch (error) {
        // If we can't check the file, include it
        modifiedFiles.push(filePath);
      }
    }

    return modifiedFiles;
  }

  /**
   * Process a single file
   */
  private async processFile(
    project: ProjectInfo,
    filePath: string
  ): Promise<{
    chunksCreated: number;
    symbolsExtracted: number;
    embeddingsGenerated: number;
  }> {
    const relativePath = path.relative(project.path, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const language = this.getLanguageFromFile(filePath);

    if (!language) {
      return { chunksCreated: 0, symbolsExtracted: 0, embeddingsGenerated: 0 };
    }

    // Prefer LSP when available in the robust tools pipeline; here we use tree-sitter processor if present,
    // otherwise fall back to chunking-only mode without symbols
    let result: { chunks: any[]; symbols: any[] } = { chunks: [], symbols: [] } as any;
    try {
      result = await this.treeSitterProcessor.parseAndChunk(content, language, relativePath);
    } catch (error) {
      // Fallback: minimal chunking
      result = {
        chunks: [
          {
            content,
            startLine: 1,
            endLine: content.split('\n').length,
            tokenEstimate: Math.ceil(content.length / 4),
          },
        ],
        symbols: [],
      } as any;
    }

    // Store in local search
    await this.localSearch.indexFile(project, {
      path: relativePath,
      content,
      language,
      chunks: result.chunks,
      symbols: result.symbols,
    });

    return {
      chunksCreated: result.chunks.length,
      symbolsExtracted: result.symbols.length,
      embeddingsGenerated: 0, // Local indexing doesn't generate embeddings
    };
  }

  /**
   * Check if indexing should be skipped
   */
  private async shouldSkipIndexing(project: ProjectInfo): Promise<boolean> {
    const cache = this.indexingCache.get(project.id);
    if (!cache) return false;

    // For git repositories, check if commit has changed
    if (project.type === 'git' && project.gitInfo) {
      const lastCommit = cache.lastIndexed;
      const currentCommit = new Date(project.lastModified);
      return currentCommit <= lastCommit;
    }

    // For local projects, check if files have been modified
    return project.lastModified <= cache.lastIndexed;
  }

  /**
   * Get file hash for change detection
   */
  private async getFileHash(filePath: string): Promise<string> {
    const crypto = require('crypto');
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Cache indexing results
   */
  private async cacheIndexingResults(project: ProjectInfo, files: string[]): Promise<void> {
    const fileHashes = new Map<string, string>();

    for (const filePath of files) {
      try {
        const hash = await this.getFileHash(filePath);
        const relativePath = path.relative(project.path, filePath);
        fileHashes.set(relativePath, hash);
      } catch (error) {
        logger.warn(`Failed to hash file ${filePath}:`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.indexingCache.set(project.id, {
      lastIndexed: new Date(),
      fileHashes,
    });
  }

  /**
   * Update project statistics
   */
  private async updateProjectStats(project: ProjectInfo, result: IndexingResult): Promise<void> {
    await this.projectManager.updateProjectStats(project.id, {
      fileCount: result.filesProcessed,
      chunkCount: result.chunksCreated,
      symbolCount: result.symbolsExtracted,
    });
  }

  /**
   * Get language from file extension
   */
  private getLanguageFromFile(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.hpp': 'cpp',
      '.md': 'markdown',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
    };

    return languageMap[ext] || null;
  }

  /**
   * Clear indexing cache
   */
  clearCache(): void {
    this.indexingCache.clear();
  }

  /**
   * Get indexing status for a project
   */
  async getIndexingStatus(projectId: string): Promise<{
    lastIndexed?: Date;
    fileCount: number;
    isUpToDate: boolean;
  }> {
    const cache = this.indexingCache.get(projectId);
    const project = await this.projectManager.getProject(projectId);

    return {
      lastIndexed: cache?.lastIndexed,
      fileCount: project?.stats?.fileCount || 0,
      isUpToDate: cache !== undefined,
    };
  }
}
