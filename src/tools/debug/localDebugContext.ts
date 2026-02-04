/**
 * @fileOverview: Local debug context gathering tool (combines former bugCrunch phase1 and phase2)
 * @module: LocalDebugContext
 * @keyFunctions:
 *   - localDebugContextTool: Tool definition for comprehensive error analysis
 *   - handleLocalDebugContext(): Handler for gathering and ranking debug context
 * @context: Provides complete debug context gathering with AST parsing, symbol matching, and relevance ranking
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { globby } from 'globby';
import { logger } from '../../utils/logger';
import { validateAndResolvePath } from '../utils/pathUtils';
import { LocalEmbeddingGenerator, GenerationOptions } from '../../local/embeddingGenerator';
import { LocalEmbeddingStorage, SimilarChunk } from '../../local/embeddingStorage';
import { ProjectIdentifier } from '../../local/projectIdentifier';

// Optional tree-sitter imports to avoid hard dependency at runtime
let Parser: any = null;
let TypeScriptLang: any = null;
let JavaScriptLang: any = null;
let PythonLang: any = null;

// Dynamic import for ESM-only tree-sitter packages
async function initializeTreeSitter() {
  try {
    if (!Parser) {
      Parser = await import('tree-sitter');
      Parser = Parser.default || Parser;
    }

    if (!TypeScriptLang) {
      const tsModule = await import('tree-sitter-typescript');
      TypeScriptLang = tsModule.default.typescript;
    }

    if (!JavaScriptLang) {
      const jsModule = await import('tree-sitter-javascript');
      JavaScriptLang = jsModule.default;
    }

    if (!PythonLang) {
      const pyModule = await import('tree-sitter-python');
      PythonLang = pyModule.default;
    }

    logger.info('✅ Tree-sitter parsers loaded successfully');
  } catch (error) {
    logger.warn('⚠️ Tree-sitter parsers not available, falling back to basic parsing', {
      error: error instanceof Error ? error.message : String(error),
    });
    // If tree-sitter isn't available, the module will still load with fallback parsing
  }
}

// Initialize embedding services
const embeddingGenerator = new LocalEmbeddingGenerator();
const embeddingStorage = new LocalEmbeddingStorage();
const projectIdentifier = new ProjectIdentifier();

export interface ParsedError {
  filePath: string;
  line: number;
  column?: number;
  symbol?: string;
  errorType?: string;
  raw: string;
  errorContext?: string; // Focused context for embedding queries
  startLine: number;
  endLine: number;
}

export interface SymbolInfo {
  name: string;
  type: string;
  startLine: number;
  endLine: number;
}

export interface SearchMatch {
  symbol: string;
  filePath: string;
  line: number;
  context: string;
  score: number;
  rank: number;
  reason: string;
  embeddingSimilarity?: number;
  isEmbeddingMatch?: boolean;
}

export interface DebugContextReport {
  errors: ParsedError[];
  matches: SearchMatch[];
  summary: {
    errorCount: number;
    matchCount: number;
    uniqueFiles: number;
    topMatches: Array<{
      symbol: string;
      filePath: string;
      score: number;
      reason: string;
    }>;
    embeddingsUsed?: boolean;
    similarChunksFound?: number;
    suggestions?: string[];
  };
}

/**
 * Tool definition for Local Debug Context gathering
 */
export const localDebugContextTool = {
  name: 'local_debug_context',
  description: `🐛 Gather comprehensive debug context from error logs and codebase analysis with focused embedding enhancement

**When to use**:
- When you have error logs, stack traces, or console output to analyze
- When debugging complex issues with multiple file involvement
- When you need to understand error context across the codebase
- Before using AI debugging tools to get structured context

**What this does**:
- Parses error logs to extract file paths, line numbers, symbols, and error types
- Extracts focused error contexts (~200 characters) for precise embedding queries
- Uses tree-sitter to build symbol indexes for TypeScript/JavaScript/Python files
- Searches codebase for symbol matches with surrounding context
- **ENHANCED**: Uses semantic embeddings with focused error contexts for better relevance
- Processes each error/warning separately for improved semantic matching
- Ranks matches by relevance (severity, recency, frequency, semantic similarity)
- Returns comprehensive debug report ready for AI analysis

**Input**: Error logs or stack traces as text
**Output**: Structured debug context report with ranked matches and semantic insights

**Performance**: Fast local analysis, ~1-3 seconds depending on codebase size
**Embedding Features**: Focused context queries reduce noise and improve relevance`,
  inputSchema: {
    type: 'object',
    properties: {
      logText: {
        type: 'string',
        description: 'Error logs, stack traces, or console output containing error information',
      },
      projectPath: {
        type: 'string',
        description:
          'Project root directory path. Required. Can be absolute or relative to workspace.',
      },
      maxMatches: {
        type: 'number',
        description: 'Maximum number of matches to return (default: 20)',
        default: 20,
        minimum: 1,
        maximum: 100,
      },
      format: {
        type: 'string',
        enum: ['structured', 'compact', 'detailed'],
        default: 'structured',
        description: 'Output format preference',
      },
      useEmbeddings: {
        type: 'boolean',
        default: true,
        description:
          'Enable embedding-based similarity search for enhanced context (requires local embeddings to be enabled)',
      },
      embeddingSimilarityThreshold: {
        type: 'number',
        default: 0.2,
        minimum: 0.0,
        maximum: 1.0,
        description:
          'Similarity threshold for embedding-based matches (lower = more results, higher = more precise)',
      },
      maxSimilarChunks: {
        type: 'number',
        default: 5,
        minimum: 1,
        maximum: 20,
        description: 'Maximum number of similar code chunks to include from embedding search',
      },
      generateEmbeddingsIfMissing: {
        type: 'boolean',
        default: false,
        description:
          "Generate embeddings for project files if they don't exist (may take time for large projects)",
      },
    },
    required: ['logText', 'projectPath'],
  },
};

/**
 * Parse terminal or log output to extract file paths, line numbers and error types.
 * Enhanced to extract focused error contexts (next 200 characters) for better embedding queries.
 */
function parseErrorLogs(logText: string): ParsedError[] {
  const errors: ParsedError[] = [];
  const lines = logText.split(/\r?\n/);
  let currentType: string | undefined;

  for (const line of lines) {
    const typeMatch = line.match(/^\s*([A-Za-z]*Error):/);
    if (typeMatch) {
      currentType = typeMatch[1];
    }

    // Node/JavaScript style stack traces
    const nodeMatch = line.match(/at (?:([^\s]+)\s+)?\(?(.+):(\d+):(\d+)\)?/);
    if (nodeMatch) {
      const errorContext = extractErrorContext(logText, lines.indexOf(line), 200);
      errors.push({
        filePath: nodeMatch[2],
        line: Number(nodeMatch[3]),
        column: Number(nodeMatch[4]),
        symbol: nodeMatch[1],
        errorType: currentType,
        raw: line,
        errorContext,
        startLine: Number(nodeMatch[3]),
        endLine: Number(nodeMatch[3]),
      });
      continue;
    }

    // Python style stack traces
    const pyMatch = line.match(/File "(.+)", line (\d+)(?:, in (.+))?/);
    if (pyMatch) {
      const errorContext = extractErrorContext(logText, lines.indexOf(line), 200);
      errors.push({
        filePath: pyMatch[1],
        line: Number(pyMatch[2]),
        symbol: pyMatch[3],
        errorType: currentType,
        raw: line,
        errorContext,
        startLine: Number(pyMatch[2]),
        endLine: Number(pyMatch[2]),
      });
    }
  }

  // Fallback: when no stack traces are found, extract keywords as symbols
  if (errors.length === 0) {
    const tokens = Array.from(
      new Set(logText.split(/[^A-Za-z0-9_]+/).filter(token => token.length > 2))
    );

    for (const token of tokens.slice(0, 5)) {
      const errorContext = extractErrorContext(logText, Math.floor(logText.indexOf(token) / 80), 200);
        errors.push({
          filePath: '',
        line: Math.floor(logText.indexOf(token) / 80) + 1,
          symbol: token,
          raw: token,
          errorContext,
        startLine: Math.floor(logText.indexOf(token) / 80) + 1,
        endLine: Math.floor(logText.indexOf(token) / 80) + 1,
        });
    }
  }

  return errors;
}

/**
 * Extract approximately 200 characters of context after an error line
 */
function extractErrorContext(
  logText: string,
  errorLineIndex: number,
  contextLength: number = 200
): string {
  const lines = logText.split(/\r?\n/);
  let context = '';

  // Start from the error line and collect subsequent lines
  for (let i = errorLineIndex; i < lines.length && context.length < contextLength; i++) {
    if (i === errorLineIndex) {
      // For the error line itself, include it
      context += lines[i] + ' ';
    } else {
      // For subsequent lines, add them until we reach the desired length
      const remainingLength = contextLength - context.length;
      if (remainingLength > 0) {
        context += lines[i].substring(0, remainingLength) + ' ';
      }
    }
  }

  return context.trim().substring(0, contextLength);
}

/**
 * Build an index of symbols in a file using tree-sitter.
 */
async function buildSymbolIndex(filePath: string): Promise<SymbolInfo[]> {
  // Initialize tree-sitter if not already done
  if (!Parser) {
    await initializeTreeSitter();
  }

  if (!Parser) return [];

  const ext = path.extname(filePath).toLowerCase();
  let language: any;

  switch (ext) {
    case '.ts':
    case '.tsx':
      language = TypeScriptLang;
      break;
    case '.js':
    case '.jsx':
      language = JavaScriptLang;
      break;
    case '.py':
      language = PythonLang;
      break;
    default:
      return [];
  }

  if (!language) return [];

  const parser = new Parser();
  try {
    parser.setLanguage(language);
  } catch {
    return [];
  }

  const source = await fs.readFile(filePath, 'utf8');
  const tree = parser.parse(source);
  const symbols: SymbolInfo[] = [];

  const visit = (node: any) => {
    const symbolTypes = [
      'function_declaration',
      'method_definition',
      'class_declaration',
      'class_definition',
      'function_definition',
    ];

    if (symbolTypes.includes(node.type)) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: node.type,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    }

    for (const child of node.children) visit(child);
  };

  visit(tree.rootNode);
  return symbols;
}

/**
 * Search for symbols or keywords within given files and return surrounding context.
 */
async function searchSymbols(
  symbols: string[],
  projectPath: string,
  fileHints: string[],
  maxMatches: number = 20
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  const files = Array.from(new Set(fileHints));

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf8');
      const lines = content.split(/\r?\n/);

      for (const symbol of symbols) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(symbol)) {
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length, i + 3);
            const context = lines.slice(start, end).join('\\n');
            matches.push({
              symbol,
              filePath: path.relative(projectPath, file),
              line: i + 1,
              context,
              score: 0, // Will be calculated later
              rank: 0, // Will be calculated later
              reason: '',
            });
          }
        }
      }
    } catch {
      // Ignore unreadable files
    }
  }

  return matches.slice(0, maxMatches);
}

/**
 * Calculate relevance score for a match based on severity, recency, frequency, and embedding similarity
 */
async function calculateScore(
  match: SearchMatch,
  errors: ParsedError[],
  projectPath: string,
  frequency: number
): Promise<{ score: number; reason: string }> {
  const SEVERITY_SCORES: Record<string, number> = {
    TypeError: 5,
    ReferenceError: 4,
    SyntaxError: 5,
    Error: 3,
  };

  let severity = 1;

  // Find related error for severity scoring
  const matchAbs = path.resolve(projectPath, match.filePath);
  const relatedError = errors.find(e => path.resolve(projectPath, e.filePath) === matchAbs);
  if (relatedError?.errorType) {
    severity = SEVERITY_SCORES[relatedError.errorType] ?? 2;
  }

  // Calculate recency score based on file modification time
  let recency = 1;
  try {
    const stat = await fs.stat(matchAbs);
    const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : stat.mtimeMs;
    const days = (Date.now() - mtime) / (1000 * 60 * 60 * 24);
    if (days < 7) recency = 4;
    else if (days < 30) recency = 3;
    else if (days < 90) recency = 2;
  } catch {
    // ignore stat errors
  }

  // Add embedding similarity bonus if available
  let embeddingBonus = 0;
  let embeddingReason = '';

  if (match.embeddingSimilarity !== undefined) {
    // Convert similarity (0-1) to a bonus score (0-10)
    embeddingBonus = Math.round(match.embeddingSimilarity * 10);
    embeddingReason = ` embedding:${embeddingBonus}`;
  }

  const score = severity + recency + frequency + embeddingBonus;
  const reason = `severity:${severity} recency:${recency} frequency:${frequency}${embeddingReason}`;
  return { score, reason };
}

/**
 * Ensure embeddings exist for the project
 */
async function ensureEmbeddingsForProject(
  projectId: string,
  projectPath: string,
  generateIfMissing: boolean = false
): Promise<boolean> {
  if (!LocalEmbeddingStorage.isEnabled()) {
    logger.debug('🔍 Local embeddings not enabled, skipping embedding generation');
    return false;
  }

  try {
    const stats = await embeddingStorage.getProjectStats(projectId);
    if (stats && stats.totalChunks > 0) {
      logger.debug('✅ Embeddings already exist for project', {
        projectId,
        totalChunks: stats.totalChunks,
      });
      return true;
    }

    if (!generateIfMissing) {
      logger.debug('📭 No embeddings found and generateIfMissing=false, skipping');
      return false;
    }

    logger.info('🔄 Generating embeddings for project', { projectId, projectPath });

    // Check if project path exists and has code files
    if (!fsSync.existsSync(projectPath)) {
      logger.warn('⚠️ Project path does not exist', { projectPath });
      return false;
    }

    // Generate embeddings using the project's file discovery
    const generationOptions: GenerationOptions = {
      maxChunkSize: 1000,
      overlapSize: 200,
      includeContext: true,
      preferSymbolBoundaries: true,
      batchSize: 10,
      rateLimit: 1000,
      filePatterns: ['**/*.{ts,tsx,js,jsx,py}'],
      force: false,
    };

    logger.info('🔄 Starting embedding generation for project', {
      projectId,
      projectPath,
      options: generationOptions,
    });

    const progress = await embeddingGenerator.generateProjectEmbeddings(
      projectId,
      projectPath,
      generationOptions
    );

    logger.info('✅ Embedding generation completed', {
      projectId,
      filesProcessed: progress.processedFiles,
      totalFiles: progress.totalFiles,
      embeddingsGenerated: progress.embeddings,
      errors: progress.errors.length,
    });
    return true;
  } catch (error) {
    logger.warn('⚠️ Failed to ensure embeddings', {
      error: error instanceof Error ? error.message : String(error),
      projectId,
    });
    return false;
  }
}

/**
 * Search for semantically similar code using embeddings with focused error contexts
 */
async function searchSemanticSimilarities(
  projectId: string,
  errors: ParsedError[],
  symbols: string[],
  maxSimilarChunks: number = 5,
  similarityThreshold: number = 0.2
): Promise<SearchMatch[]> {
  if (!LocalEmbeddingStorage.isEnabled()) {
    logger.debug('🔍 Local embeddings not enabled, skipping semantic search');
    return [];
  }

  const allSemanticMatches: SearchMatch[] = [];

  try {
    // Process each error with its focused context separately for better results
    for (let i = 0; i < errors.length && allSemanticMatches.length < maxSimilarChunks * 2; i++) {
      const error = errors[i];

      // Use the focused error context if available, otherwise fall back to the entire error
      const queryContext = error.errorContext || `${error.raw} ${symbols.join(' ')}`;

      if (queryContext.trim().length < 10) continue; // Skip very short contexts

      // Generate embedding for this specific error context
      const queryEmbedding = await embeddingGenerator.generateQueryEmbedding(queryContext);

      // Search for similar chunks for this specific error
      const similarChunks = await embeddingStorage.searchSimilarEmbeddings(
        projectId,
        queryEmbedding,
        Math.ceil(maxSimilarChunks / errors.length) + 1, // Distribute chunks across errors
        similarityThreshold
      );

      if (similarChunks.length === 0) continue;

      logger.debug('🎯 Found semantically similar code chunks for error', {
        errorIndex: i,
        errorType: error.errorType,
        contextLength: queryContext.length,
        chunksFound: similarChunks.length,
        topSimilarity: similarChunks[0]?.similarity,
      });

      // Convert SimilarChunk to SearchMatch format with enhanced metadata
      // Filter to exclude documentation files (.md, .txt, etc.) but allow all code files
      const semanticMatches: SearchMatch[] = similarChunks
        .filter(chunk => {
          const filePath = path.relative(process.cwd(), chunk.chunk.filePath);
          // Exclude documentation files that don't reflect current code state
          return !/\.(md|txt|rst|adoc|asciidoc)$/i.test(filePath);
        })
        .map((chunk, index) => {
          // Extract symbol from chunk content if possible
          const symbolMatch = chunk.chunk.content.match(/(?:function|class|const|let|var)\s+(\w+)/);
          const symbol = symbolMatch ? symbolMatch[1] : `semantic_match_${i}_${index + 1}`;

          return {
            symbol,
            filePath: path.relative(process.cwd(), chunk.chunk.filePath),
            line: chunk.chunk.metadata.startLine || 1,
            context: chunk.chunk.content,
            score: chunk.similarity * 100, // Convert to 0-100 scale for consistency
            rank: 0, // Will be set later
            reason: `semantic_similarity:${chunk.similarity.toFixed(3)} error_context:${error.errorType || 'unknown'}`,
            embeddingSimilarity: chunk.similarity,
            isEmbeddingMatch: true,
          };
        });

      allSemanticMatches.push(...semanticMatches);
    }

    // Sort all matches by similarity and limit results
    allSemanticMatches.sort((a, b) => (b.embeddingSimilarity || 0) - (a.embeddingSimilarity || 0));

    logger.info('🎯 Completed focused semantic search across all errors', {
      projectId,
      totalErrorsProcessed: errors.length,
      totalChunksFound: allSemanticMatches.length,
      topSimilarity: allSemanticMatches[0]?.embeddingSimilarity,
      similarityThreshold,
    });

    return allSemanticMatches.slice(0, maxSimilarChunks);
  } catch (error) {
    logger.warn('⚠️ Semantic similarity search failed', {
      error: error instanceof Error ? error.message : String(error),
      projectId,
    });
    return [];
  }
}

/**
 * Generate debugging suggestions based on matches and embedding results
 */
function generateDebugSuggestions(
  matches: SearchMatch[],
  errors: ParsedError[],
  embeddingsUsed: boolean,
  similarChunksFound: number
): string[] {
  const suggestions: string[] = [];

  // Basic suggestions based on error types
  const errorTypes = [...new Set(errors.map(e => e.errorType).filter(Boolean))];
  const hasTypeError = errorTypes.includes('TypeError');
  const hasReferenceError = errorTypes.includes('ReferenceError');
  const hasSyntaxError = errorTypes.includes('SyntaxError');

  if (hasTypeError) {
    suggestions.push('Check for null/undefined values before property access');
    suggestions.push('Verify type compatibility in assignments and function calls');
  }

  if (hasReferenceError) {
    suggestions.push('Check variable declarations and import statements');
    suggestions.push('Verify spelling of variable/function names');
  }

  if (hasSyntaxError) {
    suggestions.push('Check for missing semicolons, brackets, or quotes');
    suggestions.push('Verify syntax in recently modified files');
  }

  // Embedding-specific suggestions
  if (embeddingsUsed && similarChunksFound > 0) {
    suggestions.push('Review semantically similar code patterns found via embeddings');
    suggestions.push(
      'Consider if the error relates to similar functionality elsewhere in the codebase'
    );
  }

  // File diversity suggestions
  const uniqueFiles = new Set(matches.map(m => m.filePath));
  if (uniqueFiles.size > 5) {
    suggestions.push('Error spans multiple files - consider architectural issues');
  }

  // Recent file suggestions
  const recentMatches = matches.filter(m => {
    // This would be enhanced with actual file modification times
    return m.score > 50; // High-scoring matches are likely more relevant
  });

  if (recentMatches.length > 0) {
    suggestions.push('Focus on high-scoring matches as they may indicate recent changes');
  }

  return suggestions.slice(0, 5); // Limit to top 5 suggestions
}

/**
 * Main handler for local debug context gathering
 */
export async function handleLocalDebugContext(args: any): Promise<DebugContextReport> {
  const {
    logText,
    projectPath = process.cwd(),
    maxMatches = 20,
    format = 'structured',
    useEmbeddings = true,
    embeddingSimilarityThreshold = 0.2,
    maxSimilarChunks = 5,
    generateEmbeddingsIfMissing = false,
  } = args;

  if (!logText || typeof logText !== 'string') {
    throw new Error(
      '❌ logText is required and must be a string. Please provide error logs or stack traces.'
    );
  }

  const resolvedProjectPath = validateAndResolvePath(projectPath);

  logger.info('🐛 Starting local debug context gathering', {
    logLength: logText.length,
    projectPath: resolvedProjectPath,
    maxMatches,
    format,
    useEmbeddings,
    embeddingSimilarityThreshold,
    maxSimilarChunks,
    generateEmbeddingsIfMissing,
    embeddingsEnabled: LocalEmbeddingStorage.isEnabled(),
  });

  try {
    // Phase 1: Parse errors and gather context
    const errors = parseErrorLogs(logText);
    const symbols: string[] = [];
    const fileHints: string[] = [];
    let allFiles: string[] | null = null;

    for (const err of errors) {
      if (err.filePath) {
        const absPath = path.resolve(resolvedProjectPath, err.filePath);
        fileHints.push(absPath);

        if (!err.symbol) {
          const fileSymbols = await buildSymbolIndex(absPath);
          const match = fileSymbols.find(s => err.line >= s.startLine && err.line <= s.endLine);
          if (match) {
            err.symbol = match.name;
            symbols.push(match.name);
          }
        } else {
          symbols.push(err.symbol);
        }
      } else if (err.symbol) {
        symbols.push(err.symbol);
        if (!allFiles) {
          allFiles = await globby(['**/*.{ts,tsx,js,jsx,py}'], {
            cwd: resolvedProjectPath,
            absolute: true,
            ignore: ['node_modules/**', 'dist/**', '.git/**'],
          });
        }
      }
    }

    if (allFiles) {
      fileHints.push(...allFiles);
    }

    // Search for symbol matches
    const matches = await searchSymbols(symbols, resolvedProjectPath, fileHints, maxMatches);

    // Phase 1.5: Add embedding-enhanced search if enabled
    let allMatches = [...matches];
    let embeddingsUsed = false;
    let similarChunksFound = 0;

    if (useEmbeddings && LocalEmbeddingStorage.isEnabled() && symbols.length > 0) {
      try {
        // Get project identifier for embeddings
        const projectInfo = await projectIdentifier.identifyProject(resolvedProjectPath);
        const projectId = projectInfo.id;

        // Ensure embeddings exist
        const embeddingsReady = await ensureEmbeddingsForProject(
          projectId,
          resolvedProjectPath,
          generateEmbeddingsIfMissing
        );

        if (embeddingsReady) {
          // Search for semantically similar code using focused error contexts
          const semanticMatches = await searchSemanticSimilarities(
            projectId,
            errors,
            symbols,
            maxSimilarChunks,
            embeddingSimilarityThreshold
          );

          if (semanticMatches.length > 0) {
            allMatches = [...matches, ...semanticMatches];
            embeddingsUsed = true;
            similarChunksFound = semanticMatches.length;

            logger.info('🎯 Enhanced debug context with focused semantic matches', {
              originalMatches: matches.length,
              semanticMatches: semanticMatches.length,
              totalMatches: allMatches.length,
              errorsProcessed: errors.length,
              avgSimilarity:
                semanticMatches.reduce((sum, m) => sum + (m.embeddingSimilarity || 0), 0) /
                semanticMatches.length,
            });
          }
        }
      } catch (error) {
        logger.warn('⚠️ Embedding enhancement failed, continuing with standard matches', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Phase 2: Calculate scores and rank matches
    const freqMap = new Map<string, number>();
    for (const m of allMatches) {
      freqMap.set(m.symbol, (freqMap.get(m.symbol) || 0) + 1);
    }

    // Calculate scores for all matches
    for (const match of allMatches) {
      const frequency = freqMap.get(match.symbol) || 1;
      const { score, reason } = await calculateScore(match, errors, resolvedProjectPath, frequency);
      match.score = score;
      match.reason = reason;
    }

    // Sort by score and assign ranks
    allMatches.sort((a, b) => b.score - a.score);
    allMatches.forEach((m, i) => {
      m.rank = i + 1;
    });

    const uniqueFiles = [...new Set(allMatches.map(m => m.filePath))].length;
    const topMatches = allMatches.slice(0, 5).map(m => ({
      symbol: m.symbol,
      filePath: m.filePath,
      score: m.score,
      reason: m.reason,
    }));

    // Generate debugging suggestions
    const suggestions = generateDebugSuggestions(
      allMatches,
      errors,
      embeddingsUsed,
      similarChunksFound
    );

    const report: DebugContextReport = {
      errors,
      matches: allMatches,
      summary: {
        errorCount: errors.length,
        matchCount: allMatches.length,
        uniqueFiles,
        topMatches,
        embeddingsUsed,
        similarChunksFound,
        suggestions,
      },
    };

    logger.info('✅ Local debug context gathering completed', {
      errorCount: errors.length,
      matchCount: allMatches.length,
      uniqueFiles,
      topScore: allMatches[0]?.score || 0,
      embeddingsUsed,
      similarChunksFound,
    });

    return report;
  } catch (error) {
    logger.error('❌ Local debug context gathering failed', {
      error: (error as Error).message,
    });
    throw new Error(`Local debug context gathering failed: ${(error as Error).message}`);
  }
}
