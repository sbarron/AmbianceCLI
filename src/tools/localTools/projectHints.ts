/**
 * @fileOverview: Local project hints tool for project navigation and analysis
 * @module: ProjectHints
 * @keyFunctions:
 *   - localProjectHintsTool: Tool definition for project hints generation
 *   - handleProjectHints(): Handler for project hints requests
 * @context: Provides intelligent project navigation hints with folder analysis and architecture detection
 */

export { handleProjectHints } from '../../runtime/hints/projectHints';

/**
 * Tool definition for local project hints generation
 */
export const localProjectHintsTool = {
  name: 'local_project_hints',
  description:
    '📊 Generate intelligent project navigation hints with word clouds, folder analysis, and architecture detection. Supports multiple output formats including markdown and HTML, with AI-powered analysis and configurable performance options. Accepts absolute paths or relative paths (when workspace can be detected).',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description:
          'Project directory path. Can be absolute (recommended) or relative to workspace. Examples: "C:\\Dev\\my-project", "/Users/username/project", or "." for current workspace.',
      },
      format: {
        type: 'string',
        enum: ['structured', 'compact', 'json', 'markdown', 'html'],
        default: 'compact',
        description:
          'Output format preference - structured for detailed analysis, compact for quick overview, json for raw data, markdown for documentation, html for visual reports',
      },
      maxFiles: {
        type: 'number',
        default: 100,
        minimum: 10,
        maximum: 200,
        description: 'Maximum number of files to analyze for performance',
      },
      folderPath: {
        type: 'string',
        description: 'Analyze specific folder instead of entire project (optional)',
      },
      includeContent: {
        type: 'boolean',
        default: false,
        description: 'Include file content analysis for deeper insights (may impact performance)',
      },
      useAI: {
        type: 'boolean',
        default: true,
        description:
          'Enable AI-powered folder analysis for better purpose detection (requires OpenAI API key)',
      },
      maxFileSizeForSymbols: {
        type: 'number',
        default: 50000,
        minimum: 10000,
        maximum: 200000,
        description: 'Maximum file size in bytes for symbol extraction (performance tuning)',
      },
    },
  },
};
