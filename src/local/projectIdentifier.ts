/**
 * @fileOverview: Project identification and workspace context analysis for git and local projects
 * @module: ProjectIdentifier
 * @keyFunctions:
 *   - identifyProject(): Identify the current project based on workspace context
 *   - getWorkspaceContext(): Get comprehensive workspace context for current environment
 *   - isGitRepository(): Check if a path is a git repository
 *   - getGitInfo(): Extract git information for repository analysis
 * @dependencies:
 *   - fs: File system operations for project detection
 *   - path: Path manipulation and resolution
 *   - child_process: Git command execution for repository analysis
 *   - minimatch: Pattern matching for file filtering
 * @context: Provides intelligent project detection that distinguishes between git repositories and local projects, extracting relevant metadata for indexing and analysis
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { minimatch } from 'minimatch';

import { logger } from '../utils/logger';

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  type: 'git' | 'local';
  gitInfo?: {
    remoteUrl?: string;
    branch: string;
    commitSha: string;
    isClean: boolean;
  };
  workspaceRoot: string;
  lastModified: Date;
}

export interface WorkspaceContext {
  currentProject: ProjectInfo;
  isLocalDevelopment: boolean;
  gitAvailable: boolean;
  cursorWorkspace?: string;
}

export class ProjectIdentifier {
  private static instance: ProjectIdentifier;
  private projectCache: Map<string, ProjectInfo> = new Map();

  static getInstance(): ProjectIdentifier {
    if (!ProjectIdentifier.instance) {
      ProjectIdentifier.instance = new ProjectIdentifier();
    }
    return ProjectIdentifier.instance;
  }

  /**
   * Identify the current project based on workspace context
   */
  async identifyProject(workspacePath?: string): Promise<ProjectInfo> {
    const rootPath = workspacePath || process.cwd();
    const cacheKey = this.generateCacheKey(rootPath);

    // Check cache first
    if (this.projectCache.has(cacheKey)) {
      const cached = this.projectCache.get(cacheKey)!;
      // Check if project has been modified since last cache
      if (await this.isProjectUnchanged(cached)) {
        return cached;
      }
    }

    const projectInfo = await this.analyzeProject(rootPath);
    this.projectCache.set(cacheKey, projectInfo);
    return projectInfo;
  }

  /**
   * Get workspace context for the current environment
   */
  async getWorkspaceContext(workspacePath?: string): Promise<WorkspaceContext> {
    const project = await this.identifyProject(workspacePath);
    const gitAvailable = await this.isGitAvailable();
    const cursorWorkspace =
      process.env.CURSOR_WORKSPACE_ROOT || process.env.VSCODE_WORKSPACE_FOLDER;

    return {
      currentProject: project,
      isLocalDevelopment: !project.gitInfo?.remoteUrl,
      gitAvailable,
      cursorWorkspace,
    };
  }

  /**
   * Check if a path is a git repository
   */
  private async isGitRepository(repoPath: string): Promise<boolean> {
    try {
      const gitDir = path.join(repoPath, '.git');
      return fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Get git information for a repository
   */
  private async getGitInfo(repoPath: string): Promise<ProjectInfo['gitInfo']> {
    try {
      const branch = execSync('git branch --show-current', {
        cwd: repoPath,
        encoding: 'utf8',
      }).trim();
      const commitSha = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
      const isClean =
        execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf8' }).trim() === '';

      let remoteUrl: string | undefined;
      try {
        remoteUrl = execSync('git config --get remote.origin.url', {
          cwd: repoPath,
          encoding: 'utf8',
        }).trim();
      } catch {
        // No remote origin configured
      }

      return {
        remoteUrl,
        branch,
        commitSha,
        isClean,
      };
    } catch (error) {
      logger.warn('Failed to get git info', { error });
      return undefined;
    }
  }

  /**
   * Analyze a project directory to determine its type and properties
   */
  private async analyzeProject(projectPath: string): Promise<ProjectInfo> {
    const absolutePath = normalizePathForId(projectPath);

    // Find workspace root first (could be the project itself or a parent)
    const workspaceRoot = await this.findWorkspaceRoot(absolutePath);

    // Check if workspace root is a git repository
    const isWorkspaceGit = await this.isGitRepository(workspaceRoot);
    const gitInfo = isWorkspaceGit ? await this.getGitInfo(workspaceRoot) : undefined;

    // Determine project name
    let projectName = path.basename(absolutePath);
    if (gitInfo?.remoteUrl) {
      // Extract name from git remote URL
      const match = gitInfo.remoteUrl.match(/([^/]+)\.git$/);
      if (match) {
        projectName = match[1];
      }
    }

    // Get last modified time
    const lastModified = await this.getLastModified(absolutePath);

    return {
      id: this.generateProjectId(absolutePath, workspaceRoot, gitInfo),
      name: projectName,
      path: absolutePath,
      type: isWorkspaceGit ? 'git' : 'local',
      gitInfo,
      workspaceRoot,
      lastModified,
    };
  }

  /**
   * Find the workspace root (could be the project itself or a parent directory)
   */
  private async findWorkspaceRoot(projectPath: string): Promise<string> {
    // Check if current directory has workspace indicators
    if (await this.hasWorkspaceIndicators(projectPath)) {
      return projectPath;
    }

    // Walk up the directory tree to find workspace root
    let currentPath = projectPath;
    while (currentPath !== path.dirname(currentPath)) {
      const parentPath = path.dirname(currentPath);
      if (await this.hasWorkspaceIndicators(parentPath)) {
        return parentPath;
      }
      currentPath = parentPath;
    }

    // If no workspace root found, use the project path
    return projectPath;
  }

  /**
   * Check if a directory has workspace indicators
   */
  private async hasWorkspaceIndicators(dirPath: string): Promise<boolean> {
    const indicators = [
      '.vscode/settings.json',
      '.idea',
      'package.json',
      'Cargo.toml',
      'go.mod',
      'requirements.txt',
      'pyproject.toml',
      'tsconfig.json',
      'webpack.config.js',
      'vite.config.js',
      'next.config.js',
      'angular.json',
      'pom.xml',
      'build.gradle',
      'Gemfile',
      'composer.json',
    ];

    for (const indicator of indicators) {
      if (fs.existsSync(path.join(dirPath, indicator))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the last modified time of the project
   */
  private async getLastModified(projectPath: string): Promise<Date> {
    try {
      const stat = fs.statSync(projectPath);
      return stat.mtime;
    } catch {
      return new Date();
    }
  }

  /**
   * Check if git is available on the system
   */
  private async isGitAvailable(): Promise<boolean> {
    try {
      execSync('git --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if project has been modified since last cache
   */
  private async isProjectUnchanged(project: ProjectInfo): Promise<boolean> {
    try {
      const currentModified = await this.getLastModified(project.path);
      return currentModified.getTime() <= project.lastModified.getTime();
    } catch {
      return false;
    }
  }

  /**
   * Generate a unique project ID
   */
  private generateProjectId(
    projectPath: string,
    workspaceRoot: string,
    gitInfo?: ProjectInfo['gitInfo']
  ): string {
    const crypto = require('crypto');

    // For git repositories, include remote URL and branch in the ID
    if (gitInfo?.remoteUrl) {
      const idString = `${gitInfo.remoteUrl}:${gitInfo.branch}:${workspaceRoot}`;
      return crypto.createHash('md5').update(idString).digest('hex').substring(0, 12);
    }

    // For local projects, use workspace root for consistent project identification
    // This ensures that subdirectories of the same workspace are treated as the same project
    return crypto.createHash('md5').update(workspaceRoot).digest('hex').substring(0, 12);
  }

  /**
   * Generate cache key for a project path
   */
  private generateCacheKey(projectPath: string): string {
    return normalizePathForId(projectPath);
  }

  /**
   * Clear project cache
   */
  clearCache(): void {
    this.projectCache.clear();
  }

  /**
   * Get all projects in a workspace
   */
  async getWorkspaceProjects(workspacePath: string): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];

    try {
      const items = fs.readdirSync(workspacePath);

      for (const item of items) {
        const itemPath = path.join(workspacePath, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          // Check if this directory is a project
          if (
            (await this.hasWorkspaceIndicators(itemPath)) ||
            (await this.isGitRepository(itemPath))
          ) {
            const project = await this.analyzeProject(itemPath);
            projects.push(project);
          }
        }
      }
    } catch (error) {
      logger.warn('Error scanning workspace for projects', { error });
    }

    return projects;
  }

  /**
   * Detect project type and return basic info
   */
  async detectProjectType(
    projectPath: string
  ): Promise<{ type: string; name: string; root: string } | null> {
    try {
      const project = await this.analyzeProject(projectPath);
      return {
        type: project.type,
        name: project.name,
        root: project.workspaceRoot,
      };
    } catch {
      return null;
    }
  }

  /**
   * Find workspace root (public method for testing) - sync version
   */
  findWorkspaceRootSync(projectPath: string): string {
    // Use sync version for simpler API
    let currentPath = path.resolve(projectPath);
    while (currentPath !== path.dirname(currentPath)) {
      if (this.hasWorkspaceIndicatorsSync(currentPath)) {
        return currentPath;
      }
      currentPath = path.dirname(currentPath);
    }
    return projectPath;
  }

  /**
   * Sync version of workspace indicators check
   */
  private hasWorkspaceIndicatorsSync(dirPath: string): boolean {
    const indicators = [
      '.git',
      '.vscode/settings.json',
      '.idea',
      'package.json',
      'Cargo.toml',
      'go.mod',
      'requirements.txt',
      'pyproject.toml',
      'tsconfig.json',
    ];

    return indicators.some(indicator => {
      try {
        return fs.existsSync(path.join(dirPath, indicator));
      } catch {
        return false;
      }
    });
  }
}

// Internal helpers
export function normalizePathForId(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  let real: string;
  try {
    // Use native realpath to resolve symlinks and, on Windows, normalize drive casing
    real = fs.realpathSync.native(resolved);
  } catch {
    real = resolved;
  }
  // Normalize separators and trailing slashes
  let normalized = real.replace(/\\+/g, '\\');
  normalized = normalized.replace(/[\\/]+$/g, '');
  // Windows: treat paths case-insensitively and normalize drive letter case
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

/**
 * Load ignore patterns from various ignore files
 */
export async function loadIgnorePatterns(projectPath: string): Promise<string[]> {
  const patterns: string[] = [];

  // Default ignore patterns
  const defaultPatterns = [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    '.next/**',
    '__pycache__/**',
    '*.log',
    '.DS_Store',
    'Thumbs.db',
    '*.tmp',
    '*.swp',
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
  ];

  patterns.push(...defaultPatterns);

  // Check for various ignore files
  const ignoreFiles = ['.gitignore', '.cursorignore', '.vscodeignore', '.ambianceignore'];

  for (const ignoreFile of ignoreFiles) {
    const ignoreFilePath = path.join(projectPath, ignoreFile);

    try {
      if (fs.existsSync(ignoreFilePath)) {
        const content = fs.readFileSync(ignoreFilePath, 'utf8');
        const filePatterns = parseIgnoreFile(content);
        patterns.push(...filePatterns);
      }
    } catch (error) {
      logger.warn('Failed to read ignore file', { ignoreFile, error });
    }
  }

  return [...new Set(patterns)]; // Remove duplicates
}

/**
 * Parse ignore file content into patterns array
 */
export function parseIgnoreFile(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

/**
 * Check if a file should be ignored based on patterns
 */
export function shouldIgnoreFile(filePath: string, patterns: string[]): boolean {
  let shouldIgnore = false;
  const basename = path.basename(filePath);

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      // Negation pattern - check if it matches
      const negatedPattern = pattern.slice(1);
      if (minimatch(filePath, negatedPattern) || minimatch(basename, negatedPattern)) {
        shouldIgnore = false;
      }
    } else {
      // Regular ignore pattern
      if (minimatch(filePath, pattern) || minimatch(basename, pattern)) {
        shouldIgnore = true;
      }
    }
  }

  return shouldIgnore;
}
