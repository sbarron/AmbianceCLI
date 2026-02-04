/**
 * @fileOverview: Ambiance project status monitoring tool
 * @module: ProjectStatus
 * @keyFunctions:
 *   - handleProjectStatus(): Check indexing status, health, and configuration
 * @dependencies:
 *   - ProjectIdentifier: Project type detection
 *   - setupProject: Access to sync state
 * @context: Provides project health monitoring and diagnostics
 */

import { logger } from '../../utils/logger';
import { ProjectIdentifier } from '../../local/projectIdentifier';
import { lastSyncAt, lastProjectId, currentWatcher } from './setupProject';

const projectIdentifier = ProjectIdentifier.getInstance();

function resolveBaseDir(): string {
  const envBase = process.env.AMBIANCE_BASE_DIR?.trim();
  if (envBase) {
    try {
      const resolved = require('path').resolve(envBase);
      if (resolved.includes('..') || resolved.startsWith('/etc') || resolved.startsWith('/root')) {
        logger.warn('⚠️ Potentially unsafe AMBIANCE_BASE_DIR ignored:', { envBase });
        return process.cwd();
      }
      return resolved;
    } catch (error) {
      logger.warn('⚠️ Invalid AMBIANCE_BASE_DIR, using CWD:', { envBase });
      return process.cwd();
    }
  }
  return process.cwd();
}

async function checkCloudConnection(): Promise<boolean> {
  try {
    // Check if API key is available and valid
    return !!process.env.AMBIANCE_API_KEY;
  } catch {
    return false;
  }
}

async function runHealthChecks(projectPath: string): Promise<any> {
  const checks = {
    projectDetection: false,
    indexingSystem: false,
    fileWatcher: false,
    contextOptimizer: false,
    issues: [] as string[],
  };

  try {
    // Check project detection
    const projectInfo = await projectIdentifier.identifyProject(projectPath);
    checks.projectDetection = !!projectInfo;
    if (!projectInfo) {
      checks.issues.push('Project not properly detected - may affect context quality');
    }

    // Thin connector: no local indexing system
    checks.indexingSystem = false;

    // Check context optimizer
    checks.contextOptimizer = false;

    // File watcher check (assume working if no errors)
    checks.fileWatcher = !!currentWatcher;
  } catch (error) {
    checks.issues.push(`Health check failed: ${error}`);
  }

  return checks;
}

export const ambianceProjectStatusTool = {
  name: 'ambiance_project_status',
  description: `📊 PROJECT STATUS - Check indexing status, health, and configuration.

Shows what's been indexed, any issues, and system health. Useful for debugging context quality issues.`,

  inputSchema: {
    type: 'object',
    properties: {
      showDetails: {
        type: 'boolean',
        description: 'Include detailed indexing statistics and file counts',
        default: false,
      },
      checkHealth: {
        type: 'boolean',
        description: 'Run health checks on the indexing system',
        default: true,
      },
    },
  },
};

export async function handleProjectStatus(args: any): Promise<any> {
  const { showDetails = false, checkHealth = true } = args;

  try {
    // Get current project path
    const baseDir = resolveBaseDir();
    const projectPath = baseDir;
    const detected = await projectIdentifier.detectProjectType(projectPath);

    // Basic status
    const status: any = {
      project: {
        name: detected?.name || 'Unknown',
        type: (detected?.type as string) || 'Unknown',
        path: projectPath,
        detected: !!detected,
      },
      syncing: {
        lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
        watcherRunning: !!currentWatcher,
      },
      features: {
        fileWatching: !!currentWatcher,
        cloudSync: await checkCloudConnection(),
        contextOptimization: false,
      },
    };

    // No detailed stats in thin connector; include minimal heartbeat
    if (showDetails) {
      status.details = {
        projectId: lastProjectId || null,
      };
    }

    // Run health checks if requested
    if (checkHealth) {
      status.health = await runHealthChecks(projectPath);
    }

    return {
      success: true,
      ...status,
    };
  } catch (error) {
    logger.error('❌ Status check failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: 'Could not retrieve project status',
    };
  }
}
