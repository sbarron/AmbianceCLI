/**
 * @fileOverview: Local file summary tool for AST-based file analysis
 * @module: FileSummary
 * @keyFunctions:
 *   - localFileSummaryTool: Tool definition for file analysis
 *   - handleFileSummary(): Handler for file summary requests
 *   - getComprehensiveASTAnalysis(): Comprehensive AST analysis without filtering
 *   - extractAllFunctions(): Extract all functions from file
 *   - getLanguageFromPath(): Determine language from file extension
 * @context: Provides detailed file analysis with symbol extraction and complexity calculation
 */

export {
  handleFileSummary,
  getLanguageFromPath,
  extractAllFunctions,
  getComprehensiveASTAnalysis,
  extractReturnedSymbols,
  extractParametersFromSignature,
} from '../../runtime/summary/fileSummary';

/**
 * Tool definition for local file summary
 */
export const localFileSummaryTool = {
  name: 'local_file_summary',
  description:
    '📄 Get quick AST-based summary and key symbols for any file. Fast file analysis without external dependencies. Accepts absolute paths or relative paths (when workspace can be detected).',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description:
          'File path for analysis. Can be absolute (recommended) or relative to workspace. Examples: "C:\\Dev\\my-project\\src\\index.ts", "/Users/username/project/src/index.ts", or "src/index.ts".',
      },
      includeSymbols: {
        type: 'boolean',
        default: true,
        description: 'Include detailed symbol information',
      },
      maxSymbols: {
        type: 'number',
        default: 20,
        minimum: 5,
        maximum: 50,
        description: 'Maximum number of symbols to return',
      },
      format: {
        type: 'string',
        enum: ['xml', 'structured', 'compact'],
        default: 'structured',
        description: 'Output format preference',
      },
    },
    required: ['filePath'],
  },
};
