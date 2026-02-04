/**
 * @fileOverview: Cloud tool handlers - Implementation of cloud storage and embedding operations
 * @module: CloudToolHandlers
 * @keyFunctions:
 *   - handleSearchContext(): Search cloud-indexed repositories
 *   - handleAddLocalProject(): Add local project to cloud storage
 *   - handleUploadEmbeddings(): Upload project embeddings to cloud
 *   - handleSyncProject(): One-way project upload to cloud
 * @dependencies:
 *   - apiClient: Cloud service communication
 *   - AutomaticIndexer: Local project indexing
 *   - FileSyncClient: File synchronization utilities
 * @context: Implements cloud-based project management with embedding storage and cross-device synchronization
 */

import * as path from 'path';
import * as fs from 'fs';
import { apiClient } from '../../client/apiClient';
import { logger } from '../../utils/logger';
import { AutomaticIndexer } from '../../local/automaticIndexer';
import { LocalProjectManager } from '../../local/projectManager';
import { ProjectIdentifier, ProjectInfo } from '../../local/projectIdentifier';
import { syncProject } from '../../connector/fileSyncClient';
import {
  handleSearchContext as cloudSearchContext,
  handleGetContextBundle as cloudGetContextBundle,
  getRepositories,
  getAlerts,
} from '../cloudHandlers';

const projectManager = new LocalProjectManager();
const indexer = AutomaticIndexer.getInstance();

export interface CloudToolResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    operation: string;
    timestamp: string;
    source: 'github_repos' | 'uploaded_projects' | 'local_development';
    projectId?: string;
    dataType?: 'repository' | 'uploaded_project' | 'local_file';
  };
}

/**
 * Search GitHub repositories indexed via Ambiance GitHub App
 */
export async function handleSearchGithubRepos(args: {
  query: string;
  github_repo: string;
  branch?: string;
  k?: number;
}): Promise<CloudToolResponse> {
  try {
    // Validate required github_repo parameter
    if (!args.github_repo) {
      return {
        success: false,
        error:
          'github_repo parameter is required. Use ambiance_list_github_repos to see available repositories.',
        metadata: {
          operation: 'search_github_repos',
          timestamp: new Date().toISOString(),
          source: 'github_repos',
        },
      };
    }

    logger.info('🐙 GitHub repository search initiated', {
      query: args.query,
      repo: args.github_repo,
    });

    // Convert new parameter names to existing API format
    const searchArgs = {
      query: args.query,
      repo: args.github_repo,
      branch: args.branch,
      k: args.k,
    };

    const results = await cloudSearchContext(searchArgs);

    // Add source indicators to results
    const enrichedResults = results.map(result => ({
      ...result,
      source: 'github_repos' as const,
      dataType: 'repository' as const,
      sourceInfo: {
        type: 'GitHub Repository',
        repository: args.github_repo || 'All accessible repos',
        branch: args.branch || 'main',
        icon: '🐙',
      },
    }));

    return {
      success: true,
      data: {
        results: enrichedResults,
        count: enrichedResults.length,
        query: args.query,
        github_repo: args.github_repo,
        branch: args.branch,
        sourceType: 'GitHub Repositories',
      },
      metadata: {
        operation: 'search_github_repos',
        timestamp: new Date().toISOString(),
        source: 'github_repos',
        dataType: 'repository',
      },
    };
  } catch (error) {
    logger.error('❌ GitHub repository search failed', { error, query: args.query });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during GitHub search',
      metadata: {
        operation: 'search_github_repos',
        timestamp: new Date().toISOString(),
        source: 'github_repos',
      },
    };
  }
}

/**
 * Search your locally uploaded projects stored in Ambiance cloud
 */
export async function handleSearchUploadedProjects(args: {
  query: string;
  local_project_id?: string;
  k?: number;
}): Promise<CloudToolResponse> {
  try {
    logger.info('📁 Uploaded projects search initiated', {
      query: args.query,
      projectId: args.local_project_id,
    });

    // Beta Limitation: Uploaded projects search not yet implemented
    // This feature is planned for post-beta releases
    logger.info('📁 Uploaded projects search requested but not yet implemented in beta');
    const results: any[] = []; // Returns empty results for beta release

    const enrichedResults = results.map(result => ({
      ...result,
      source: 'uploaded_projects' as const,
      dataType: 'uploaded_project' as const,
      sourceInfo: {
        type: 'Uploaded Local Project',
        project: args.local_project_id || 'All uploaded projects',
        icon: '📁',
      },
    }));

    return {
      success: true,
      data: {
        results: enrichedResults,
        count: enrichedResults.length,
        query: args.query,
        local_project_id: args.local_project_id,
        sourceType: 'Uploaded Local Projects',
      },
      metadata: {
        operation: 'search_uploaded_projects',
        timestamp: new Date().toISOString(),
        source: 'uploaded_projects',
        dataType: 'uploaded_project',
      },
    };
  } catch (error) {
    logger.error('❌ Uploaded projects search failed', { error, query: args.query });
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Unknown error during uploaded projects search',
      metadata: {
        operation: 'search_uploaded_projects',
        timestamp: new Date().toISOString(),
        source: 'uploaded_projects',
      },
    };
  }
}

/**
 * Upload your local project folder to Ambiance cloud storage
 */
export async function handleUploadLocalProject(args: {
  path: string;
  name?: string;
  exclude_patterns?: string[];
}): Promise<CloudToolResponse> {
  try {
    const absolutePath = path.resolve(args.path);
    const projectName = args.name || path.basename(absolutePath);

    logger.info('📤 Uploading local project to cloud storage', {
      path: absolutePath,
      name: projectName,
      excludePatterns: args.exclude_patterns,
    });

    // Validate project path exists
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Project path does not exist: ${absolutePath}`);
    }

    // Identify project information
    const projectInfo = await ProjectIdentifier.getInstance().identifyProject(absolutePath);
    if (!projectInfo) {
      throw new Error('Could not identify project structure');
    }

    // Add to local project manager
    const localProject = await projectManager.addProject(absolutePath, projectName);

    // Start automatic indexing
    const indexingSession = await indexer.indexProject(absolutePath, { force: false });

    // Use file sync to upload to cloud
    const syncResult = await syncProject(absolutePath);

    logger.info('✅ Local project uploaded successfully', {
      projectId: localProject.id,
      sessionId: indexingSession?.id,
      uploadedFiles: syncResult.uploadedCount,
    });

    return {
      success: true,
      data: {
        project: {
          ...localProject,
          sourceInfo: {
            type: 'Uploaded Local Project',
            originalPath: absolutePath,
            icon: '📤',
          },
        },
        indexingSession,
        projectInfo,
        syncResult,
        sourceType: 'Uploaded Local Project',
      },
      metadata: {
        operation: 'upload_local_project',
        timestamp: new Date().toISOString(),
        source: 'uploaded_projects',
        dataType: 'uploaded_project',
        projectId: localProject.id,
      },
    };
  } catch (error) {
    logger.error('❌ Failed to upload local project', { error, path: args.path });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error uploading local project',
      metadata: {
        operation: 'upload_local_project',
        timestamp: new Date().toISOString(),
        source: 'uploaded_projects',
      },
    };
  }
}

/**
 * List all your local projects that have been uploaded to Ambiance cloud storage
 */
export async function handleListUploadedProjects(): Promise<CloudToolResponse> {
  try {
    logger.info('📋 Listing uploaded local projects');

    const projects = await projectManager.listProjects();

    // Add source info to each project
    const enrichedProjects = projects.map(project => ({
      ...project,
      sourceInfo: {
        type: 'Uploaded Local Project',
        originalPath: project.path,
        icon: '📁',
      },
    }));

    return {
      success: true,
      data: {
        projects: enrichedProjects,
        count: enrichedProjects.length,
        sourceType: 'Uploaded Local Projects',
      },
      metadata: {
        operation: 'list_uploaded_projects',
        timestamp: new Date().toISOString(),
        source: 'uploaded_projects',
        dataType: 'uploaded_project',
      },
    };
  } catch (error) {
    logger.error('❌ Failed to list uploaded projects', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error listing uploaded projects',
      metadata: {
        operation: 'list_uploaded_projects',
        timestamp: new Date().toISOString(),
        source: 'uploaded_projects',
      },
    };
  }
}

/**
 * List GitHub repositories available through the Ambiance GitHub App
 */
export async function handleListGithubRepos(): Promise<CloudToolResponse> {
  try {
    logger.info('🐙 Listing GitHub repositories');

    const repositories = await getRepositories();

    // Add source info to each repository
    const enrichedRepos = repositories.map(repo => ({
      ...repo,
      sourceInfo: {
        type: 'GitHub Repository',
        repository: repo.full_name || repo.name,
        icon: '🐙',
      },
    }));

    return {
      success: true,
      data: {
        repositories: enrichedRepos,
        count: enrichedRepos.length,
        sourceType: 'GitHub Repositories',
      },
      metadata: {
        operation: 'list_github_repos',
        timestamp: new Date().toISOString(),
        source: 'github_repos',
        dataType: 'repository',
      },
    };
  } catch (error) {
    logger.error('❌ Failed to list GitHub repositories', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error listing GitHub repositories',
      metadata: {
        operation: 'list_github_repos',
        timestamp: new Date().toISOString(),
        source: 'github_repos',
      },
    };
  }
}

/**
 * Get structured context bundle from GitHub repositories
 */
export async function handleGetGithubContextBundle(args: {
  query: string;
  hints?: string[];
  token_budget?: number;
  github_repo?: string;
  branch?: string;
}): Promise<CloudToolResponse> {
  try {
    logger.info('🐙📦 Getting GitHub context bundle', {
      query: args.query,
      repo: args.github_repo,
    });

    // Convert new parameter names to existing API format
    const bundleArgs = {
      query: args.query,
      hints: args.hints,
      token_budget: args.token_budget,
      repo: args.github_repo,
      branch: args.branch,
    };

    const bundle = await cloudGetContextBundle(bundleArgs);

    // Add source info to bundle
    const enrichedBundle = {
      ...bundle,
      sourceInfo: {
        type: 'GitHub Repository Context Bundle',
        repository: args.github_repo || 'All accessible repos',
        branch: args.branch || 'main',
        icon: '🐙📦',
      },
      sourceType: 'GitHub Repositories',
    };

    return {
      success: true,
      data: enrichedBundle,
      metadata: {
        operation: 'get_github_context_bundle',
        timestamp: new Date().toISOString(),
        source: 'github_repos',
        dataType: 'repository',
      },
    };
  } catch (error) {
    logger.error('❌ GitHub context bundle request failed', { error, query: args.query });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting GitHub context bundle',
      metadata: {
        operation: 'get_github_context_bundle',
        timestamp: new Date().toISOString(),
        source: 'github_repos',
      },
    };
  }
}

/**
 * Get structured context bundle from your uploaded local projects
 */
export async function handleGetUploadedContextBundle(args: {
  query: string;
  hints?: string[];
  token_budget?: number;
  local_project_id?: string;
}): Promise<CloudToolResponse> {
  try {
    logger.info('📁📦 Getting uploaded project context bundle', {
      query: args.query,
      projectId: args.local_project_id,
    });

    // Beta Limitation: Context bundle for uploaded projects not yet implemented
    // This feature is planned for post-beta releases
    logger.info(
      '📁 Context bundle for uploaded projects requested but not yet implemented in beta'
    );
    const bundle = {
      snippets: [],
      budget: {
        requested: args.token_budget || 4000,
        used: 0,
        remaining: args.token_budget || 4000,
      },
      metadata: {
        query: args.query,
        timestamp: new Date().toISOString(),
      },
      sourceInfo: {
        type: 'Uploaded Project Context Bundle',
        project: args.local_project_id || 'All uploaded projects',
        icon: '📁📦',
      },
      sourceType: 'Uploaded Local Projects',
    };

    return {
      success: true,
      data: bundle,
      metadata: {
        operation: 'get_uploaded_context_bundle',
        timestamp: new Date().toISOString(),
        source: 'uploaded_projects',
        dataType: 'uploaded_project',
      },
    };
  } catch (error) {
    logger.error('❌ Uploaded project context bundle request failed', { error, query: args.query });
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error getting uploaded project context bundle',
      metadata: {
        operation: 'get_uploaded_context_bundle',
        timestamp: new Date().toISOString(),
        source: 'uploaded_projects',
      },
    };
  }
}

/**
 * GITHUB CONTEXT HANDLER - Provides context from GitHub repositories only
 */
export async function handleGetUnifiedContext(args: {
  query: string;
  github_repo: string;
  branch?: string;
  hints?: string[];
  token_budget?: number;
}): Promise<CloudToolResponse> {
  try {
    // Validate required github_repo parameter
    if (!args.github_repo) {
      return {
        success: false,
        error:
          'github_repo parameter is required. Use ambiance_list_github_repos to see available repositories.',
        metadata: {
          operation: 'github_context',
          timestamp: new Date().toISOString(),
          source: 'github_repos',
        },
      };
    }

    // Route directly to GitHub repository context
    logger.info('🔍📦 Getting GitHub repository context', {
      query: args.query,
      repo: args.github_repo,
    });
    return await handleGetGithubContextBundle({
      query: args.query,
      hints: args.hints,
      token_budget: args.token_budget,
      github_repo: args.github_repo,
      branch: args.branch,
    });
  } catch (error) {
    logger.error('❌ GitHub context request failed', { error, query: args.query });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error in GitHub context handler',
      metadata: {
        operation: 'github_context',
        timestamp: new Date().toISOString(),
        source: 'github_repos',
      },
    };
  }
}

/**
 * GRAPH-BASED CONTEXT HANDLER - Get intelligent context using graph relationships
 */
export async function handleGetGraphContext(args: {
  query: string;
  github_repos?: string[];
  github_repo?: string;
  branch?: string;
  max_nodes?: number;
  max_tokens?: number;
  include_related_files?: boolean;
  focus_areas?: string[];
}): Promise<CloudToolResponse> {
  try {
    logger.info('🕸️📦 Getting graph-based context', {
      query: args.query,
      repos: args.github_repos || (args.github_repo ? [args.github_repo] : []),
      maxNodes: args.max_nodes,
      maxTokens: args.max_tokens,
    });

    // Validate that at least one repository is specified
    const repos = args.github_repos || (args.github_repo ? [args.github_repo] : []);
    if (repos.length === 0) {
      return {
        success: false,
        error:
          'At least one repository must be specified. Use github_repo or github_repos parameter.',
        metadata: {
          operation: 'graph_context',
          timestamp: new Date().toISOString(),
          source: 'github_repos',
        },
      };
    }

    // Call the graph context API
    const graphResponse = await apiClient.getGraphContext({
      query: args.query,
      github_repos: args.github_repos,
      github_repo: args.github_repo,
      branch: args.branch,
      max_nodes: args.max_nodes,
      max_tokens: args.max_tokens,
      include_related_files: args.include_related_files,
      focus_areas: args.focus_areas,
    });

    // Enrich the response with source information
    const enrichedResponse = {
      ...graphResponse,
      sourceInfo: {
        type: 'Graph-Based Context Bundle',
        repositories: repos,
        branch: args.branch || 'main',
        icon: '🕸️📦',
      },
      sourceType: 'GitHub Repositories (Graph-Based)',
    };

    return {
      success: true,
      data: enrichedResponse,
      metadata: {
        operation: 'graph_context',
        timestamp: new Date().toISOString(),
        source: 'github_repos',
        dataType: 'repository',
      },
    };
  } catch (error) {
    logger.error('❌ Graph context request failed', { error, query: args.query });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error in graph context handler',
      metadata: {
        operation: 'graph_context',
        timestamp: new Date().toISOString(),
        source: 'github_repos',
      },
    };
  }
}

// Removed handleSearchLocalContext function - local search is handled by local tools
// Cloud tools focus on GitHub repos and uploaded projects only

// Removed duplicate functions - they are now separate GitHub and uploaded project versions

// Export all handlers - GitHub-focused tools only
export const cloudToolHandlers = {
  ambiance_search_github_repos: handleSearchGithubRepos,
  ambiance_list_github_repos: handleListGithubRepos,
  ambiance_get_context: handleGetUnifiedContext, // GitHub repositories only
  ambiance_get_graph_context: handleGetGraphContext, // Graph-based context generation

  // Deprecated tools - kept for backward compatibility
  get_github_context: handleGetGithubContextBundle, // Deprecated - use ambiance_get_context
};

// Legacy aliases for backward compatibility
export const handleSearchContext = handleSearchGithubRepos;
export const handleGetContextBundle = handleGetGithubContextBundle;
export const handleListRepositories = handleListGithubRepos;

// GitHub-focused aliases
export const ambiance_get_github_context_bundle = handleGetGithubContextBundle;
