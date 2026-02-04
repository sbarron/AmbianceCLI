/**
 * @fileOverview: Debug tools module exports
 * @module: DebugTools
 * @keyFunctions:
 *   - localDebugContextTool: Local debug context gathering tool
 *   - aiDebugTool: AI-powered debug analysis tool
 *   - Tool handlers and utilities
 * @context: Provides comprehensive debugging tools combining local context gathering with AI analysis
 */

// Tool definitions and handlers
export {
  localDebugContextTool,
  handleLocalDebugContext,
  type DebugContextReport,
  type ParsedError,
  type SymbolInfo,
  type SearchMatch,
} from './localDebugContext';

export { aiDebugTool, handleAIDebug } from './aiDebug';

// Import for convenience
import { localDebugContextTool, handleLocalDebugContext } from './localDebugContext';
import { aiDebugTool, handleAIDebug } from './aiDebug';

// Tool arrays for easy registration
export const debugTools = [localDebugContextTool, aiDebugTool];

// Handler object for easy registration
export const debugHandlers = {
  local_debug_context: handleLocalDebugContext,
  ai_debug: handleAIDebug,
};
