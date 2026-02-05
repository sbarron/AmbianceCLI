/**
 * @fileOverview: manage_embeddings tool schema (adapter) + runtime re-exports
 */

import { SUPPORTED_ACTIONS } from '../../runtime/embeddings/manageEmbeddings';

export type {
  ManageEmbeddingsAction,
  ManageEmbeddingsRequest,
} from '../../runtime/embeddings/manageEmbeddings';
export { getCurrentModelConfiguration } from '../../runtime/embeddings';
export {
  handleManageEmbeddings,
  getEmbeddingStatus,
  runEmbeddingHealthCheck,
  createProjectEmbeddings,
  checkStaleFiles,
  validateProjectEmbeddings,
} from '../../runtime/embeddings/manageEmbeddings';

export const manageEmbeddingsTool = {
  name: 'manage_embeddings',
  description: `Coordinate embedding lifecycle and workspace configuration with a single entry point.

**Workspace Actions**
- get_workspace: Get current workspace folder and embedding status.
- set_workspace: Set workspace folder with validation and optional embedding generation (projectPath required).
- validate_workspace: Validate a workspace path without setting it (projectPath required).

**Embedding Actions**
- status: Inspect current/stored model configuration, stats, and recommendations (projectPath required).
- health_check: Run diagnostics with optional auto-fix for model mismatches (projectPath required).
- create: Generate or regenerate embeddings using the active model settings (projectPath required).
- update: Update embeddings for specific files or changed files (projectPath required, files optional).
- validate: Inspect stored embeddings for compatibility issues and integrity problems (projectPath required).
- check_stale: Identify files that need re-indexing by comparing disk vs database timestamps (projectPath required, autoUpdate optional).

**Project Management Actions**
- list_projects: Enumerate every project with stored embeddings.
- delete_project: Remove embeddings for a specific project (requires projectIdentifier and confirmDeletion=true).
- project_details: Deep dive into coverage, metadata, and compatibility for one project (requires projectIdentifier).

**Inputs**
- Set action to choose the workflow (defaults to get_workspace if no projectPath provided).
- Provide projectPath for workspace-level and embedding actions.
- Use projectIdentifier for project-specific lookups (delete_project, project_details).
- Optional: autoGenerate (for set_workspace), autoFix, batchSize, includeStats, maxFiles, excludePatterns, allowHiddenFolders.

**Outputs**
- Returns structured results for the selected action.`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...SUPPORTED_ACTIONS],
        description: 'Embedding management action to perform',
        default: 'status',
      },
      projectPath: {
        type: 'string',
        description:
          'Project root directory for workspace-level actions. Required for: validate_workspace, set_workspace, status, health_check, create, validate',
      },
      projectIdentifier: {
        type: 'string',
        description: 'Project ID, name, or path for project-level actions',
      },
      format: {
        type: 'string',
        enum: ['structured', 'compact', 'detailed'],
        description: 'Preferred output format for status action',
        default: 'structured',
      },
      autoFix: {
        type: 'boolean',
        description: 'Automatically attempt repairs during health_check',
        default: false,
      },
      maxFixTime: {
        type: 'number',
        minimum: 1,
        maximum: 60,
        description: 'Maximum minutes to spend on health_check auto-fixes',
        default: 15,
      },
      force: {
        type: 'boolean',
        description: 'Regenerate embeddings even when compatibility looks good',
        default: false,
      },
      batchSize: {
        type: 'number',
        minimum: 1,
        maximum: 50,
        description: 'Number of files to embed per batch during migration',
        default: 10,
      },
      includeStats: {
        type: 'boolean',
        description: 'Include statistics when validating embeddings',
        default: true,
      },
      checkIntegrity: {
        type: 'boolean',
        description: 'Perform deeper integrity checks during validation',
        default: false,
      },
      confirmDeletion: {
        type: 'boolean',
        description: 'Must be true to delete stored embeddings for a project',
        default: false,
      },
      maxFiles: {
        type: 'number',
        default: 5000,
        minimum: 100,
        maximum: 10000,
        description:
          'Maximum number of analyzable files allowed in workspace (for set_workspace/validate_workspace)',
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional glob patterns to exclude when counting files (for set_workspace/validate_workspace)',
        default: [],
      },
      allowHiddenFolders: {
        type: 'boolean',
        default: false,
        description:
          'Whether to include hidden folders (starting with .) in file counting (for set_workspace/validate_workspace)',
      },
      autoGenerate: {
        type: 'boolean',
        default: false,
        description:
          'Automatically generate embeddings after setting workspace (for set_workspace)',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific files to update embeddings for (for update action)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of files to return (for recent_files action)',
        default: 20,
        minimum: 1,
        maximum: 100,
      },
      autoUpdate: {
        type: 'boolean',
        description: 'Automatically update stale files (for check_stale action)',
        default: false,
      },
    },
    required: [],
  },
};
