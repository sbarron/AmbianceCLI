/**
 * @fileOverview: Ambiance-specific tools for cloud service integration
 * @module: AmbianceTools
 * @keyFunctions:
 *   - setupProject: Auto-detect, index, and configure project
 *   - projectStatus: Check project health and configuration
 *   - remoteQuery: Direct cloud API query by projectId
 *   - indexing: Comprehensive project indexing with file watching
 * @dependencies:
 *   - Individual tool modules for focused functionality
 * @context: Provides Ambiance cloud service integration tools
 */

import { ambianceSetupProjectTool, handleSetupProject } from './setupProject';

import { ambianceProjectStatusTool, handleProjectStatus } from './projectStatus';

import { ambianceRemoteQueryTool, handleRemoteQuery } from './remoteQuery';

import {
  ambianceAutoDetectIndexTool,
  ambianceIndexProjectTool,
  ambianceResetIndexesTool,
  ambianceStartWatchingTool,
  ambianceStopWatchingTool,
  ambianceGetIndexingStatusTool,
  handleAutoDetectIndex,
  handleIndexProject,
  handleResetIndexes,
  handleStartWatching,
  handleStopWatching,
  handleGetIndexingStatus,
} from './indexing';

// Re-export individual items
export {
  ambianceSetupProjectTool,
  handleSetupProject,
  ambianceProjectStatusTool,
  handleProjectStatus,
  ambianceRemoteQueryTool,
  handleRemoteQuery,
  ambianceAutoDetectIndexTool,
  ambianceIndexProjectTool,
  ambianceResetIndexesTool,
  ambianceStartWatchingTool,
  ambianceStopWatchingTool,
  ambianceGetIndexingStatusTool,
  handleAutoDetectIndex,
  handleIndexProject,
  handleResetIndexes,
  handleStartWatching,
  handleStopWatching,
  handleGetIndexingStatus,
};

// Tool definitions array
export const ambianceTools = [
  ambianceSetupProjectTool,
  ambianceProjectStatusTool,
  ambianceRemoteQueryTool,
  ambianceAutoDetectIndexTool,
  ambianceIndexProjectTool,
  ambianceResetIndexesTool,
  ambianceStartWatchingTool,
  ambianceStopWatchingTool,
  ambianceGetIndexingStatusTool,
];

// Handler mapping
export const ambianceHandlers = {
  ambiance_setup_project: handleSetupProject,
  ambiance_project_status: handleProjectStatus,
  ambiance_remote_query: handleRemoteQuery,
  ambiance_auto_detect_index: handleAutoDetectIndex,
  ambiance_index_project: handleIndexProject,
  ambiance_reset_indexes: handleResetIndexes,
  ambiance_start_watching: handleStartWatching,
  ambiance_stop_watching: handleStopWatching,
  ambiance_get_indexing_status: handleGetIndexingStatus,
};
