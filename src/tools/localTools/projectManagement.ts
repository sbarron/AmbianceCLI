/**
 * @fileOverview: Project management tools for listing and managing embedded projects
 * @module: ProjectManagement
 * @keyFunctions:
 *   - listProjectsWithEmbeddings(): List all projects with embeddings
 *   - deleteProjectEmbeddings(): Delete embeddings for a specific project
 *   - getProjectEmbeddingDetails(): Inspect coverage and compatibility for a project
 * @context: Helper utilities for managing embedding metadata across projects
 */

import { logger } from '../../utils/logger';
import { LocalEmbeddingStorage } from '../../local/embeddingStorage';
import { LocalProjectManager, LocalProject } from '../../local/projectManager';
import * as fs from 'fs';
import * as path from 'path';
import { globby } from 'globby';
import { loadIgnorePatterns } from '../../local/projectIdentifier';

interface IgnorePatterns {
  gitignore: string[];
  cursorignore: string[];
  vscodeignore: string[];
  ambianceignore: string[];
}

/**
 * Get the common path prefix from an array of file paths
 */
function getCommonPathPrefix(paths: string[]): string | null {
  if (paths.length === 0) return null;
  if (paths.length === 1) return paths[0];

  // Split all paths into arrays of components
  const pathArrays = paths.map(p => p.split(/[/\\]/).filter(c => c));

  // Find the minimum length
  const minLength = Math.min(...pathArrays.map(arr => arr.length));

  // Find common prefix
  const commonPrefix: string[] = [];
  for (let i = 0; i < minLength; i++) {
    const component = pathArrays[0][i];
    if (pathArrays.every(arr => arr[i] === component)) {
      commonPrefix.push(component);
    } else {
      break;
    }
  }

  return commonPrefix.length > 0 ? commonPrefix.join('/') : null;
}

/**
 * Load ignore patterns using the same logic as the automatic indexer
 */
async function loadProjectIgnorePatterns(projectPath: string): Promise<IgnorePatterns> {
  const patterns: IgnorePatterns = {
    gitignore: [],
    cursorignore: [],
    vscodeignore: [],
    ambianceignore: [],
  };

  const ignoreFiles = [
    { file: '.gitignore', key: 'gitignore' as keyof IgnorePatterns },
    { file: '.cursorignore', key: 'cursorignore' as keyof IgnorePatterns },
    { file: '.vscodeignore', key: 'vscodeignore' as keyof IgnorePatterns },
    { file: '.ambianceignore', key: 'ambianceignore' as keyof IgnorePatterns },
  ];

  for (const { file, key } of ignoreFiles) {
    if (file === '.gitignore') {
      // Use loadIgnorePatterns function for .gitignore
      try {
        const gitignorePatterns = await loadIgnorePatterns(projectPath);
        patterns[key] = gitignorePatterns;
      } catch (error) {
        logger.warn(`Failed to load .gitignore patterns:`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      // Read other ignore files directly
      const filePath = path.join(projectPath, file);
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          patterns[key] = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
        }
      } catch (error) {
        logger.warn(`Failed to read ${file}:`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Add comprehensive default ignore patterns (same as indexer)
  patterns.gitignore.push(
    ...[
      // Node.js
      '**/node_modules/**',
      'node_modules/**',
      '**/npm-debug.log*',
      '**/yarn-debug.log*',
      '**/yarn-error.log*',
      '**/package-lock.json',
      '**/yarn.lock',

      // Build outputs
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.next/**',

      // Version control
      '**/.git/**',
      '**/.svn/**',

      // IDE files
      '**/.vscode/**',
      '**/.idea/**',
      '**/*.suo',
      '**/*.user',
      '**/*.userosscache',
      '**/*.sln.docstates',

      // OS files
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/desktop.ini',

      // Logs
      '**/*.log',
      '**/logs/**',

      // Cache directories
      '**/.cache/**',
      '**/tmp/**',
      '**/temp/**',
      '**/.tmp/**',

      // Coverage directories
      '**/coverage/**',
      '**/.nyc_output/**',

      // Environment files
      '**/.env',
      '**/.env.local',
      '**/.env.*.local',

      // Other common ignores
      '**/*.tsbuildinfo',
      '**/*.map',
      '**/tsconfig.tsbuildinfo',
    ]
  );

  return patterns;
}

/**
 * Analyze what files should be indexed using the same logic as the embedding indexer
 */
async function analyzeProjectIndexableFiles(projectPath: string): Promise<{
  totalFiles: number;
  excludedFiles: number;
  indexableFiles: number;
  scanSuccessful: boolean;
  error?: string;
}> {
  try {
    // Check if project directory exists and is accessible
    if (!fs.existsSync(projectPath)) {
      return {
        totalFiles: 0,
        excludedFiles: 0,
        indexableFiles: 0,
        scanSuccessful: false,
        error: 'Project directory not found',
      };
    }

    // Load ignore patterns using the same logic as the indexer
    const ignorePatterns = await loadProjectIgnorePatterns(projectPath);

    // Use the same file patterns as the indexer
    const includePatterns = [
      '**/*.{js,jsx,ts,tsx,py,go,rs,java,cpp,c,h,hpp,cs,rb,php,swift,kt,scala,clj,hs,ml,r,sql,sh,bash,zsh}',
    ];

    // Combine all ignore patterns (same as indexer)
    const allIgnorePatterns = [
      ...ignorePatterns.gitignore,
      ...ignorePatterns.cursorignore,
      ...ignorePatterns.vscodeignore,
      ...ignorePatterns.ambianceignore,
    ];

    // Find all matching files (same as indexer)
    const allFiles = await globby(includePatterns, {
      cwd: projectPath,
      ignore: allIgnorePatterns,
      absolute: false,
      dot: false,
    });

    // Apply the same additional filtering as the indexer
    const shouldIgnoreFile = (filePath: string): boolean => {
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
    };

    const beforeFilterCount = allFiles.length;
    const indexableFiles = allFiles.filter(file => !shouldIgnoreFile(file));
    const afterFilterCount = indexableFiles.length;
    const excludedFiles = beforeFilterCount - afterFilterCount;

    return {
      totalFiles: beforeFilterCount,
      excludedFiles,
      indexableFiles: afterFilterCount,
      scanSuccessful: true,
    };
  } catch (error) {
    logger.warn('Failed to analyze project files for indexing coverage', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      totalFiles: 0,
      excludedFiles: 0,
      indexableFiles: 0,
      scanSuccessful: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Analyze embedding coverage patterns to provide context about whether the count seems reasonable
 */
function analyzeEmbeddingCoverage(
  files: Array<{
    path: string;
    hash: string;
    lastModified: Date;
    fileSize: number;
    language?: string;
    lineCount?: number;
  }>
): {
  coverageInsights: string[];
  expectedFileTypes: string[];
  unusualPatterns?: string[];
} {
  const insights: string[] = [];
  const fileTypes = new Set<string>();
  const languages = new Set<string>();
  const directories = new Set<string>();

  // Analyze file patterns
  files.forEach(file => {
    const ext = path.extname(file.path).toLowerCase();
    fileTypes.add(ext);

    if (file.language) {
      languages.add(file.language);
    }

    // Track directories
    const dir = path.dirname(file.path);
    if (dir !== '.') {
      directories.add(dir);
    }
  });

  const fileTypeArray = Array.from(fileTypes);
  const languageArray = Array.from(languages);
  const directoryArray = Array.from(directories);

  // Generate insights
  insights.push(`${files.length} files across ${directoryArray.length} directories`);

  if (languageArray.length > 0) {
    insights.push(`Languages detected: ${languageArray.join(', ')}`);
  }

  // Check for common file types that might indicate project scope
  const hasSourceCode = fileTypeArray.some(ext =>
    ['.ts', '.js', '.py', '.java', '.go', '.rs', '.cpp', '.c'].includes(ext)
  );
  const hasConfigFiles = fileTypeArray.some(ext =>
    ['.json', '.yml', '.yaml', '.toml', '.xml'].includes(ext)
  );
  const hasDocumentation = fileTypeArray.some(ext => ['.md', '.txt', '.rst'].includes(ext));

  const projectIndicators = [];
  if (hasSourceCode) projectIndicators.push('source code');
  if (hasConfigFiles) projectIndicators.push('configuration');
  if (hasDocumentation) projectIndicators.push('documentation');

  if (projectIndicators.length > 0) {
    insights.push(`Project appears to include: ${projectIndicators.join(', ')}`);
  }

  // Size analysis
  const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);
  const avgSize = totalSize / files.length;
  const largeFiles = files.filter(f => f.fileSize > 1024 * 1024).length; // > 1MB

  if (largeFiles > 0) {
    insights.push(`${largeFiles} large files (>1MB) detected`);
  }

  // Date analysis
  const dates = files.map(f => f.lastModified.getTime()).sort();
  const oldestFile = new Date(Math.min(...dates));
  const newestFile = new Date(Math.max(...dates));
  const dateRange = newestFile.getTime() - oldestFile.getTime();
  const daysRange = Math.ceil(dateRange / (1000 * 60 * 60 * 24));

  insights.push(
    `Files span ${daysRange} days (oldest: ${oldestFile.toISOString().split('T')[0]}, newest: ${newestFile.toISOString().split('T')[0]})`
  );

  // Expected file types based on detected languages
  const expectedTypes: string[] = [];
  languageArray.forEach(lang => {
    switch (lang.toLowerCase()) {
      case 'typescript':
      case 'javascript':
        expectedTypes.push('.ts', '.tsx', '.js', '.jsx', '.json', '.md');
        break;
      case 'python':
        expectedTypes.push('.py', '.txt', '.md', '.yml', '.yaml');
        break;
      case 'markdown':
        expectedTypes.push('.md');
        break;
      case 'json':
        expectedTypes.push('.json');
        break;
    }
  });

  // Check for unusual patterns
  const unusualPatterns: string[] = [];
  const unexpectedTypes = fileTypeArray.filter(
    ext =>
      !expectedTypes.includes(ext) &&
      !['.lock', '.sum', '.mod', '.gitignore', '.dockerignore'].includes(ext) &&
      ext !== ''
  );

  if (unexpectedTypes.length > 0) {
    unusualPatterns.push(`Unexpected file types: ${unexpectedTypes.join(', ')}`);
  }

  // Check for very small file counts that might indicate incomplete indexing
  if (files.length < 10 && hasSourceCode) {
    unusualPatterns.push(
      'Very low file count for a project with source code - may indicate incomplete indexing'
    );
  }

  return {
    coverageInsights: insights,
    expectedFileTypes: [...new Set(expectedTypes)],
    unusualPatterns: unusualPatterns.length > 0 ? unusualPatterns : undefined,
  };
}

/**
 * Tool definition for listing projects with embeddings
 */
export async function listProjectsWithEmbeddings(): Promise<{
  projects: Array<{
    projectId: string;
    totalChunks: number;
    totalFiles: number;
    lastUpdated: Date;
  }>;
  summary: {
    totalProjects: number;
    totalChunks: number;
    totalFiles: number;
  };
}> {
  const storage = new LocalEmbeddingStorage();

  try {
    const projects = await storage.listProjectsWithEmbeddings();

    const summary = {
      totalProjects: projects.length,
      totalChunks: projects.reduce((sum, p) => sum + p.totalChunks, 0),
      totalFiles: projects.reduce((sum, p) => sum + p.totalFiles, 0),
    };

    logger.info('📋 Listed projects with embeddings', {
      projectCount: projects.length,
      totalChunks: summary.totalChunks,
      totalFiles: summary.totalFiles,
    });

    return { projects, summary };
  } catch (error) {
    logger.error('❌ Failed to list projects with embeddings', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Handle deleting project embeddings
 */
export async function deleteProjectEmbeddings(args: {
  projectIdentifier: string;
  confirmDeletion: boolean;
}): Promise<{
  success: boolean;
  projectId: string;
  deletedStats: {
    chunksDeleted: number;
    filesDeleted: number;
  };
  message: string;
}> {
  const { projectIdentifier, confirmDeletion } = args;

  if (!confirmDeletion) {
    throw new Error('Deletion not confirmed. Set confirmDeletion: true to proceed.');
  }

  const storage = new LocalEmbeddingStorage();
  const projectManager = new LocalProjectManager();

  try {
    // Find the project
    const project = await projectManager.getProject(projectIdentifier);
    if (!project) {
      throw new Error(`Project not found: ${projectIdentifier}`);
    }

    // Get stats before deletion
    const statsBefore = await storage.getProjectStats(project.id);

    // Delete embeddings and associated data
    await storage.clearProjectEmbeddings(project.id);

    // Verify deletion
    const statsAfter = await storage.getProjectStats(project.id);

    const deletedStats = {
      chunksDeleted: (statsBefore?.totalChunks || 0) - (statsAfter?.totalChunks || 0),
      filesDeleted: (statsBefore?.totalFiles || 0) - (statsAfter?.totalFiles || 0),
    };

    const message = `Successfully deleted embeddings for project "${project.name}" (${project.id}). Removed ${deletedStats.chunksDeleted} chunks and ${deletedStats.filesDeleted} file records.`;

    logger.info('🗑️ Project embeddings deleted', {
      projectId: project.id,
      projectName: project.name,
      chunksDeleted: deletedStats.chunksDeleted,
      filesDeleted: deletedStats.filesDeleted,
    });

    return {
      success: true,
      projectId: project.id,
      deletedStats,
      message,
    };
  } catch (error) {
    logger.error('❌ Failed to delete project embeddings', {
      error: error instanceof Error ? error.message : String(error),
      projectIdentifier,
    });
    throw error;
  }
}

/**
 * Handle getting project embedding details
 */
export async function getProjectEmbeddingDetails(args: {
  projectIdentifier: string;
  projectPath?: string;
}): Promise<{
  project: LocalProject;
  stats: {
    totalChunks: number;
    totalFiles: number;
    lastUpdated: Date;
  } | null;
  coverage: {
    embeddedFiles: number;
    indexableFiles: number;
    coveragePercent: number;
    missingFiles: number;
    projectFiles: {
      total: number;
      excluded: number;
      languages: Record<string, number>;
      fileTypes: Record<string, number>;
    };
  };
  modelInfo: any;
  mixedModels: {
    detected: boolean;
    models: Array<{
      provider: string;
      dimensions: number;
      count: number;
    }>;
  };
  files: Array<{
    path: string;
    hash: string;
    lastModified: Date;
    fileSize: number;
    language?: string;
    lineCount?: number;
  }>;
  compatibility: {
    compatible: boolean;
    issues: string[];
    recommendations: string[];
  };
}> {
  const { projectIdentifier } = args;

  const storage = new LocalEmbeddingStorage();
  const projectManager = new LocalProjectManager();

  try {
    // Ensure storage is initialized
    await storage.initializeDatabase();

    // Find the project - try LocalProjectManager first
    let project = await projectManager.getProject(projectIdentifier);

    // If not found in LocalProjectManager, check if this is a project ID that exists in the database
    if (!project) {
      logger.info(
        `🔍 Project not found in LocalProjectManager, checking database for: ${projectIdentifier}`
      );
      const db = (storage as any).db;
      logger.info(`🔍 Database available: ${!!db}`);
      if (db) {
        // First, check if the projectIdentifier is actually a project ID in the database
        logger.info(`📊 Checking project stats for: ${projectIdentifier}`);
        let stats;
        try {
          stats = await storage.getProjectStats(projectIdentifier);
          logger.info(
            `📊 Project stats result: ${stats ? `found (${stats.totalChunks} chunks, ${stats.totalFiles} files)` : 'not found'}`
          );
        } catch (statsError) {
          logger.error(
            `📊 Error getting project stats: ${statsError instanceof Error ? statsError.message : String(statsError)}`
          );
          throw statsError;
        }
        if (stats) {
          // Found a project with this ID in the database - create a synthetic project object
          let projectPath = args.projectPath || projectIdentifier; // Use provided path, fallback to ID

          // If no path was provided, try to determine the project path from the file paths in the database
          if (!args.projectPath) {
            const filesMetadata = await storage.listProjectFiles(projectIdentifier);
            if (filesMetadata.length > 0) {
              // Try to infer the project path from the common prefix of file paths
              const filePaths = filesMetadata.map(f => f.path);
              const commonPrefix = getCommonPathPrefix(filePaths);
              if (commonPrefix) {
                projectPath = path.dirname(commonPrefix);
              }
            }
          }

          project = {
            id: projectIdentifier,
            name: path.basename(projectPath) || projectIdentifier,
            path: projectPath,
            addedAt: new Date(), // We don't have this info, so use current time
            lastIndexed: new Date(), // We don't have this info, so use current time
          };
          logger.info(
            `📁 Found unregistered project with embeddings: ${project.name} (${projectIdentifier})`
          );
        } else {
          // Not a project ID, try to resolve as a path and find matching embeddings
          const resolvedPath = path.resolve(projectIdentifier);

          // Check if there are any embeddings where the file paths suggest this project path
          const rows = await new Promise<any[]>((resolve, reject) => {
            db.all(
              `SELECT DISTINCT project_id FROM embeddings LIMIT 10`,
              [],
              (err: any, rows: any[]) => {
                if (err) reject(err);
                else resolve(rows);
              }
            );
          });

          // For each project ID, check if any of its files match the target path
          for (const row of rows) {
            const projectId = row.project_id;
            const files = await storage.listProjectFiles(projectId);
            const matchingFiles = files.filter(
              f =>
                path.resolve(f.path).startsWith(resolvedPath) ||
                f.path.includes(path.basename(resolvedPath))
            );

            if (matchingFiles.length > 0) {
              // Found a project that contains files from this path
              project = {
                id: projectId,
                name: path.basename(resolvedPath),
                path: resolvedPath,
                addedAt: new Date(),
                lastIndexed: new Date(),
              };
              logger.info(
                `📁 Found project with embeddings matching path: ${project.name} (${projectId})`
              );
              break;
            }
          }
        }
      }

      if (!project) {
        logger.debug(
          `Project not found in LocalProjectManager: ${projectIdentifier} - this is expected for projects without embeddings`
        );
        throw new Error(
          `Project not found: ${projectIdentifier}. Make sure the project has been indexed with embeddings. Try manage_embeddings with action="list_projects" to see available projects.`
        );
      }
    }

    // Get project statistics
    const stats = await storage.getProjectStats(project.id);

    // Get model information
    const modelInfo = await storage.getModelInfo(project.id);

    // Get file list
    const filesMetadata = await storage.listProjectFiles(project.id);
    const files = filesMetadata.map(f => ({
      path: f.path,
      hash: f.hash,
      lastModified: f.lastModified,
      fileSize: f.fileSize,
      language: f.language,
      lineCount: f.lineCount,
    }));

    // Calculate coverage - since we can't scan the original project (paths are relative),
    // we'll use the embedded files as the baseline and note this limitation
    const embeddedFiles = stats?.totalFiles || 0;

    // Extract language and file type statistics from embedded files
    const languages: Record<string, number> = {};
    const fileTypes: Record<string, number> = {};

    filesMetadata.forEach(file => {
      if (file.language) {
        languages[file.language] = (languages[file.language] || 0) + 1;
      }

      const ext = path.extname(file.path).toLowerCase().slice(1);
      fileTypes[ext] = (fileTypes[ext] || 0) + 1;
    });

    // Analyze embedding coverage using the same logic as the indexer
    const projectScan = await analyzeProjectIndexableFiles(project.path);
    const embeddingStats = analyzeEmbeddingCoverage(filesMetadata);

    const indexableFiles = projectScan.indexableFiles;
    const coveragePercent =
      indexableFiles > 0 ? Math.round((embeddedFiles / indexableFiles) * 10000) / 100 : 0;
    const missingFiles = Math.max(0, indexableFiles - embeddedFiles);

    const coverage = {
      embeddedFiles,
      indexableFiles,
      coveragePercent,
      missingFiles,
      projectFiles: {
        total: projectScan.totalFiles,
        excluded: projectScan.excludedFiles,
        indexable: projectScan.indexableFiles,
        languages,
        fileTypes,
        ...embeddingStats,
        ...projectScan,
        note:
          indexableFiles > 0
            ? `Coverage calculated using same file discovery logic as embedding indexer.`
            : 'Could not access project directory to calculate coverage - statistics based on embedded files only.',
      },
    };

    // Check for mixed models and compatibility with current model
    const { getCurrentModelConfiguration } = await import('./embeddingManagement');
    const currentModelConfig = await getCurrentModelConfiguration();
    const compatibility = await storage.validateEmbeddingCompatibility(
      project.id,
      currentModelConfig.provider,
      currentModelConfig.dimensions
    );

    // Extract model information for easier consumption - always check for models
    let mixedModels = {
      detected: false,
      models: [] as Array<{
        provider: string;
        dimensions: number;
        count: number;
      }>,
    };

    try {
      // Always query the database to get model breakdown
      const db = (storage as any).db;
      if (db) {
        const modelRows = await new Promise<any[]>((resolve, reject) => {
          db.all(
            `SELECT
              metadata_embedding_provider,
              metadata_embedding_dimensions,
              COUNT(*) as count
            FROM embeddings
            WHERE project_id = ?
            GROUP BY metadata_embedding_provider, metadata_embedding_dimensions
            ORDER BY count DESC`,
            [project.id],
            (err: any, rows: any[]) => {
              if (err) reject(err);
              else resolve(rows);
            }
          );
        });

        // Normalize provider labels
        const norm = (label: string) => {
          const l = (label || '').toLowerCase();
          if (l.startsWith('text-embedding-')) return 'openai';
          if (l.startsWith('voyage-') || l === 'voyageai' || l === 'ambiance') return 'voyageai';
          if (l.includes('minilm') || l.includes('transformers')) return 'local';
          return label;
        };

        const models = modelRows.map(row => ({
          provider: norm(row.metadata_embedding_provider || 'unknown'),
          dimensions: row.metadata_embedding_dimensions || 0,
          count: row.count,
        }));

        mixedModels = {
          detected: models.length > 1,
          models,
        };
      }
    } catch (error) {
      logger.warn('Failed to extract mixed model information', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Enhance compatibility information with more context
    const enhancedCompatibility = {
      ...compatibility,
      description:
        'Embedding model compatibility for similarity search - checks for mixed embedding models and dimension consistency',
      checked: [
        'Mixed embedding model detection',
        'Embedding dimension consistency',
        'Missing dimension metadata',
      ],
    };

    logger.info('📊 Retrieved project embedding details', {
      projectId: project.id,
      filesCount: files.length,
      totalChunks: stats?.totalChunks || 0,
      coveragePercent: coverage.coveragePercent,
      mixedModelsDetected: mixedModels.detected,
    });

    return {
      project,
      stats,
      coverage,
      modelInfo,
      mixedModels,
      files,
      compatibility: enhancedCompatibility,
    };
  } catch (error) {
    logger.error('❌ Failed to get project embedding details', {
      error: error instanceof Error ? error.message : String(error),
      projectIdentifier,
    });
    throw error;
  }
}
