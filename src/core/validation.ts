/**
 * @fileOverview: Schema validation for MCP tool inputs and outputs using Zod
 * @module: ValidationSchemas
 * @keyFunctions:
 *   - validateInput(): Validate tool input parameters against schemas
 *   - validateOutput(): Ensure tool outputs meet expected formats
 *   - createErrorResponse(): Generate standardized error responses
 *   - sanitizeInput(): Clean and normalize input data
 * @dependencies:
 *   - zod: Type-safe schema validation library
 *   - logger: Logging utilities for validation errors
 * @context: Provides type-safe validation for all MCP tool inputs and outputs, ensuring data integrity and preventing runtime errors
 */

import { z } from 'zod';
import { logger } from '../utils/logger';

/**
 * Schema validation for MCP tool inputs and outputs.
 */

// Common schemas
export const FileIdSchema = z.string().uuid('Invalid file ID format');

export const FileExtensionSchema = z
  .enum(['.ts', '.tsx', '.js', '.jsx', '.py', '.md', '.json', '.yaml', '.yml'])
  .describe('Supported file extension');

export const TaskTypeSchema = z
  .enum(['debug', 'implement', 'understand', 'refactor', 'test', 'document'])
  .optional()
  .describe('Type of task for relevance scoring');

// Tool input schemas
export const DiscoverFilesInputSchema = z
  .object({
    baseDir: z.string().min(1, 'Base directory is required').optional(),
    extensions: z.array(FileExtensionSchema).optional(),
    maxFiles: z.number().int().min(1).max(10000).optional(),
    maxSize: z
      .number()
      .int()
      .min(1024)
      .max(100 * 1024 * 1024)
      .optional(), // 1KB to 100MB
    ignorePatterns: z.array(z.string()).optional(),
    dryRun: z.boolean().optional(),
  })
  .describe('File discovery parameters');

export const ReadFileInputSchema = z
  .object({
    fileId: FileIdSchema,
    dryRun: z.boolean().optional(),
  })
  .describe('File reading parameters');

export const ParseASTInputSchema = z
  .object({
    fileId: FileIdSchema,
    language: z.enum(['typescript', 'javascript', 'python', 'markdown']).optional(),
    dryRun: z.boolean().optional(),
  })
  .describe('AST parsing parameters');

export const SummarizeFileInputSchema = z
  .object({
    fileId: FileIdSchema,
    taskType: TaskTypeSchema,
    includeImports: z.boolean().optional(),
    includeExports: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  })
  .describe('File summarization parameters');

export const SearchContextInputSchema = z
  .object({
    query: z.string().min(1, 'Search query is required'),
    taskType: TaskTypeSchema,
    k: z.number().int().min(1).max(50).optional(),
    extensions: z.array(FileExtensionSchema).optional(),
    dryRun: z.boolean().optional(),
  })
  .describe('Context search parameters');

export const ValidateRequestInputSchema = z
  .object({
    toolName: z.string().min(1),
    arguments: z.record(z.any()).default({}),
  })
  .describe('Request validation parameters');

// Tool output schemas
export const FileHandleSchema = z
  .object({
    fileId: FileIdSchema,
    absPath: z.string(),
    relPath: z.string(),
    ext: FileExtensionSchema,
    size: z.number().int().min(0),
    lastModified: z.string().datetime(),
    baseDir: z.string(),
  })
  .describe('Secure file handle');

export const DiscoveryReportSchema = z
  .object({
    candidatesFound: z.number().int().min(0),
    extensionFiltered: z.number().int().min(0),
    sizeFiltered: z.number().int().min(0),
    supported: z.number().int().min(0),
    ignored: z.number().int().min(0),
    duration: z.number().min(0),
  })
  .describe('File discovery report');

export const DiscoverFilesOutputSchema = z
  .object({
    handles: z.array(FileHandleSchema),
    report: DiscoveryReportSchema,
    dryRun: z.boolean().optional(),
  })
  .describe('File discovery results');

export const ReadFileOutputSchema = z
  .object({
    fileId: FileIdSchema,
    content: z.string(),
    encoding: z.string(),
    size: z.number().int().min(0),
    lines: z.number().int().min(0),
    dryRun: z.boolean().optional(),
  })
  .describe('File content');

export const ASTSymbolSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    isExported: z.boolean().optional(),
    isImported: z.boolean().optional(),
    documentation: z.string().optional(),
  })
  .describe('AST symbol information');

export const ParseASTOutputSchema = z
  .object({
    fileId: FileIdSchema,
    language: z.string(),
    symbols: z.array(ASTSymbolSchema),
    imports: z.array(z.string()),
    exports: z.array(z.string()),
    errors: z.array(z.string()),
    dryRun: z.boolean().optional(),
  })
  .describe('AST parsing results');

export const SummarizeFileOutputSchema = z
  .object({
    fileId: FileIdSchema,
    summary: z.string(),
    keySymbols: z.array(z.string()),
    purpose: z.string().optional(),
    dependencies: z.array(z.string()),
    complexity: z.enum(['low', 'medium', 'high']).optional(),
    dryRun: z.boolean().optional(),
  })
  .describe('File summary');

export const SearchContextOutputSchema = z
  .object({
    query: z.string(),
    results: z.array(
      z.object({
        fileId: FileIdSchema,
        relevanceScore: z.number().min(0).max(1),
        snippet: z.string(),
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1),
        symbolName: z.string().optional(),
        symbolType: z.string().optional(),
      })
    ),
    totalMatches: z.number().int().min(0),
    duration: z.number().min(0),
    dryRun: z.boolean().optional(),
  })
  .describe('Search results');

export const ValidationResultSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(
      z.object({
        field: z.string(),
        message: z.string(),
        code: z.string().optional(),
      })
    ),
    warnings: z.array(z.string()).optional(),
    suggestion: z.string().optional(),
  })
  .describe('Validation results');

// Error schema
export const StructuredErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    context: z.record(z.any()),
    suggestion: z.string().optional(),
    examples: z.record(z.any()).optional(),
  })
  .describe('Structured error response');

/**
 * Validation helper that provides structured error messages.
 */
export class ValidationHelper {
  static validateInput<T>(schema: z.ZodSchema<T>, data: unknown, toolName: string): T {
    try {
      return schema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Get the first error message for the main error message
        const firstError = error.errors[0];
        const primaryMessage = firstError?.message || `Invalid input for tool ${toolName}`;

        const structuredError = {
          code: 'SCHEMA_VALIDATION_FAILED',
          message: primaryMessage,
          context: {
            tool: toolName,
            errors: error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message,
              code: e.code,
              received: 'received' in e ? e.received : undefined,
            })),
          },
          suggestion: 'Check the tool schema and provide valid parameters',
          examples: ValidationHelper.getToolExamples(toolName),
        };

        logger.error(`Schema validation failed for ${toolName}`, structuredError.context);
        throw new ValidationError(structuredError);
      }

      // Handle non-ZodError errors (like transform errors) by wrapping them in ValidationError
      const wrappedError = {
        code: 'VALIDATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown validation error',
        context: {
          tool: toolName,
          originalError: error instanceof Error ? error.message : String(error),
        },
        suggestion: 'Check the input data and validation logic',
        examples: ValidationHelper.getToolExamples(toolName),
      };

      logger.error(`Validation failed for ${toolName}`, wrappedError.context);
      throw new ValidationError(wrappedError);
    }
  }

  static validateOutput<T>(schema: z.ZodSchema<T>, data: unknown, toolName: string): T {
    try {
      return schema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error(`Output validation failed for ${toolName}`, {
          errors: error.errors,
          data: JSON.stringify(data, null, 2).substring(0, 500) + '...',
        });

        // For output validation, we log but don't throw to avoid breaking the tool
        // Instead, return a sanitized version
        throw new ValidationError({
          code: 'OUTPUT_VALIDATION_FAILED',
          message: `Tool ${toolName} produced invalid output`,
          context: {
            tool: toolName,
            errors: error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message,
              code: e.code,
            })),
          },
          suggestion: 'This is an internal error. The tool output does not match its schema.',
        });
      }
      throw error;
    }
  }

  static getToolExamples(toolName: string): Record<string, any> {
    const examples: Record<string, any> = {
      discover_files: {
        good_call: { baseDir: 'src' },
        bad_call: { baseDir: '' },
      },
      read_file: {
        good_call: { fileId: '123e4567-e89b-12d3-a456-426614174000' },
        bad_call: { fileId: 'invalid-id' },
      },
      parse_ast: {
        good_call: {
          fileId: '123e4567-e89b-12d3-a456-426614174000',
          language: 'typescript',
        },
        bad_call: { fileId: 'not-a-uuid' },
      },
      search_context: {
        good_call: {
          query: 'authentication function',
          taskType: 'understand',
          k: 10,
        },
        bad_call: { query: '' },
      },
    };

    return examples[toolName] || {};
  }

  /**
   * Pre-flight validation for effectual tools.
   */
  static createDryRunResponse(toolName: string, input: any): any {
    const timestamp = new Date().toISOString();

    return {
      dryRun: true,
      tool: toolName,
      timestamp,
      plan: ValidationHelper.getExecutionPlan(toolName, input),
      invariants: ValidationHelper.getInvariants(toolName, input),
      estimatedDuration: ValidationHelper.getEstimatedDuration(toolName, input),
      resourceRequirements: ValidationHelper.getResourceRequirements(toolName, input),
    };
  }

  private static getExecutionPlan(toolName: string, input: any): string[] {
    const plans: Record<string, (input: any) => string[]> = {
      discover_files: input => [
        `Scan directory: ${input.baseDir}`,
        `Filter by extensions: ${input.extensions || 'default'}`,
        `Apply ignore patterns: ${input.ignorePatterns || 'default'}`,
        `Return secure file handles`,
      ],
      read_file: input => [
        `Validate file ID: ${input.fileId}`,
        `Check file exists and is readable`,
        `Read file content with encoding detection`,
        `Return content with metadata`,
      ],
      parse_ast: input => [
        `Validate file ID: ${input.fileId}`,
        `Detect or use language: ${input.language || 'auto-detect'}`,
        `Parse AST and extract symbols`,
        `Return structured symbol information`,
      ],
    };

    const planFn = plans[toolName];
    return planFn ? planFn(input) : [`Execute ${toolName} with provided input`];
  }

  private static getInvariants(toolName: string, input: any): { pre: string[]; post: string[] } {
    const invariants: Record<string, (input: any) => { pre: string[]; post: string[] }> = {
      discover_files: input => ({
        pre: [
          'Base directory must exist',
          'Extensions must be supported',
          'Ignore patterns must be valid regex',
        ],
        post: [
          'All returned handles have valid UUIDs',
          'All paths are within base directory',
          'Report counts sum correctly',
        ],
      }),
      read_file: input => ({
        pre: ['File ID must be valid UUID', 'File must exist in registry', 'File must be readable'],
        post: [
          'Content encoding matches detected encoding',
          'Line count matches actual content',
          'Size matches file system',
        ],
      }),
    };

    const invariantFn = invariants[toolName];
    return invariantFn ? invariantFn(input) : { pre: [], post: [] };
  }

  private static getEstimatedDuration(toolName: string, input: any): string {
    const estimates: Record<string, (input: any) => string> = {
      discover_files: input => (input.maxFiles > 1000 ? '2-5 seconds' : '< 1 second'),
      read_file: () => '< 100ms',
      parse_ast: () => '100-500ms',
      search_context: input => (input.k > 20 ? '1-3 seconds' : '< 1 second'),
    };

    const estimateFn = estimates[toolName];
    return estimateFn ? estimateFn(input) : 'Unknown';
  }

  private static getResourceRequirements(toolName: string, input: any): Record<string, string> {
    const requirements: Record<string, (input: any) => Record<string, string>> = {
      discover_files: input => ({
        memory: input.maxFiles > 1000 ? '50-100MB' : '< 10MB',
        disk: 'Read-only access to project directory',
        cpu: 'Low',
      }),
      parse_ast: () => ({
        memory: '10-50MB',
        disk: 'Read-only access to single file',
        cpu: 'Medium (AST parsing)',
      }),
    };

    const requirementFn = requirements[toolName];
    return requirementFn
      ? requirementFn(input)
      : { memory: 'Unknown', disk: 'Unknown', cpu: 'Unknown' };
  }
}

// Context validation utilities for AI/LLM calls
export interface AnalyzedFile {
  path: string;
  content?: string | null;
}

export interface ContextItem {
  path: string;
  language?: string;
  content?: string;
  symbols?: string[];
  exports?: string[];
  confidence?: string | null; // Confidence rating for embedding similarity (e.g., "85.2%")
  type?: string; // Type identifier (e.g., 'embedding_chunk', 'file')
  summary?: {
    purpose?: string;
    confidence?: number;
    startLine?: number;
    endLine?: number;
  }; // Additional metadata for context items
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

// Configuration for context validation
const CONTEXT_VALIDATION_CONFIG = {
  PLACEHOLDER_PATHS: new Set(['enhanced_context']), // Note: 'embedding_similarity_search' is NOT a placeholder, 'enhanced_context' is now allowed as fallback
  MIN_BYTES_PER_FILE: 64,
  MIN_DYNAMIC_TOKENS: 32,
  MIN_DYNAMIC_TOKEN_RATIO: 0.15,
  // Special handling for embedding contexts
  ENHANCED_CONTEXT_MIN_TOKENS: 16, // Lower threshold for enhanced contexts
  // Top-N result validation (more lenient than threshold-based)
  MIN_CONFIDENCE_FOR_TOP_RESULTS: 0.1, // Accept top results with >10% confidence
  MIN_TOP_RESULTS_COUNT: 1, // At least 1 result should be provided
};

/**
 * Cheap token approximation (~4 chars per token heuristic)
 */
function approxTokenCount(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

/**
 * Check if text has substantive content (not just placeholders/empty strings)
 */
function hasSubstantiveText(s?: string | null): boolean {
  if (!s) return false;
  const stripped = s.replace(/\s+/g, ' ').trim();
  // Reject common placeholder patterns
  if (
    !stripped ||
    /^\[\s*\]$/.test(stripped) ||
    /^\{\s*\}$/.test(stripped) ||
    /^n\/a$|^none$|^no(ne)? data$/i.test(stripped)
  ) {
    return false;
  }
  return approxTokenCount(stripped) >= CONTEXT_VALIDATION_CONFIG.MIN_DYNAMIC_TOKENS;
}

/**
 * Validate files for analysis to ensure they have actual content
 */
export function validateAnalyzeFolderInput(files: AnalyzedFile[]): void {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ValidationError({
      code: 'INSUFFICIENT_CONTEXT',
      message: 'No files provided for analysis',
      context: { filesCount: 0 },
      suggestion: 'Provide files with actual content for analysis',
    });
  }

  const hasAnyContent = files.some(
    f => f.content && f.content.length >= CONTEXT_VALIDATION_CONFIG.MIN_BYTES_PER_FILE
  );

  if (!hasAnyContent) {
    throw new ValidationError({
      code: 'INSUFFICIENT_CONTEXT',
      message: 'Files have no substantive content',
      context: {
        filesCount: files.length,
        filesWithContent: files.filter(f => f.content && f.content.length > 0).length,
        minBytesRequired: CONTEXT_VALIDATION_CONFIG.MIN_BYTES_PER_FILE,
      },
      suggestion: 'Provide files with actual content, not just file names or placeholders',
    });
  }
}

/**
 * Validate context items to ensure they contain real data
 * Uses top-N approach rather than strict confidence thresholds
 */
export function validateContextItems(items: ContextItem[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError({
      code: 'INSUFFICIENT_CONTEXT',
      message: 'No context items provided',
      context: { itemsCount: 0 },
      suggestion: 'Provide context items with actual content',
    });
  }

  // Use the improved top-N validation approach
  // Detect embedding-based results (have confidence ratings or are embedding chunks)
  const embeddingChunks = items.filter(
    i =>
      i.type === 'embedding_chunk' ||
      i.confidence !== null ||
      (i.summary?.confidence !== null && i.summary?.confidence !== undefined)
  );

  const hasEmbeddingResults = embeddingChunks.length > 0;

  if (hasEmbeddingResults) {
    // For embedding results, use top-N validation with lenient confidence threshold
    const validEmbeddingChunks = embeddingChunks.filter(i => {
      const confidence = i.summary?.confidence || parseConfidenceFromString(i.confidence || null);
      const hasMinConfidence =
        confidence === null ||
        confidence >= CONTEXT_VALIDATION_CONFIG.MIN_CONFIDENCE_FOR_TOP_RESULTS;
      const hasContent = i.content && i.content.length > 0;
      const hasSymbols = i.symbols && i.symbols.length > 0;
      const hasExports = i.exports && i.exports.length > 0;

      // Accept if has minimum confidence AND (any content/symbols/exports OR is a high-confidence embedding chunk)
      const isHighConfidenceChunk = hasMinConfidence && confidence !== null && confidence >= 0.2; // 30% confidence threshold
      return hasMinConfidence && (hasContent || hasSymbols || hasExports || isHighConfidenceChunk);
    });

    if (validEmbeddingChunks.length >= CONTEXT_VALIDATION_CONFIG.MIN_TOP_RESULTS_COUNT) {
      // We have valid top-N embedding results, accept them
      return;
    }

    // If embedding results are present but invalid, provide specific feedback
    if (embeddingChunks.length > 0 && validEmbeddingChunks.length === 0) {
      const hasEmbeddingContext = items.some(i => i.path === 'embedding_similarity_search');
      const suggestion = hasEmbeddingContext
        ? 'Embedding model compatibility issue. Use manage_embeddings in this order:\n1. manage_embeddings {"action": "status", "projectPath": "your_project_path"}\n2. If incompatible: manage_embeddings {"action": "migrate", "projectPath": "your_project_path", "force": true}\n3. Retry your original AI context query'
        : 'Embedding results found but insufficient quality. This may be due to:\n1. Very low confidence scores (<30%) - try different query terms\n2. Missing content in chunks - try increasing maxSimilarChunks\n3. Embedding model issues - check compatibility first';

      throw new ValidationError({
        code: 'INSUFFICIENT_CONTEXT',
        message: 'Embedding results have insufficient quality',
        context: {
          itemsCount: items.length,
          embeddingChunksFound: embeddingChunks.length,
          validEmbeddingChunks: validEmbeddingChunks.length,
          minConfidenceThreshold: CONTEXT_VALIDATION_CONFIG.MIN_CONFIDENCE_FOR_TOP_RESULTS,
          hasEmbeddingContext,
          chunkAnalysis: embeddingChunks.map(i => ({
            path: i.path,
            confidence: i.summary?.confidence || parseConfidenceFromString(i.confidence || null),
            contentLength: i.content?.length || 0,
            hasSymbols: (i.symbols?.length || 0) > 0,
            hasExports: (i.exports?.length || 0) > 0,
          })),
        },
        suggestion,
      });
    }
  }

  // Fall back to traditional validation for non-embedding contexts
  const nonPlaceholder = items.filter(
    i => !CONTEXT_VALIDATION_CONFIG.PLACEHOLDER_PATHS.has(i.path)
  );
  if (nonPlaceholder.length === 0) {
    throw new ValidationError({
      code: 'INSUFFICIENT_CONTEXT',
      message: 'Only placeholder context provided',
      context: {
        itemsCount: items.length,
        placeholderPaths: Array.from(CONTEXT_VALIDATION_CONFIG.PLACEHOLDER_PATHS),
      },
      suggestion:
        'Provide real context items instead of placeholders. Try using a different project path or check if the project has been indexed.',
    });
  }

  const hasReal = nonPlaceholder.some(i => {
    const isEmbeddingContext = i.path === 'embedding_similarity_search';
    const hasContent = i.content && i.content.length > 0;
    const hasSubstantiveContent =
      hasContent &&
      (isEmbeddingContext
        ? approxTokenCount(i.content!) >= CONTEXT_VALIDATION_CONFIG.ENHANCED_CONTEXT_MIN_TOKENS
        : hasSubstantiveText(i.content!));
    const hasSymbols = i.symbols && i.symbols.length > 0;
    const hasExports = i.exports && i.exports.length > 0;

    return hasSubstantiveContent || hasSymbols || hasExports;
  });

  if (!hasReal) {
    const analysis = nonPlaceholder.map(i => ({
      path: i.path,
      contentLength: i.content?.length || 0,
      tokenCount: i.content ? approxTokenCount(i.content) : 0,
      hasSubstantiveContent: i.content ? hasSubstantiveText(i.content) : false,
      symbolsCount: i.symbols?.length || 0,
      exportsCount: i.exports?.length || 0,
      isEmbeddingContext: i.path === 'embedding_similarity_search',
      contentPreview: i.content?.substring(0, 100) || 'empty',
    }));

    throw new ValidationError({
      code: 'INSUFFICIENT_CONTEXT',
      message: 'Context items lack substantive content',
      context: {
        itemsCount: items.length,
        nonPlaceholderCount: nonPlaceholder.length,
        analysis,
        itemsWithContent: analysis.filter(a => a.contentLength > 0).length,
        itemsWithSubstantiveContent: analysis.filter(a => a.hasSubstantiveContent).length,
        itemsWithSymbols: analysis.filter(a => a.symbolsCount > 0).length,
        itemsWithExports: analysis.filter(a => a.exportsCount > 0).length,
      },
      suggestion:
        'Expand context retrieval, try different query parameters, or provide files with actual content',
    });
  }
}

/**
 * Helper function to parse confidence from string format like "85.2%"
 */
function parseConfidenceFromString(confidence: string | null): number | null {
  if (!confidence) return null;
  const match = confidence.match(/([0-9.]+)%?/);
  if (match) {
    const value = parseFloat(match[1]);
    // If it's already a percentage (>1), convert to decimal
    return value > 1 ? value / 100 : value;
  }
  return null;
}

/**
 * Validate messages before sending to LLM to ensure dynamic content is meaningful
 */
export function validateDynamicSignal(messages: Message[]): void {
  const systemTokens = messages
    .filter(m => m.role === 'system')
    .reduce((n, m) => n + approxTokenCount(m.content), 0);

  const dynamicTokens = messages
    .filter(m => m.role !== 'system')
    .reduce((n, m) => n + approxTokenCount(m.content), 0);

  const totalTokens = systemTokens + dynamicTokens;

  // TEMP: Check if this is likely an embedding-based context by looking for confidence ratings
  const hasConfidenceContent = messages.some(
    m =>
      m.content.includes('% similar') ||
      m.content.includes('confidence') ||
      m.content.includes('embedding')
  );

  if (hasConfidenceContent) {
    // For embedding contexts, use much lower thresholds
    const embeddingMinTokens = 10; // Much lower threshold for embedding contexts
    if (dynamicTokens < embeddingMinTokens) {
      throw new ValidationError({
        code: 'INSUFFICIENT_CONTEXT',
        message: `Dynamic content too small for meaningful analysis (${dynamicTokens} tokens, need ${embeddingMinTokens})`,
        context: {
          systemTokens,
          dynamicTokens,
          totalTokens,
          minDynamicTokens: embeddingMinTokens,
          messagesCount: messages.length,
          embeddingContext: true,
        },
        suggestion: 'Add more context or use a different tool that requires less input',
      });
    }
    return; // Skip ratio check for embedding contexts
  }

  if (dynamicTokens < CONTEXT_VALIDATION_CONFIG.MIN_DYNAMIC_TOKENS) {
    throw new ValidationError({
      code: 'INSUFFICIENT_CONTEXT',
      message: 'Dynamic content too small for meaningful analysis',
      context: {
        systemTokens,
        dynamicTokens,
        totalTokens,
        minDynamicTokens: CONTEXT_VALIDATION_CONFIG.MIN_DYNAMIC_TOKENS,
        messagesCount: messages.length,
      },
      suggestion: 'Add more context or use a different tool that requires less input',
    });
  }

  if (
    totalTokens > 0 &&
    dynamicTokens / totalTokens < CONTEXT_VALIDATION_CONFIG.MIN_DYNAMIC_TOKEN_RATIO
  ) {
    throw new ValidationError({
      code: 'INSUFFICIENT_CONTEXT',
      message: 'Dynamic content ratio too low compared to boilerplate',
      context: {
        systemTokens,
        dynamicTokens,
        totalTokens,
        dynamicRatio: (dynamicTokens / totalTokens).toFixed(3),
        minRatio: CONTEXT_VALIDATION_CONFIG.MIN_DYNAMIC_TOKEN_RATIO,
      },
      suggestion: 'Context is mostly boilerplate. Add substantive content or use simpler analysis',
    });
  }
}

/**
 * Validate enhanced context to prevent placeholder-only content
 */
export function validateEnhancedContext(content: string, metadata?: any): void {
  // Use lenient validation for embedding contexts
  // Special handling for embedding-based contexts
  const isEmbeddingContext =
    metadata?.source === 'embedding_similarity_search' || metadata?.embeddingsUsed === true;

  const minTokens = isEmbeddingContext
    ? CONTEXT_VALIDATION_CONFIG.ENHANCED_CONTEXT_MIN_TOKENS
    : CONTEXT_VALIDATION_CONFIG.MIN_DYNAMIC_TOKENS;

  if (!content) {
    throw new ValidationError({
      code: 'INSUFFICIENT_CONTEXT',
      message: 'Enhanced context is empty',
      context: {
        contentLength: 0,
        metadata,
        isEmbeddingContext,
        minTokensRequired: minTokens,
      },
      suggestion:
        'No content was generated. Try different query parameters or check project structure',
    });
  }

  const tokenCount = approxTokenCount(content);
  if (tokenCount < minTokens) {
    throw new ValidationError({
      code: 'INSUFFICIENT_CONTEXT',
      message: `Enhanced context too short (${tokenCount} tokens, need ${minTokens})`,
      context: {
        contentLength: content.length,
        tokenCount,
        minTokensRequired: minTokens,
        metadata,
        isEmbeddingContext,
        contentPreview: content.substring(0, 200),
      },
      suggestion: `Content is too short for analysis. Try broader queries or increase maxSimilarChunks`,
    });
  }

  // For embedding contexts, be more lenient with placeholder detection
  if (!hasSubstantiveText(content)) {
    logger.warn('🚫 Enhanced context validation: no substantive content detected', {
      contentLength: content.length,
      tokenCount,
      isEmbeddingContext,
      contentPreview: content.substring(0, 200),
    });

    // Allow embedding contexts with minimal content to pass validation
    if (isEmbeddingContext) {
      logger.debug('✅ Allowing embedding context with minimal content to pass validation');
      return;
    }

    // For non-embedding contexts, still throw error
    throw new ValidationError({
      code: 'INSUFFICIENT_CONTEXT',
      message: 'Enhanced context contains no substantive content',
      context: {
        contentLength: content.length,
        tokenCount,
        metadata,
        isEmbeddingContext,
        contentPreview: content.substring(0, 200),
      },
      suggestion:
        'Enhanced context appears to be placeholder data. Try different retrieval parameters',
    });
  }
}

/**
 * Custom validation error class.
 */
export class ValidationError extends Error {
  public readonly structured: {
    code: string;
    message: string;
    context: Record<string, any>;
    suggestion?: string;
    examples?: Record<string, any>;
  };

  constructor(structured: {
    code: string;
    message: string;
    context: Record<string, any>;
    suggestion?: string;
    examples?: Record<string, any>;
  }) {
    super(structured.message);
    this.name = 'ValidationError';
    this.structured = structured;
  }
}
