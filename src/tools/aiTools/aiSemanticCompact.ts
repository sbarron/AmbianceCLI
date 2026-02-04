/**
 * @fileOverview: AI-Enhanced Semantic Compaction Tool
 * @module: AISemanticCompact
 * @keyFunctions:
 *   - aiSemanticCompactTool: Tool definition with structured output formats
 *   - handleAISemanticCompact: Handler with AI-powered compression and analysis
 * @dependencies:
 *   - OpenAIService: Direct OpenAI API integration
 *   - SemanticCompactor: Local AST parsing and code compression
 * @context: Provides intelligent code analysis with 70-90% token reduction through AI understanding
 */

import {
  createOpenAIService,
  OpenAIService,
  ProviderType,
  PROVIDER_API_KEY_ENV,
  resolveProviderApiKey,
} from '../../core/openaiService';
import { SemanticCompactor } from '../../core/compactor/semanticCompactor';
import {
  enhancedSemanticCompactor,
  EnhancedSemanticCompactor,
} from '../../local/enhancedSemanticCompactor';
import { validateAndResolvePath } from '../utils/pathUtils';
import { logger } from '../../utils/logger';
import { formatAISemanticOutput } from './formatters/aiSemanticFormatters';
import { createAnalysisSystemPrompt, createAnalysisUserPrompt } from './prompts/analysisPrompts';
import { buildApiRequest } from './utils/tokenUtils';
import {
  validateEnhancedContext,
  validateContextItems,
  ContextItem,
  ValidationError,
} from '../../core/validation';
import { compileExcludePatterns, isExcludedPath } from '../utils/toolHelpers';
import { UNIVERSAL_NEGATIVES } from '../localTools/enhancedLocalContext';

// Global OpenAI service instance
let openaiService: OpenAIService | null = null;

/**
 * Initialize OpenAI service from environment variables
 */
function getOpenAIService(): OpenAIService {
  if (!openaiService) {
    // Determine provider from base URL or default to OpenAI
    const supportedProviders: ProviderType[] = [
      'openai',
      'qwen',
      'azure',
      'anthropic',
      'together',
      'openrouter',
      'grok',
      'groq',
      'custom',
    ];

    const explicitProvider = (process.env.OPENAI_PROVIDER?.toLowerCase() ?? '') as ProviderType;
    let provider: ProviderType = supportedProviders.includes(explicitProvider)
      ? explicitProvider
      : 'openai';

    const baseUrl = process.env.OPENAI_BASE_URL;

    if (
      (!process.env.OPENAI_PROVIDER || provider === 'custom' || provider === 'openai') &&
      baseUrl
    ) {
      const host = new URL(baseUrl).host.toLowerCase();
      if (host.includes('aliyuncs.com') || host.includes('qwen')) provider = 'qwen';
      else if (host.includes('anthropic.com')) provider = 'anthropic';
      else if (host.includes('together.xyz')) provider = 'together';
      else if (host.includes('openrouter.ai')) provider = 'openrouter';
      else if (host.includes('api.x.ai') || host.endsWith('.x.ai')) provider = 'grok';
      else if (host.includes('groq.com')) provider = 'groq';
      else if (host.includes('azure')) provider = 'azure';
    }

    const apiKey = resolveProviderApiKey(provider);
    if (!apiKey) {
      throw new Error(
        `No API key found for provider "${provider}". Please set one of: ${(
          PROVIDER_API_KEY_ENV[provider] || ['OPENAI_API_KEY']
        ).join(', ')}`
      );
    }

    openaiService = createOpenAIService({
      apiKey,
      provider,
      model: process.env.OPENAI_BASE_MODEL,
      miniModel: process.env.OPENAI_MINI_MODEL,
      embeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL,
      baseUrl: process.env.OPENAI_BASE_URL,
      organization: process.env.OPENAI_ORG_ID,
    });
  }
  return openaiService;
}

const PROVIDER_KEY_HINTS: Record<ProviderType, string[]> = {
  openai: ['OPENAI_API_KEY'],
  qwen: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'OPENAI_API_KEY'],
  azure: ['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
  together: ['TOGETHER_API_KEY', 'OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'],
  grok: ['XAI_API_KEY', 'GROK_API_KEY', 'OPENAI_API_KEY'],
  groq: ['GROQ_API_KEY', 'OPENAI_API_KEY'],
  custom: ['OPENAI_API_KEY'],
};

export const aiSemanticCompactTool = {
  name: 'ai_get_context',
  description: `🤖 AI-POWERED INTELLIGENT CONTEXT WITH STRUCTURED OUTPUT

Accepts absolute paths or relative paths (when workspace can be detected).

**When to use**:
- When you need intelligent project context with AI insights
- For getting actionable analysis and recommendations about your codebase
- When you need structured output (XML/Markdown) for documentation or processing
- When basic AST parsing isn't sufficient for understanding project architecture

**Output Formats**:
- **XML**: Machine-readable structured data with metadata
- **Markdown**: Documentation-ready format with sections and formatting
- **Structured**: Detailed analysis with organized sections
- **JSON**: Raw data for programmatic use

**Features**:
- 70-90% token reduction through intelligent code analysis
- Enhanced with local embedding similarity search (when USE_LOCAL_EMBEDDINGS=true)
- Context-aware explanations and actionable recommendations  
- Intelligent symbol relationship analysis
- Natural language summaries of complex code patterns
- Task-specific optimization (debug, implement, understand, refactor)
- Multiple structured output formats
- Persistent local embedding storage for improved relevance

**Performance**: 5-15 seconds depending on project size and OpenAI response time`,
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Project directory path. Can be absolute or relative to workspace.',
      },
      query: {
        type: 'string',
        description: 'Specific query or focus area for analysis',
        examples: [
          'authentication flow',
          'error handling patterns',
          'database connection logic',
          'React component architecture',
        ],
      },
      maxTokens: {
        type: 'number',
        default: 6000,
        minimum: 1000,
        maximum: 20000,
        description: 'Maximum tokens for compressed context',
      },
      taskType: {
        type: 'string',
        enum: ['debug', 'implement', 'understand', 'refactor', 'test', 'document'],
        default: 'understand',
        description: 'Task context for relevance scoring',
      },
      includeExplanations: {
        type: 'boolean',
        default: true,
        description: 'Include AI-generated explanations of code patterns',
      },
      focusFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific files to prioritize in analysis',
      },
      complexity: {
        type: 'string',
        enum: ['simple', 'detailed', 'comprehensive'],
        default: 'detailed',
        description: 'Level of analysis detail',
      },
      format: {
        type: 'string',
        enum: ['xml', 'markdown', 'structured', 'json'],
        default: 'structured',
        description:
          'Output format for results - xml for machine processing, markdown for documentation, structured for detailed analysis, json for raw data',
      },
      modelPreference: {
        type: 'string',
        enum: ['mini', 'base', 'auto'],
        default: 'auto',
        description:
          'Model preference: mini (faster/cheaper), base (more capable), auto (AI decides based on complexity)',
      },
      useEmbeddings: {
        type: 'boolean',
        default: true,
        description:
          'Use local embeddings for similarity search (requires USE_LOCAL_EMBEDDINGS=true and query)',
      },
      embeddingSimilarityThreshold: {
        type: 'number',
        default: 0.2,
        minimum: 0.0,
        maximum: 1.0,
        description:
          'Minimum similarity score (0.0-1.0) for including chunks. Lower values (0.15-0.2) cast a wider net for related code; higher values (0.25-0.35) return only close matches. Use lower thresholds when exploring unfamiliar code.',
      },
      maxSimilarChunks: {
        type: 'number',
        default: 10,
        minimum: 1,
        maximum: 50,
        description:
          'Maximum number of semantically similar code chunks to retrieve. Higher values (20-40) provide broader coverage for exploration; lower values (5-10) focus on highly relevant matches. Default 10 balances breadth with AI analysis cost.',
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional patterns to exclude from analysis (e.g., ["*.md", "docs/**", "*.test.js"])',
      },
      generateEmbeddingsIfMissing: {
        type: 'boolean',
        default: true,
        description: 'Generate embeddings if not found (uses OpenAI embeddings API)',
      },
    },
    required: ['projectPath'],
  },
};

/**
 * Extract individual chunks with similarity scores from enhanced context content
 */
function extractSimilarityChunks(content: string): any[] {
  const chunks: any[] = [];

  logger.debug('🔍 Extracting similarity chunks from content', {
    contentLength: content.length,
    contentPreview: content.substring(0, 200),
    hasXml: content.includes('<focused_context>'),
    hasStructured: content.includes('### ') && content.includes('% similar'),
    hasCompact: content.includes('FOCUSED RESULTS'),
  });

  // Parse XML format (structured output from enhanced compactor)
  if (content.includes('<focused_context>')) {
    const chunkRegex =
      /<relevant_chunk similarity="([^"]+)" file="([^"]+)" lines="([^"]*)">[\s\S]*?<content>([\s\S]*?)<\/content>[\s\S]*?<symbols>([\s\S]*?)<\/symbols>[\s\S]*?<\/relevant_chunk>/g;

    let match;
    while ((match = chunkRegex.exec(content)) !== null) {
      const [_, similarity, filePath, lines, content, symbols] = match;
      const [startLine, endLine] = lines.split('-').map(n => parseInt(n) || 0);

      chunks.push({
        path: filePath,
        language: getLanguageFromPath(filePath),
        summary: {
          purpose: `Embedding similarity: ${(parseFloat(similarity) * 100).toFixed(1)}%`,
          confidence: parseFloat(similarity),
          startLine,
          endLine,
        },
        content: content.trim(),
        symbols: symbols.trim()
          ? symbols
              .trim()
              .split(',')
              .map(s => s.trim())
          : [],
        dependencies: [],
        exports: [],
        nodes: [],
        type: 'embedding_chunk',
      });
    }
  }
  // Parse structured markdown format
  else if (content.includes('### ') && content.includes('% similar')) {
    const lines = content.split('\n');
    let currentChunk: any = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Look for chunk headers like "### 1. src\path\file.ts (45.4% similar)" or "### 1. file.js (85.2% similar)"
      // Match the entire line and extract path and similarity manually for better reliability
      const headerPattern = /^### \d+\.\s+(.+)\s+\(([0-9.]+)% similar\)$/;
      const headerMatch = line.match(headerPattern);
      if (headerMatch) {
        // Save previous chunk if exists
        if (currentChunk) {
          chunks.push(currentChunk);
        }

        // More robust path extraction: find the last occurrence of " (XX.X% similar)"
        const fullLine = line;
        const similarityPattern = /\s+\(([0-9.]+)% similar\)$/;
        const similarityMatch = fullLine.match(similarityPattern);

        if (similarityMatch) {
          // Extract file path by removing everything from "### N. " to " (XX.X% similar)"
          const prefixPattern = /^### \d+\.\s+/;
          const withoutPrefix = fullLine.replace(prefixPattern, '');
          const filePath = withoutPrefix.replace(similarityPattern, '').trim();
          const similarity = parseFloat(similarityMatch[1]) / 100;

          currentChunk = {
            path: filePath,
            language: getLanguageFromPath(filePath),
            summary: {
              purpose: `Embedding similarity: ${(similarity * 100).toFixed(1)}%`,
              confidence: similarity,
            },
            content: '',
            symbols: [],
            dependencies: [],
            exports: [],
            nodes: [],
            type: 'embedding_chunk',
          };

          // Look for symbols line
          if (i + 1 < lines.length && lines[i + 1].includes('**Symbols:**')) {
            const symbolsLine = lines[i + 1];
            const symbolsMatch = symbolsLine.match(/\*\*Symbols:\*\*\s*(.+)$/);
            if (symbolsMatch) {
              currentChunk.symbols = symbolsMatch[1].split(',').map(s => s.trim());
            }
            i++; // Skip the symbols line
          }

          // Look for code block start
          if (i + 1 < lines.length && lines[i + 1].includes('```')) {
            i++; // Skip the code block start
            let codeContent = '';
            while (i + 1 < lines.length && !lines[i + 1].includes('```')) {
              i++;
              codeContent += lines[i] + '\n';
            }
            currentChunk.content = codeContent.trim();
          }
        }
      }
    }

    // Add the last chunk
    if (currentChunk) {
      chunks.push(currentChunk);
    }
  }
  // Parse compact format
  else if (content.includes('FOCUSED RESULTS') && content.includes('%)\n')) {
    const chunkRegex = /(\d+)\.\s+([^:]+):(\d+)\s+\(([0-9]+)%\)\n([\s\S]*?)(?=\n---|\n\d+\.|$)/g;

    let match;
    while ((match = chunkRegex.exec(content)) !== null) {
      const [_, index, filePath, startLine, similarityPercent, chunkContent] = match;
      const similarity = parseInt(similarityPercent) / 100;

      chunks.push({
        path: filePath,
        language: getLanguageFromPath(filePath),
        summary: {
          purpose: `Embedding similarity: ${(similarity * 100).toFixed(1)}%`,
          confidence: similarity,
          startLine: parseInt(startLine),
        },
        content: chunkContent.trim(),
        symbols: [],
        dependencies: [],
        exports: [],
        nodes: [],
        type: 'embedding_chunk',
      });
    }
  }

  logger.info('🔍 Extracted similarity chunks', {
    totalChunks: chunks.length,
    format: content.includes('<focused_context>')
      ? 'xml'
      : content.includes('### ')
        ? 'structured'
        : 'compact',
    averageConfidence:
      chunks.length > 0
        ? (
            chunks.reduce((sum, chunk) => sum + (chunk.summary?.confidence || 0), 0) / chunks.length
          ).toFixed(3)
        : 0,
  });

  return chunks;
}

/**
 * Get language from file path (helper function)
 */
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    html: 'html',
    css: 'css',
    sql: 'sql',
  };

  return langMap[ext || ''] || 'text';
}

export async function handleAISemanticCompact(args: any): Promise<any> {
  const startTime = Date.now();
  let validatedProjectPath: string = args.projectPath || 'unknown';
  let progressTimer: NodeJS.Timeout | undefined;

  try {
    // Show progress indicator for long-running AI operation
    logger.info('🤖 Starting AI-powered context analysis (this may take 1-3 minutes)...', {
      projectPath: validatedProjectPath,
      note: 'AI tools typically take longer than local tools due to external API calls',
    });

    // Log intermediate progress for long operations
    progressTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed > 30000) {
        // Log every 30 seconds for operations > 30s
        logger.info(
          `⏳ AI context analysis still processing... (${Math.round(elapsed / 1000)}s elapsed)`,
          {
            projectPath: validatedProjectPath,
            note:
              elapsed > 300000
                ? 'This is taking unusually long. Consider checking network connectivity or reducing project scope.'
                : 'Normal processing time for AI analysis',
          }
        );
      }
    }, 30000);

    const {
      projectPath,
      query,
      maxTokens = 6000,
      taskType = 'understand',
      includeExplanations = true,
      focusFiles = [],
      complexity = 'detailed',
      format = 'structured',
      modelPreference = 'auto',
      useEmbeddings = true,
      embeddingSimilarityThreshold = 0.2,
      maxSimilarChunks = 10,
      excludePatterns = [],
      generateEmbeddingsIfMissing = true,
    } = args;

    const excludeRegexes = compileExcludePatterns([...UNIVERSAL_NEGATIVES, ...excludePatterns]);

    // Validate that projectPath is provided and is absolute
    if (!projectPath) {
      throw new Error(
        '❌ projectPath is required. Please provide an absolute path to the project directory.'
      );
    }
    validatedProjectPath = validateAndResolvePath(projectPath);

    logger.info('Starting AI-powered context analysis', {
      projectPath,
      query,
      maxTokens,
      taskType,
      complexity,
      format,
    });

    // Initialize services
    const openai = getOpenAIService();

    // Check if we should use enhanced compactor with embeddings
    let canUseEmbeddings =
      useEmbeddings && query && EnhancedSemanticCompactor.isEnhancedModeAvailable();

    let compactedProject: any;
    let embeddingStats: any = null;

    if (canUseEmbeddings) {
      logger.info('🚀 Using enhanced semantic compactor with embeddings', {
        query,
        threshold: embeddingSimilarityThreshold,
        maxChunks: maxSimilarChunks,
      });

      try {
        const enhancedResult = await enhancedSemanticCompactor.generateEnhancedContext({
          projectPath: validatedProjectPath,
          maxTokens,
          query,
          taskType,
          format: 'structured', // Always use structured for AI processing
          excludePatterns,
          useEmbeddings: true,
          embeddingSimilarityThreshold,
          maxSimilarChunks,
          generateEmbeddingsIfMissing,
        });

        // Safety check for enhanced result
        if (!enhancedResult || !enhancedResult.content) {
          logger.warn(
            '⚠️ Enhanced compactor returned empty result, falling back to standard compaction'
          );
          canUseEmbeddings = false;
        } else {
          // Validate enhanced context before proceeding
          try {
            logger.info('🔍 Validating enhanced context', {
              contentLength: enhancedResult.content?.length || 0,
              contentPreview: enhancedResult.content?.substring(0, 200) || 'empty',
              hasEmbeddings: enhancedResult.metadata?.embeddingsUsed,
              similarChunksFound: enhancedResult.metadata?.similarChunksFound,
              tokenCount: enhancedResult.metadata?.tokenCount,
            });

            // Skip validation if embeddings were used successfully (we'll validate later after chunk extraction)
            if (!enhancedResult.metadata?.embeddingsUsed) {
              validateEnhancedContext(enhancedResult.content, enhancedResult.metadata);
            } else {
              logger.debug(
                '⏭️ Skipping validation for embedding-based context (will validate extracted chunks)'
              );
            }

            logger.debug('✅ Enhanced context validation passed', {
              contentLength: enhancedResult.content?.length || 0,
              hasEmbeddings: enhancedResult.metadata?.embeddingsUsed,
            });
          } catch (validationError) {
            if (validationError instanceof ValidationError) {
              logger.warn('🚫 Enhanced context validation failed', {
                error: validationError.message,
                code: validationError.structured.code,
                context: validationError.structured.context,
                suggestion: validationError.structured.suggestion,
                contentLength: enhancedResult.content?.length || 0,
                contentPreview: enhancedResult.content?.substring(0, 100) || 'empty',
              });

              // Fall back to standard compaction instead of failing
              logger.info(
                '🔄 Falling back to standard semantic compaction due to validation failure'
              );
              canUseEmbeddings = false;
            } else {
              throw validationError;
            }
          }

          if (canUseEmbeddings) {
            // Extract individual chunks with their similarity scores from enhanced content
            const extractedChunks = extractSimilarityChunks(enhancedResult.content);

            logger.info('🔍 Chunk extraction results', {
              contentLength: enhancedResult.content.length,
              extractedChunksCount: extractedChunks.length,
              hasEmbeddingsUsed: enhancedResult.metadata?.embeddingsUsed,
              similarChunksFound: enhancedResult.metadata?.similarChunksFound,
            });

            // If we have real chunks from embeddings, use them
            if (extractedChunks.length > 0) {
              logger.info('✅ Using embedding chunks', {
                chunksCount: extractedChunks.length,
                averageConfidence:
                  extractedChunks.length > 0
                    ? (
                        extractedChunks.reduce(
                          (sum, chunk) => sum + (chunk.summary?.confidence || 0),
                          0
                        ) / extractedChunks.length
                      ).toFixed(3)
                    : 0,
              });

              // Convert enhanced result back to compactedProject format for AI processing
              compactedProject = {
                compactedContent: enhancedResult.content,
                totalTokens: enhancedResult.metadata.tokenCount,
                compressionRatio: enhancedResult.metadata.compressionRatio,
                processingStats: {
                  totalFiles: enhancedResult.metadata.totalFiles,
                  filesProcessed: enhancedResult.metadata.includedFiles,
                },
                files: extractedChunks,
              };
            } else {
              // If no chunks were extracted, fall back to standard compaction
              logger.warn(
                '⚠️ No embedding chunks extracted, falling back to standard semantic compaction',
                {
                  contentLength: enhancedResult.content.length,
                  contentPreview: enhancedResult.content.substring(0, 200),
                  embeddingsUsed: enhancedResult.metadata?.embeddingsUsed,
                }
              );
              canUseEmbeddings = false;
            }
          }

          embeddingStats =
            enhancedResult && enhancedResult.metadata && enhancedResult.metadata.embeddingsUsed
              ? {
                  embeddingsUsed: true,
                  similarChunksFound: enhancedResult.metadata.similarChunksFound,
                  embeddingStats: enhancedResult.metadata.embeddingStats,
                }
              : null;
        }
      } catch (error) {
        logger.error('❌ Error during enhanced compaction, falling back to standard compaction', {
          error: error instanceof Error ? error.message : String(error),
        });
        canUseEmbeddings = false;
      }
    }

    // If we didn't use embeddings or embeddings failed, use standard compaction
    if (!compactedProject) {
      logger.info('📝 Using standard semantic compaction', {
        reason: !canUseEmbeddings
          ? 'Enhanced mode not available or not requested'
          : 'Enhanced mode failed',
      });

      // Handle exclude patterns for fallback compactor
      let analysisPath = validatedProjectPath;
      let cleanupTempDir: (() => Promise<void>) | null = null;

      if (excludeRegexes.length > 0) {
        const fs = require('fs').promises;
        const path = require('path');
        const os = require('os');
        const { FileDiscovery } = await import('../../core/compactor/fileDiscovery.js');

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-context-fallback-'));
        logger.info('📁 Creating temporary directory for AI context exclude pattern filtering', {
          tempDir,
        });

        try {
          const fileDiscovery = new FileDiscovery(validatedProjectPath, {
            maxFileSize: 200000,
          });

          let allFiles = await fileDiscovery.discoverFiles();

          allFiles = allFiles.filter(file => !isExcludedPath(file.relPath, excludeRegexes));

          logger.info('📊 Applied exclude patterns to AI context fallback', {
            filteredCount: allFiles.length,
            excludePatterns,
          });

          // Copy filtered files to temp directory
          for (const file of allFiles) {
            const sourcePath = file.absPath;
            const relativePath = path.relative(validatedProjectPath, sourcePath);
            const destPath = path.join(tempDir, relativePath);

            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await fs.copyFile(sourcePath, destPath);
          }

          analysisPath = tempDir;
          cleanupTempDir = async () => {
            try {
              await fs.rm(tempDir, { recursive: true, force: true });
              logger.debug('🧹 Cleaned up AI context temporary directory', { tempDir });
            } catch (error) {
              logger.warn('Failed to cleanup AI context temporary directory', { tempDir, error });
            }
          };
        } catch (error) {
          // Clean up temp directory on error
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch {}
          throw error;
        }
      }

      const compactor = new SemanticCompactor(analysisPath);
      compactedProject = await compactor.compact();

      // Clean up temporary directory if created
      if (cleanupTempDir) {
        try {
          await cleanupTempDir();
        } catch (cleanupError) {
          logger.warn('Failed to cleanup AI context temporary directory', { error: cleanupError });
        }
      }
    }

    logger.info('📊 SemanticCompactor results', {
      filesFound: compactedProject.files?.length || 0,
      totalSymbols: compactedProject.processingStats?.totalSymbols || 0,
      embeddingsUsed: !!embeddingStats,
      similarChunksFound: embeddingStats?.similarChunksFound || 0,
    });

    // When using enhanced embeddings, we have compacted content without traditional file structure
    if (!compactedProject) {
      logger.error('❌ compactedProject is undefined - this should never happen', {
        canUseEmbeddings,
        // Note: enhancedResult is only defined inside the try block, so we can't log it here
      });

      return {
        success: false,
        error: 'Internal error: Unable to generate project context',
        suggestion:
          'Check server logs for more details. This may be due to missing embeddings or project structure issues.',
        projectPath: validatedProjectPath,
        duration: Date.now() - startTime,
      };
    }

    if (
      !compactedProject.compactedContent &&
      (!compactedProject.files || compactedProject.files.length === 0)
    ) {
      return {
        success: false,
        error: 'No supported files found in project',
        projectPath: validatedProjectPath,
        duration: Date.now() - startTime,
      };
    }

    // Filter and focus on relevant files if specified
    let relevantFiles = compactedProject.files || [];
    if (focusFiles.length > 0 && relevantFiles.length > 0) {
      logger.info('🔍 Filtering files based on focusFiles', {
        totalFiles: relevantFiles.length,
        focusFiles,
        availableFiles: relevantFiles.slice(0, 10).map((f: any) => f.path),
      });

      relevantFiles = relevantFiles.filter((file: any) => {
        const matched = focusFiles.some((focus: string) => {
          // Try both direct includes and normalized path matching
          const normalizedFocus = focus.replace(/[\/\\]/g, '/');
          const normalizedFilePath = file.path.replace(/[\/\\]/g, '/');

          return (
            normalizedFilePath.includes(normalizedFocus) ||
            normalizedFilePath.endsWith(normalizedFocus) ||
            file.path.includes(focus)
          );
        });

        if (matched) {
          logger.debug('✅ File matched focus filter', {
            filePath: file.path,
            matchedBy: focusFiles.find(
              (f: string) => file.path.includes(f) || file.path.includes(f.replace(/[\/\\]/g, '/'))
            ),
          });
        }

        return matched;
      });

      logger.info('📁 File filtering results', {
        originalCount: (compactedProject.files || []).length,
        filteredCount: relevantFiles.length,
        matchedFiles: relevantFiles.map((f: any) => f.path),
      });

      // If focusFiles didn't match anything, fall back to all files to avoid empty context
      if (relevantFiles.length === 0) {
        logger.warn(
          '⚠️ No files matched focusFiles, falling back to all files to avoid empty context',
          {
            focusFiles,
            totalAvailableFiles: (compactedProject.files || []).length,
          }
        );
        relevantFiles = compactedProject.files || [];
      }
    }

    // Build context for AI analysis
    const contextBuilder = [];
    let currentTokens = 0;
    const maxContextTokens = Math.floor(maxTokens * 0.7); // Reserve tokens for AI response

    logger.info('🧠 Building AI context', {
      hasEnhancedContent: !!compactedProject.compactedContent,
      relevantFilesCount: relevantFiles.length,
      maxContextTokens,
      maxTokens,
    });

    // If we have enhanced compacted content (from embeddings), extract individual chunks with confidence
    if (compactedProject.compactedContent && embeddingStats) {
      logger.info('🎯 Using enhanced embedding-based context with extracted chunks', {
        contentLength: compactedProject.compactedContent.length,
        embeddingsUsed: embeddingStats.embeddingsUsed,
        similarChunks: embeddingStats.similarChunksFound,
      });

      // Extract individual chunks with their confidence ratings
      const extractedChunks = extractSimilarityChunks(compactedProject.compactedContent);

      if (extractedChunks.length > 0) {
        // Add each chunk as a separate context item with confidence
        for (const chunk of extractedChunks) {
          if (currentTokens >= maxContextTokens) {
            logger.info('⚠️ Reached token limit, stopping chunk addition', {
              currentTokens,
              maxContextTokens,
              chunksAdded: contextBuilder.length,
            });
            break;
          }

          const chunkTokens = Math.ceil((chunk.content?.length || 0) / 4);
          if (currentTokens + chunkTokens <= maxContextTokens) {
            contextBuilder.push(chunk);
            currentTokens += chunkTokens;

            logger.debug('📄 Added embedding chunk to context', {
              path: chunk.path,
              confidence: chunk.summary?.confidence,
              tokenEstimate: chunkTokens,
              totalTokens: currentTokens,
            });
          }
        }

        logger.info('✅ Enhanced chunks added with confidence ratings', {
          chunksAdded: extractedChunks.length,
          totalTokens: currentTokens,
          tokenBudgetUsed: `${Math.round((currentTokens / maxContextTokens) * 100)}%`,
          averageConfidence:
            extractedChunks.length > 0
              ? (
                  extractedChunks.reduce(
                    (sum, chunk) => sum + (chunk.summary?.confidence || 0),
                    0
                  ) / extractedChunks.length
                ).toFixed(3)
              : 0,
        });
      } else {
        // Fallback to single enhanced context if extraction fails
        logger.warn('⚠️ Chunk extraction failed, using single enhanced context', {
          contentLength: compactedProject.compactedContent.length,
        });

        const enhancedContext = {
          type: 'enhanced_embedding_context',
          path: 'embedding_similarity_search',
          content: compactedProject.compactedContent,
          metadata: {
            source: 'embedding_similarity_search',
            query: query || 'General analysis',
            similarChunksFound: embeddingStats.similarChunksFound,
            embeddingsUsed: embeddingStats.embeddingsUsed,
          },
          language: 'markdown',
          purpose: 'Enhanced embedding-based context',
          symbols: [],
          exports: [],
        };

        currentTokens = Math.ceil(compactedProject.compactedContent.length / 4);
        contextBuilder.push(enhancedContext);
      }
    } else {
      // Fall back to traditional file-by-file processing
      logger.info('📁 Using traditional file-based context building', {
        relevantFilesCount: relevantFiles.length,
      });

      for (const file of relevantFiles) {
        if (currentTokens >= maxContextTokens) {
          logger.info('⚠️ Reached token limit, stopping context building', {
            currentTokens,
            maxContextTokens,
          });
          break;
        }

        const fileContext = {
          path: file.path,
          language: file.language,
          purpose: file.summary?.purpose || 'No purpose available',
          symbols:
            file.nodes?.slice(0, 10).map((node: any) => ({
              name: node.summary?.name || 'unnamed',
              type: node.type || 'unknown',
              signature: (node.signature || '').substring(0, 200),
              purpose: node.summary?.purpose || 'No purpose available',
            })) || [],
          dependencies: file.dependencies || [],
          exports: file.exports || [],
        };

        const fileTokenEstimate = Math.ceil(JSON.stringify(fileContext).length / 4);
        if (currentTokens + fileTokenEstimate <= maxContextTokens) {
          contextBuilder.push(fileContext);
          currentTokens = Math.floor(currentTokens + fileTokenEstimate);
          logger.debug('📄 Added file to context', {
            path: file.path,
            symbols: fileContext.symbols.length,
            tokenEstimate: fileTokenEstimate,
            totalTokens: currentTokens,
          });
        } else {
          logger.info('⚠️ File too large for remaining token budget', {
            path: file.path,
            fileTokenEstimate,
            remainingTokens: maxContextTokens - currentTokens,
          });
        }
      }

      logger.info('✅ Context building completed', {
        filesInContext: contextBuilder.length,
        totalTokensUsed: currentTokens,
        tokenBudgetUsed: `${Math.round((currentTokens / maxContextTokens) * 100)}%`,
      });
    }

    // Validate context before creating AI prompts
    try {
      // Convert contextBuilder to ContextItem format for validation
      const contextItems: ContextItem[] = contextBuilder.map((item: any) => {
        // Handle enhanced embedding context items
        if (item.type === 'enhanced_embedding_context') {
          return {
            path: item.metadata?.source || 'enhanced_context',
            language: 'markdown',
            content: item.content || '',
            symbols: [],
            exports: [],
            confidence: item.confidence || null,
            type: item.type,
          };
        }

        // Handle regular file context items
        const confidence = item.summary?.confidence
          ? `${(item.summary.confidence * 100).toFixed(1)}%`
          : null;
        return {
          path: item.path || 'unknown',
          language: item.language || 'unknown',
          content: typeof item === 'string' ? item : item.content || '',
          symbols: item.symbols || [],
          exports: item.exports || [],
          confidence: confidence,
          type: item.type,
        };
      });

      logger.info('🔍 Validating context items for AI call', {
        contextBuilderCount: contextBuilder.length,
        contextItemsCount: contextItems.length,
        contextItems: contextItems.map(item => ({
          path: item.path,
          contentLength: item.content?.length || 0,
          contentPreview: item.content?.substring(0, 100) || 'empty',
          symbolsCount: item.symbols?.length || 0,
          exportsCount: item.exports?.length || 0,
          // Show confidence rating if available (from embedding similarity)
          confidence:
            item.confidence ||
            (item.summary?.confidence ? `${(item.summary.confidence * 100).toFixed(1)}%` : null),
          embeddingChunk: item.type === 'embedding_chunk',
        })),
      });

      validateContextItems(contextItems);
      logger.debug('✅ Context items validation passed', {
        itemCount: contextItems.length,
        totalContentLength: contextItems.reduce(
          (sum, item) => sum + (item.content?.length || 0),
          0
        ),
      });
    } catch (validationError) {
      if (validationError instanceof ValidationError) {
        logger.warn('🚫 Context validation failed before AI call', {
          error: validationError.message,
          code: validationError.structured.code,
          context: validationError.structured.context,
          suggestion: validationError.structured.suggestion,
          contextBuilderCount: contextBuilder.length,
          contextItemsDetails: contextBuilder.map((item: any, index: number) => ({
            index,
            type: item.type || 'file',
            path: item.path || item.metadata?.source || 'unknown',
            contentLength: (item.content || item.compactedContent || '').length,
            contentPreview:
              (item.content || item.compactedContent || '').substring(0, 100) || 'empty',
          })),
        });

        return {
          success: false,
          error: `INSUFFICIENT_CONTEXT: ${validationError.message}`,
          suggestion: validationError.structured.suggestion,
          projectPath: validatedProjectPath,
          duration: Date.now() - startTime,
        };
      }
      throw validationError;
    }

    // Create AI prompt based on task type, complexity, and format
    const systemPrompt = createAnalysisSystemPrompt(
      taskType,
      complexity,
      includeExplanations,
      format
    );
    const userPrompt = createAnalysisUserPrompt(query, contextBuilder, taskType, format);

    // Calculate dynamic timeout based on context size and complexity
    const baseTimeoutMs = 30000; // 30 seconds base
    const tokenMultiplier = Math.max(1, Math.floor(currentTokens / 1000)); // +1 per 1000 tokens
    const complexityMultiplier =
      complexity === 'comprehensive' ? 3 : complexity === 'detailed' ? 2 : 1;
    const dynamicTimeoutMs = Math.min(
      300000,
      baseTimeoutMs * tokenMultiplier * complexityMultiplier
    ); // Max 5 minutes

    logger.info('⏱️ Calculated dynamic timeout for AI request', {
      baseTimeout: `${baseTimeoutMs / 1000}s`,
      tokenMultiplier,
      complexityMultiplier,
      finalTimeout: `${dynamicTimeoutMs / 1000}s`,
      reasoning: `${currentTokens} tokens × ${complexityMultiplier} complexity`,
    });

    // Intelligent model selection based on preference and complexity
    let selectedModel: string;
    if (modelPreference === 'mini') {
      selectedModel = openai.getModelForTask('mini');
    } else if (modelPreference === 'base') {
      selectedModel = openai.getModelForTask('base');
    } else {
      // 'auto' - let AI decide based on complexity
      // Use base model for comprehensive analysis or complex tasks
      const needsBaseModel =
        complexity === 'comprehensive' ||
        taskType === 'implement' ||
        taskType === 'refactor' ||
        query?.includes('complex') ||
        query?.includes('architecture') ||
        query?.includes('design');
      selectedModel = openai.getModelForTask(needsBaseModel ? 'base' : 'mini');
    }

    logger.info('🤖 Selected model for analysis', {
      preference: modelPreference,
      selectedModel,
      complexity,
      taskType,
      reasoning:
        modelPreference === 'auto' ? 'Auto-selected based on complexity' : 'User preference',
    });

    // Get AI analysis with progress tracking
    logger.info(
      '🧠 Sending request to AI model (this may take 1-3 minutes for large contexts)...',
      {
        model: selectedModel,
        estimatedTimeout: `${dynamicTimeoutMs / 1000}s`,
        contextTokens: currentTokens,
        maxResponseTokens: Math.min(4000, maxTokens - currentTokens),
      }
    );

    // Start progress timer for long AI requests
    const aiStartTime = Date.now();
    const aiProgressTimer = setInterval(() => {
      const aiElapsed = Date.now() - aiStartTime;
      if (aiElapsed > 15000) {
        // Log every 15 seconds for AI requests > 15s
        logger.info(
          `🤖 AI processing... (${Math.round(aiElapsed / 1000)}s elapsed, timeout in ${Math.round((dynamicTimeoutMs - aiElapsed) / 1000)}s)`,
          {
            model: selectedModel,
            contextSize: `${Math.round(currentTokens / 1000)}k tokens`,
          }
        );
      }
    }, 15000);

    let aiResponse;
    try {
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `AI request timed out after ${dynamicTimeoutMs / 1000}s. Large contexts require more time.`
            )
          );
        }, dynamicTimeoutMs);
      });

      // Calculate completion tokens and build API request
      const maxCompletionTokens = Math.floor(Math.min(4000, maxTokens - currentTokens));
      const apiRequest = buildApiRequest(
        selectedModel,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxCompletionTokens,
        0.3 // Lower temperature for more consistent analysis
      );

      logger.info('🔍 Context analysis API request details', {
        contextTokens: currentTokens,
        maxTotalTokens: maxTokens,
        completionTokens: maxCompletionTokens,
      });

      // Race between AI response and timeout
      aiResponse = (await Promise.race([
        openai.createChatCompletion(apiRequest),
        timeoutPromise,
      ])) as any;

      clearInterval(aiProgressTimer);
      logger.info('✅ AI analysis completed successfully', {
        duration: `${Math.round((Date.now() - aiStartTime) / 1000)}s`,
        model: selectedModel,
        tokensUsed: aiResponse.usage?.total_tokens || 0,
      });
    } catch (error) {
      clearInterval(aiProgressTimer);

      // Handle INSUFFICIENT_CONTEXT errors from OpenAI service validation
      if (error instanceof Error && error.message.includes('INSUFFICIENT_CONTEXT')) {
        logger.warn('🚫 OpenAI service blocked call due to insufficient context', {
          error: error.message,
          model: selectedModel,
          contextTokens: currentTokens,
        });

        return {
          success: false,
          error: 'Insufficient context for meaningful analysis',
          suggestion:
            'Try providing more specific files, expanding the search query, or using a different analysis approach',
          projectPath: validatedProjectPath,
          duration: Date.now() - startTime,
        };
      }

      throw error;
    }

    const aiAnalysis = aiResponse.choices[0]?.message?.content || 'No analysis generated';

    // Safety check - this should never happen with our improved error handling
    if (!compactedProject) {
      logger.error('❌ compactedProject is undefined when creating analysis data');
      return {
        success: false,
        error: 'Internal error: Project context lost during processing',
        projectPath: validatedProjectPath,
        duration: Date.now() - startTime,
      };
    }

    // Create comprehensive analysis data
    const analysisData = {
      projectPath: validatedProjectPath,
      query: query || 'General project analysis',
      taskType,
      complexity,
      format,
      analysis: aiAnalysis,
      localCompaction: {
        filesAnalyzed: compactedProject.files?.length || 0,
        totalSymbols: compactedProject.processingStats?.totalSymbols || 0,
        compressionRatio: compactedProject.compressionRatio,
        patterns: compactedProject.patterns || [],
        ...(embeddingStats || {}),
      },
      context: contextBuilder,
      metadata: {
        tokenUsage: {
          estimated: currentTokens,
          maxAllocated: maxTokens,
          aiResponse: aiResponse.usage?.total_tokens || 0,
        },
        processingTime: Date.now() - startTime,
        provider: openai.getProviderInfo().provider,
        model: openai.getProviderInfo().model,
      },
    };

    // Format output according to requested format
    const formattedOutput = formatAISemanticOutput(analysisData, format);

    const result = {
      success: true,
      output: formattedOutput,
      format,
      metadata: analysisData.metadata,
    };

    logger.info('AI-powered context analysis completed', {
      duration: result.metadata.processingTime,
      filesAnalyzed: analysisData.localCompaction.filesAnalyzed,
      compressionRatio: analysisData.localCompaction.compressionRatio,
      format: result.format,
    });

    clearInterval(progressTimer);
    return result;
  } catch (error) {
    logger.error('AI context analysis failed', { error: (error as Error).message });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      projectPath: validatedProjectPath || args.projectPath || 'unknown',
      duration: Date.now() - startTime,
      suggestion: 'Check OpenAI API key and ensure the project contains supported files',
    };
  } finally {
    // Ensure progress interval is always cleared, even on early returns
    if (progressTimer) {
      clearInterval(progressTimer);
    }
  }
}

// Export service management
export { getOpenAIService };

// Export cleanup function
export function cleanupOpenAIService(): void {
  if (openaiService) {
    openaiService.dispose();
    openaiService = null;
  }
}
