/**
 * @fileOverview: Core semantic compression engine that orchestrates the complete code analysis and compression pipeline
 * @module: SemanticCompactor
 * @keyFunctions:
 *   - compactProject(): Main entry point for complete project compression with 60-80% token reduction
 *   - compactFiles(): Process multiple files through the compression pipeline
 *   - compactFile(): Individual file compression with AST parsing and semantic analysis
 *   - generateCompactedContent(): Create final compressed output for LLM consumption
 *   - calculateCompressionStats(): Track compression ratios and processing statistics
 * @dependencies:
 *   - FileDiscovery: Intelligent file discovery and filtering
 *   - ASTParser: Multi-language AST parsing and symbol extraction
 *   - ASTPruner: AST compression and optimization
 *   - SemanticSummarizer: Symbol and file summarization
 *   - Deduplicator: Symbol deduplication across files
 *   - RelevanceScorer: Intelligent symbol ranking and filtering
 * @context: Orchestrates the complete semantic compression pipeline from file discovery through AST parsing, pruning, deduplication, and summarization to produce token-efficient code representations
 */

import { FileDiscovery, FileInfo, SupportedLanguage } from './fileDiscovery';
import { ASTParser, ParsedFile } from './astParser';
import { ASTPruner, PrunedFile, ASTProcessingOptions } from './astPruner';
import { access } from 'fs/promises';
import {
  SemanticSummarizer,
  SymbolSummary,
  FileSummary,
  ProjectSummary,
} from './semanticSummarizer';
import { Deduplicator, DeduplicationOptions, DeduplicationResult } from './deduplicator';
import { RelevanceScorer, RelevanceContext, FilteredResult } from './relevanceScorer';
import { logger } from '../../utils/logger';

/**
 * Custom error for when no supported files are found
 */
export class NoSupportedFilesError extends Error {
  constructor() {
    super('No supported files found in project');
  }
}

export interface CompactedNode {
  id: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'export' | 'import' | 'method';
  signature: string;
  docstring?: string;
  location: {
    file: string;
    line: number;
  };
  hash: string;
  references: string[];
  summary: SymbolSummary;
  relevanceScore?: number;
}

export interface CompactedFile {
  path: string;
  language: string;
  summary: FileSummary;
  nodes: CompactedNode[];
  dependencies: string[];
  exports: string[];
  tokenCount: number;
}

export interface CompactedProject {
  projectPath: string;
  summary: ProjectSummary;
  files: CompactedFile[];
  symbols: string[];
  patterns: string[];
  totalTokens: number;
  compressionRatio: number;
  processingStats: ProcessingStats;
  compactedContent: string;
}

export interface ProcessingStats {
  totalFiles: number;
  filesProcessed: number;
  filesSkipped: number;
  totalSymbols: number;
  symbolsAfterPruning: number;
  symbolsAfterDeduplication: number;
  duplicatesRemoved: number;
  processingTimeMs: number;
  errors: string[];
  totalTokens?: number;
}

export interface CompactionOptions {
  // File discovery options
  maxFileSize?: number;
  supportedLanguages?: SupportedLanguage[];

  // AST processing options
  astOptions?: Partial<ASTProcessingOptions>;

  // Deduplication options
  deduplicationOptions?: Partial<DeduplicationOptions>;

  // Output options
  includeSourceCode?: boolean;
  includeDocstrings?: boolean;
  maxTokensPerFile?: number;
  maxTotalTokens?: number;
  maxTokens?: number; // Added for compatibility

  // Quality options
  minSymbolImportance?: number;
  prioritizeExports?: boolean;

  // Performance options
  maxConcurrentFiles?: number;
  enableCaching?: boolean;
}

export class SemanticCompactor {
  private fileDiscovery: FileDiscovery;
  private astParser: ASTParser;
  private astPruner: ASTPruner;
  private summarizer: SemanticSummarizer;
  private deduplicator: Deduplicator;
  private relevanceScorer: RelevanceScorer;
  private options: CompactionOptions;

  constructor(projectPath: string, options: CompactionOptions = {}) {
    this.options = {
      maxFileSize: 100000,
      supportedLanguages: ['typescript', 'javascript', 'python'],
      includeSourceCode: false,
      includeDocstrings: true,
      maxTokensPerFile: 2000,
      maxTotalTokens: 20000,
      minSymbolImportance: 10,
      prioritizeExports: true,
      maxConcurrentFiles: 10,
      enableCaching: true,
      ...options,
    };

    this.fileDiscovery = new FileDiscovery(projectPath, {
      maxFileSize: this.options.maxFileSize,
      supportedExtensions: this.getSupportedExtensions(),
    });

    this.astParser = new ASTParser();
    this.astPruner = new ASTPruner(this.options.astOptions);
    this.summarizer = new SemanticSummarizer();
    this.deduplicator = new Deduplicator(this.options.deduplicationOptions);
    this.relevanceScorer = new RelevanceScorer();
  }

  /**
   * Dispose of all resources and clean up
   */
  dispose(): void {
    // Clean up AST parser resources
    if (this.astParser) {
      this.astParser.dispose();
    }

    // Clear any cached data
    if (this.deduplicator) {
      // Clear any internal caches if the deduplicator has them
      (this.deduplicator as any).clearCache?.();
    }

    if (this.relevanceScorer) {
      // Clear any internal caches if the relevance scorer has them
      (this.relevanceScorer as any).clearCache?.();
    }
  }

  /**
   * Main compaction process
   */
  async compact(relevanceContext?: RelevanceContext): Promise<CompactedProject> {
    const basePath = this.fileDiscovery['basePath'];
    logger.info('Starting semantic compaction process', { basePath });

    // Note: Removed invalid Windows path check - backslashes and colons are valid in Windows paths
    try {
      await access(basePath);
    } catch {
      logger.warn(`Compactor base path does not exist: ${basePath}`);
      throw new NoSupportedFilesError();
    }
    const startTime = Date.now();

    const stats: ProcessingStats = {
      totalFiles: 0,
      filesProcessed: 0,
      filesSkipped: 0,
      totalSymbols: 0,
      symbolsAfterPruning: 0,
      symbolsAfterDeduplication: 0,
      duplicatesRemoved: 0,
      processingTimeMs: 0,
      errors: [],
    };

    try {
      // Phase 1: Discover files
      logger.info('Phase 1: File discovery started', { basePath });
      let discoveredFiles;
      try {
        discoveredFiles = await this.fileDiscovery.discoverFiles();
      } catch (error) {
        // If directory doesn't exist or file discovery fails, treat as no supported files
        if (
          (error as Error).message.includes('does not exist') ||
          (error as Error).message.includes('not a directory')
        ) {
          throw new NoSupportedFilesError();
        }
        throw error;
      }

      stats.totalFiles = discoveredFiles.length;

      if (discoveredFiles.length === 0) {
        throw new NoSupportedFilesError();
      }

      // Phase 2: Parse files
      const fileInfos = discoveredFiles;
      logger.info('Phase 2: Parsing files', { fileCount: fileInfos.length });
      const parsedFiles = await this.parseFiles(discoveredFiles, stats);
      stats.totalSymbols = parsedFiles.reduce((sum, file) => sum + file.symbols.length, 0);

      // Phase 3: Prune ASTs
      logger.info('Phase 3: AST pruning started', { fileCount: parsedFiles.length });
      const prunedFiles = parsedFiles.map(file => this.astPruner.pruneFile(file));
      stats.symbolsAfterPruning = prunedFiles.reduce((sum, file) => sum + file.symbols.length, 0);

      // Phase 4: Deduplicate
      const allSymbols = prunedFiles.flatMap(file => file.symbols);
      logger.info('Phase 4: Symbol deduplication started', { symbolCount: allSymbols.length });
      const { files: deduplicatedFiles, result: deduplicationResult } =
        this.deduplicator.deduplicateFiles(prunedFiles);
      stats.symbolsAfterDeduplication = deduplicationResult.deduplicatedCount;
      stats.duplicatesRemoved = deduplicationResult.duplicatesFound;

      // Phase 5: Apply relevance filtering
      const deduplicated = { files: deduplicatedFiles, result: deduplicationResult };
      logger.info('Phase 5: Relevance filtering started', {
        symbolCount: deduplicated.files.flatMap(f => f.symbols).length,
      });
      let finalFiles = deduplicatedFiles;
      if (relevanceContext) {
        const filteredResult = this.relevanceScorer.scoreAndFilter(
          deduplicatedFiles,
          relevanceContext
        );
        finalFiles = this.applyFilteredResults(deduplicatedFiles, filteredResult);
      }

      // Phase 6: Generate summaries and create final output
      const filtered = { symbols: finalFiles.flatMap(f => f.symbols) };
      logger.info('Phase 6: Summary generation started', { symbolCount: filtered.symbols.length });
      const compactedFiles = await this.createCompactedFiles(finalFiles);
      const projectSummary = this.summarizer.summarizeProject(finalFiles);

      // Calculate final stats
      const totalTokens = compactedFiles.reduce((sum, file) => sum + file.tokenCount, 0);
      const compressionRatio =
        stats.totalSymbols > 0 ? stats.symbolsAfterDeduplication / stats.totalSymbols : 1;

      stats.processingTimeMs = Date.now() - startTime;

      const result: CompactedProject = {
        projectPath: this.fileDiscovery['basePath'],
        summary: projectSummary,
        files: compactedFiles,
        symbols: compactedFiles.flatMap(f => f.nodes.map(n => n.summary.name)),
        patterns: this.inferPatterns({
          projectPath: this.fileDiscovery['basePath'],
          summary: projectSummary,
          files: compactedFiles,
          symbols: [],
          patterns: [],
          totalTokens,
          compressionRatio,
          processingStats: stats,
          compactedContent: '',
        }),
        totalTokens,
        compressionRatio,
        processingStats: stats,
        compactedContent: this.generatePromptContext(
          {
            projectPath: this.fileDiscovery['basePath'],
            summary: projectSummary,
            files: compactedFiles,
            symbols: [],
            patterns: [],
            totalTokens,
            compressionRatio,
            processingStats: stats,
            compactedContent: '',
          },
          this.options.maxTokens || this.options.maxTotalTokens || 8000
        ),
      };

      logger.info('Semantic compaction completed successfully', {
        originalTokens: stats.totalSymbols,
        compactedTokens: totalTokens,
        compressionRatio,
        processingTimeMs: Date.now() - startTime,
      });
      this.logProcessingStats(stats);

      return result;
    } catch (error) {
      stats.errors.push(`Compaction failed: ${(error as Error).message}`);
      stats.processingTimeMs = Date.now() - startTime;
      throw error;
    } finally {
      this.deduplicator.cleanup();
    }
  }

  /**
   * Get summary for a specific file
   */
  async getSummary(filePath: string): Promise<CompactedNode[]> {
    try {
      const files = await this.fileDiscovery.discoverFiles();
      // 🔑 Use absolute path for matching, fallback to relative
      const targetFile = files.find(f => f.absPath === filePath || f.relPath === filePath);

      if (!targetFile) {
        const error = new Error(`File not found: ${filePath}`);
        error.name = 'FileNotFoundError';
        throw error;
      }

      // 🔑 Use absolute path directly - never rebuild from project root
      const parsedFile = await this.astParser.parseFile(
        targetFile.absPath,
        targetFile.language as SupportedLanguage
      );
      const prunedFile = this.astPruner.pruneFile(parsedFile);

      return this.createCompactedNodes(prunedFile);
    } catch (error) {
      // Handle specific error types appropriately
      if (error instanceof Error) {
        if (error.name === 'FileNotFoundError') {
          // This is an expected error when file doesn't exist - no need to log
          throw error;
        }

        // Log unexpected errors for debugging
        logger.error('Failed to get file summary', {
          filePath,
          error: error.message,
          stack: error.stack,
        });

        // Re-throw with additional context for debugging
        const enhancedError = new Error(`Failed to process file ${filePath}: ${error.message}`);
        enhancedError.name = 'FileProcessingError';
        // Store original error for debugging (ES2020 compatible)
        (enhancedError as any).originalError = error;
        throw enhancedError;
      }

      // Handle non-Error objects
      logger.error('Unexpected error during file processing', {
        filePath,
        error: String(error),
        errorType: typeof error,
      });
      throw error;
    }
  }

  /**
   * Get context for specific symbols
   */
  async getContextForSymbol(symbolId: string): Promise<CompactedNode[]> {
    try {
      const project = await this.compact();

      // Find the symbol
      const targetSymbol = project.files
        .flatMap(file => file.nodes)
        .find(node => node.id === symbolId);

      if (!targetSymbol) {
        const error = new Error(`Symbol not found: ${symbolId}`);
        error.name = 'SymbolNotFoundError';
        throw error;
      }

      // Get related symbols based on references
      const relatedNodes = project.files
        .flatMap(file => file.nodes)
        .filter(
          node =>
            node.references.includes(targetSymbol.id) ||
            targetSymbol.references.includes(node.id) ||
            node.location.file === targetSymbol.location.file
        );

      return [targetSymbol, ...relatedNodes];
    } catch (error) {
      // Handle specific error types appropriately
      if (error instanceof Error) {
        if (error.name === 'SymbolNotFoundError') {
          // This is an expected error when symbol doesn't exist - no need to log
          throw error;
        }

        // Log unexpected errors for debugging
        logger.error('Failed to get symbol context', {
          symbolId,
          error: error.message,
          stack: error.stack,
        });

        // Re-throw with additional context for debugging
        const enhancedError = new Error(
          `Failed to get context for symbol ${symbolId}: ${error.message}`
        );
        enhancedError.name = 'SymbolContextError';
        // Store original error for debugging (ES2020 compatible)
        (enhancedError as any).originalError = error;
        throw enhancedError;
      }

      // Handle non-Error objects
      logger.error('Unexpected error getting symbol context', {
        symbolId,
        error: String(error),
        errorType: typeof error,
      });
      throw error;
    }
  }

  /**
   * Parse files with error handling and concurrency control
   */
  private async parseFiles(files: FileInfo[], stats: ProcessingStats): Promise<ParsedFile[]> {
    const parsedFiles: ParsedFile[] = [];
    const maxConcurrent = this.options.maxConcurrentFiles || 10;

    for (let i = 0; i < files.length; i += maxConcurrent) {
      const batch = files.slice(i, i + maxConcurrent);

      const batchPromises = batch.map(async file => {
        try {
          const parsedFile = await this.astParser.parseFile(
            file.absPath,
            file.language as SupportedLanguage
          );
          stats.filesProcessed++;
          return parsedFile;
        } catch (error) {
          stats.filesSkipped++;
          stats.errors.push(`Failed to parse ${file.absPath}: ${(error as Error).message}`);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      parsedFiles.push(...(batchResults.filter(file => file !== null) as ParsedFile[]));
    }

    return parsedFiles;
  }

  /**
   * Apply filtered results back to the files
   */
  private applyFilteredResults(files: PrunedFile[], filteredResult: FilteredResult): PrunedFile[] {
    const keptSymbolIds = new Set(filteredResult.symbols.map(s => s.symbol.id));

    return files
      .map(file => ({
        ...file,
        symbols: file.symbols.filter(symbol => keptSymbolIds.has(symbol.id)),
      }))
      .filter(file => file.symbols.length > 0);
  }

  /**
   * Create compacted files from pruned files
   */
  private async createCompactedFiles(prunedFiles: PrunedFile[]): Promise<CompactedFile[]> {
    return prunedFiles.map(file => {
      const fileSummary = this.summarizer.summarizeFile(file);
      const nodes = this.createCompactedNodes(file);

      return {
        path: file.absPath, // 🔑 Use absolute path
        language: file.language,
        summary: fileSummary,
        nodes,
        dependencies: file.dependencies,
        exports: file.exports,
        tokenCount: file.tokenCount,
      };
    });
  }

  /**
   * Create compacted nodes from pruned symbols
   */
  private createCompactedNodes(prunedFile: PrunedFile): CompactedNode[] {
    return prunedFile.symbols.map(symbol => {
      const summary = this.summarizer.summarizeSymbol(symbol, prunedFile);

      return {
        id: symbol.id,
        type: symbol.type,
        signature: symbol.signature,
        docstring: this.options.includeDocstrings ? symbol.docstring : undefined,
        location: {
          file: prunedFile.absPath, // 🔑 Use absolute path from pruned file
          line: symbol.location.startLine,
        },
        hash: (symbol as any).contentHash || this.generateHash(symbol),
        references: symbol.relationships.map(r => r.target),
        summary,
        relevanceScore: symbol.importance,
      };
    });
  }

  /**
   * Generate hash for symbol if not already present
   */
  private generateHash(symbol: any): string {
    const content = `${symbol.type}:${symbol.signature}:${symbol.compactedBody || ''}`;
    return require('crypto').createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Get supported file extensions based on configured languages
   */
  private getSupportedExtensions(): string[] {
    const extensionMap: Record<SupportedLanguage, string[]> = {
      typescript: ['.ts', '.tsx'],
      javascript: ['.js', '.jsx', '.mjs', '.cjs'],
      python: ['.py'],
      go: ['.go'],
      rust: ['.rs'],
      java: ['.java'],
      cpp: ['.cpp', '.c', '.h', '.hpp'],
      markdown: ['.md'],
      json: ['.json', '.yaml', '.yml'],
      html: ['.html', '.htm'],
    };

    const supportedLanguages = this.options.supportedLanguages || ['typescript', 'javascript'];
    return supportedLanguages.flatMap(lang => extensionMap[lang] || []);
  }

  /**
   * Log processing statistics
   */
  private logProcessingStats(stats: ProcessingStats): void {
    logger.info('Processing statistics', {
      filesDiscovered: stats.totalFiles,
      filesProcessed: stats.filesProcessed,
      filesSkipped: stats.filesSkipped,
      totalSymbols: stats.totalSymbols,
      symbolsAfterPruning: stats.symbolsAfterPruning,
      symbolsAfterDeduplication: stats.symbolsAfterDeduplication,
      duplicatesRemoved: stats.duplicatesRemoved,
      processingTimeMs: stats.processingTimeMs,
      errorCount: stats.errors.length,
    });

    if (stats.errors.length > 0) {
      logger.warn('Processing errors encountered', {
        errorCount: stats.errors.length,
        firstFiveErrors: stats.errors.slice(0, 5),
        hasMoreErrors: stats.errors.length > 5,
      });
    }
  }

  /**
   * Export compacted project to JSON
   */
  exportToJSON(project: CompactedProject): string {
    return JSON.stringify(project, null, 2);
  }

  /**
   * Generate prompt context from compacted project
   */
  generatePromptContext(project: CompactedProject, maxTokens: number = 4000): string {
    const parts: string[] = [];
    let tokenCount = 0;

    // Add project summary
    parts.push(`# ${project.summary.architecture} Project`);
    parts.push(
      `Total: ${project.summary.totalFiles} files, ${project.summary.totalSymbols} symbols`
    );
    parts.push(`Key components: ${project.summary.mainComponents.join(', ')}`);
    parts.push('');

    // Add file summaries and top symbols
    for (const file of project.files) {
      if (tokenCount > maxTokens * 0.8) break;

      const fileHeader = `## ${file.path}\n${file.summary.purpose}`;
      parts.push(fileHeader);
      tokenCount += fileHeader.split(/\s+/).length;

      // Add top symbols from this file
      const topSymbols = file.nodes
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, 5);

      for (const symbol of topSymbols) {
        if (tokenCount > maxTokens) break;

        const symbolText = `### ${symbol.summary.name} (${symbol.type})\n${symbol.signature}`;
        if (symbol.docstring) {
          symbolText + `\n${symbol.docstring}`;
        }

        parts.push(symbolText);
        tokenCount += symbolText.split(/\s+/).length;
      }

      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Convenience method for context optimizer integration
   */
  async compactProject(
    projectPath: string,
    options: {
      maxTokens?: number;
      taskType?: string;
      includeTests?: boolean;
    }
  ): Promise<CompactedProject> {
    // Update project path in file discovery
    this.fileDiscovery = new FileDiscovery(projectPath);

    // Update options if provided
    if (options.maxTokens) {
      this.options.maxTokens = options.maxTokens;
    }

    // Create relevance context for task type
    const relevanceContext: RelevanceContext | undefined = options.taskType
      ? {
          query: `${options.taskType} task`,
          taskType: options.taskType as any,
          maxTokens: options.maxTokens || 8000,
        }
      : undefined;

    // Run the compaction
    const result = await this.compact(relevanceContext);

    // Add missing fields for compatibility
    return {
      ...result,
      symbols: result.files.flatMap(f => f.nodes.map(n => n.summary.name)),
      patterns: this.inferPatterns(result),
      compactedContent: this.generatePromptContext(result, options.maxTokens || 8000),
    };
  }

  /**
   * Infer common patterns from the project
   */
  private inferPatterns(project: CompactedProject): string[] {
    const patterns: string[] = [];

    // Check for common frameworks/libraries
    const allDependencies = project.files.flatMap(f => f.dependencies);

    if (allDependencies.some(d => d.includes('react'))) patterns.push('react');
    if (allDependencies.some(d => d.includes('express'))) patterns.push('express');
    if (allDependencies.some(d => d.includes('fastify'))) patterns.push('fastify');
    if (allDependencies.some(d => d.includes('vue'))) patterns.push('vue');
    if (allDependencies.some(d => d.includes('angular'))) patterns.push('angular');

    // Check for common patterns in code
    const allSignatures = project.files.flatMap(f => f.nodes.map(n => n.signature.toLowerCase()));

    if (allSignatures.some(s => s.includes('async') || s.includes('await'))) patterns.push('async');
    if (allSignatures.some(s => s.includes('test') || s.includes('describe')))
      patterns.push('testing');
    if (allSignatures.some(s => s.includes('api') || s.includes('endpoint'))) patterns.push('api');
    if (allSignatures.some(s => s.includes('component'))) patterns.push('component-based');

    return patterns;
  }

  // ===== Context Optimizer Integration Methods =====

  /**
   * Find symbol context with definition and documentation
   */
  async findSymbolContext(
    symbolName: string,
    projectPath: string
  ): Promise<{ definition: string; documentation: string }> {
    try {
      const compactedProject = await this.compactProject(projectPath, {
        maxTokens: 2000,
        taskType: 'understand',
        includeTests: false,
      });

      // Find the symbol across all files
      for (const file of compactedProject.files) {
        const symbol = file.nodes.find(
          node => node.signature.includes(symbolName) || node.summary.name === symbolName
        );

        if (symbol) {
          return {
            definition: symbol.signature,
            documentation: symbol.docstring || symbol.summary.purpose || `${symbolName} definition`,
          };
        }
      }

      return {
        definition: `// ${symbolName} not found in current analysis`,
        documentation: `Symbol '${symbolName}' was not found in the analyzed codebase.`,
      };
    } catch (error) {
      return {
        definition: `// Error finding ${symbolName}`,
        documentation: `Failed to locate symbol: ${error}`,
      };
    }
  }

  /**
   * Find usage patterns for a given pattern/symbol
   */
  async findUsagePatterns(
    pattern: string,
    projectPath: string,
    options: { limit?: number } = {}
  ): Promise<Array<{ code: string; file: string; context: string }>> {
    try {
      const compactedProject = await this.compactProject(projectPath, {
        maxTokens: 3000,
        taskType: 'understand',
        includeTests: true,
      });

      const examples: Array<{ code: string; file: string; context: string }> = [];
      const limit = options.limit || 3;

      for (const file of compactedProject.files) {
        // Look for symbols that match or use the pattern
        const matchingNodes = file.nodes.filter(
          node =>
            node.signature.toLowerCase().includes(pattern.toLowerCase()) ||
            node.summary.purpose.toLowerCase().includes(pattern.toLowerCase())
        );

        for (const node of matchingNodes.slice(0, limit - examples.length)) {
          examples.push({
            code: node.signature,
            file: file.path,
            context: node.summary.purpose,
          });
        }

        if (examples.length >= limit) break;
      }

      return examples;
    } catch (error) {
      return [
        {
          code: `// Error finding usage patterns for ${pattern}`,
          file: 'error',
          context: String(error),
        },
      ];
    }
  }

  /**
   * Trace dependency flow between components
   */
  async traceDependencyFlow(
    from: string,
    to: string | undefined,
    projectPath: string
  ): Promise<{ description: string; steps: string[] }> {
    try {
      const compactedProject = await this.compactProject(projectPath, {
        maxTokens: 2000,
        taskType: 'understand',
      });

      // Find the source component
      const sourceFile = compactedProject.files.find(
        f => f.path.includes(from) || f.nodes.some(n => n.summary.name.includes(from))
      );

      if (!sourceFile) {
        return {
          description: `Component '${from}' not found in codebase`,
          steps: [],
        };
      }

      const dependencies = sourceFile.dependencies;
      const steps = dependencies.map(dep => `${from} → ${dep}`);

      if (to) {
        const targetFound = dependencies.some(dep => dep.includes(to));
        if (targetFound) {
          steps.push(`Found connection: ${from} → ${to}`);
        } else {
          steps.push(`No direct dependency from ${from} to ${to}`);
        }
      }

      return {
        description: `Dependency analysis for ${from}${to ? ` to ${to}` : ''}`,
        steps,
      };
    } catch (error) {
      return {
        description: `Error analyzing dependencies: ${error}`,
        steps: [],
      };
    }
  }

  /**
   * Find related test files and examples
   */
  async findRelatedTests(
    component: string,
    projectPath: string
  ): Promise<Array<{ name: string; code: string; file: string }>> {
    try {
      const compactedProject = await this.compactProject(projectPath, {
        maxTokens: 2000,
        taskType: 'test',
        includeTests: true,
      });

      const tests: Array<{ name: string; code: string; file: string }> = [];

      for (const file of compactedProject.files) {
        // Look for test files that mention the component
        if (
          file.path.includes('.test.') ||
          file.path.includes('.spec.') ||
          file.path.includes('__tests__')
        ) {
          const relatedTests = file.nodes.filter(
            node =>
              node.signature.toLowerCase().includes(component.toLowerCase()) ||
              node.summary.purpose.toLowerCase().includes(component.toLowerCase())
          );

          for (const test of relatedTests.slice(0, 3)) {
            tests.push({
              name: test.summary.name,
              code: test.signature,
              file: file.path,
            });
          }
        }
      }

      return tests;
    } catch (error) {
      return [
        {
          name: `Error finding tests for ${component}`,
          code: `// ${error}`,
          file: 'error',
        },
      ];
    }
  }

  /**
   * Find files related to a pattern or component
   */
  async findRelatedFiles(
    pattern: string,
    projectPath: string
  ): Promise<Array<{ path: string; relevance: number; summary: string }>> {
    try {
      const compactedProject = await this.compactProject(projectPath, {
        maxTokens: 3000,
        taskType: 'understand',
      });

      const relatedFiles = compactedProject.files
        .filter(
          file =>
            file.path.toLowerCase().includes(pattern.toLowerCase()) ||
            file.summary.purpose.toLowerCase().includes(pattern.toLowerCase()) ||
            file.nodes.some(node => node.signature.toLowerCase().includes(pattern.toLowerCase()))
        )
        .map(file => ({
          path: file.path,
          relevance: file.nodes.reduce((acc, node) => acc + (node.relevanceScore || 0), 0),
          summary: file.summary.purpose,
        }))
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 5);

      return relatedFiles;
    } catch (error) {
      return [
        {
          path: 'error',
          relevance: 0,
          summary: `Error finding files: ${error}`,
        },
      ];
    }
  }

  /**
   * Find error handling patterns for a component
   */
  async findErrorHandling(
    pattern: string,
    projectPath: string
  ): Promise<{ code: string; cases: string[]; types: string[] }> {
    try {
      const compactedProject = await this.compactProject(projectPath, {
        maxTokens: 2000,
        taskType: 'debug',
      });

      const errorHandling: string[] = [];
      const errorCases: string[] = [];
      const errorTypes: string[] = [];

      for (const file of compactedProject.files) {
        const errorNodes = file.nodes.filter(
          node =>
            node.signature.includes('try') ||
            node.signature.includes('catch') ||
            node.signature.includes('throw') ||
            node.signature.includes('Error') ||
            node.summary.purpose.toLowerCase().includes('error')
        );

        for (const node of errorNodes) {
          if (node.signature.toLowerCase().includes(pattern.toLowerCase())) {
            errorHandling.push(node.signature);
            errorCases.push(node.summary.purpose);

            // Extract error types from signature
            const errorTypeMatch = node.signature.match(/(\w+Error)/g);
            if (errorTypeMatch) {
              errorTypes.push(...errorTypeMatch);
            }
          }
        }
      }

      return {
        code: errorHandling.slice(0, 3).join('\n\n'),
        cases: errorCases.slice(0, 5),
        types: [...new Set(errorTypes)],
      };
    } catch (error) {
      return {
        code: `// Error finding error handling: ${error}`,
        cases: ['Error analysis failed'],
        types: ['AnalysisError'],
      };
    }
  }

  /**
   * Get detailed implementation for a symbol
   */
  async getImplementationDetails(
    symbol: string,
    projectPath: string
  ): Promise<{ code: string; algorithms: string[]; complexity: string }> {
    try {
      const compactedProject = await this.compactProject(projectPath, {
        maxTokens: 2000,
        taskType: 'implement',
      });

      for (const file of compactedProject.files) {
        const targetNode = file.nodes.find(
          node => node.summary.name === symbol || node.signature.includes(symbol)
        );

        if (targetNode) {
          // Extract algorithmic patterns
          const algorithms: string[] = [];
          if (targetNode.signature.includes('sort')) algorithms.push('Sorting algorithm');
          if (targetNode.signature.includes('search')) algorithms.push('Search algorithm');
          if (targetNode.signature.includes('cache')) algorithms.push('Caching strategy');
          if (targetNode.signature.includes('async')) algorithms.push('Asynchronous processing');

          // Assess complexity
          let complexity = 'Low';
          const lines = targetNode.signature.split('\n').length;
          if (lines > 20) complexity = 'Medium';
          if (lines > 50) complexity = 'High';

          return {
            code: targetNode.signature,
            algorithms: algorithms.length > 0 ? algorithms : ['Standard implementation'],
            complexity,
          };
        }
      }

      return {
        code: `// ${symbol} implementation not found`,
        algorithms: ['Not analyzed'],
        complexity: 'Unknown',
      };
    } catch (error) {
      return {
        code: `// Error getting implementation: ${error}`,
        algorithms: ['Error in analysis'],
        complexity: 'Error',
      };
    }
  }

  /**
   * Generate file summary for a specific file
   */
  async generateFileSummary(
    filePath: string,
    taskType: string = 'understand'
  ): Promise<{ filePath: string; summary: string; keySymbols: string }> {
    try {
      // First discover if the file exists
      // Create a temporary file discovery instance for the target file
      const tempDiscovery = new FileDiscovery(filePath);
      const discoveredFiles = await tempDiscovery.discoverFiles();

      const targetFile = discoveredFiles.find((f: FileInfo) => f.absPath === filePath);
      if (!targetFile) {
        return {
          filePath,
          summary: 'File not found or not supported',
          keySymbols: '',
        };
      }

      // Parse the file
      const parsedFile = await this.astParser.parseFile(
        targetFile.absPath,
        targetFile.language as SupportedLanguage
      );
      const prunedFile = await this.astPruner.pruneFile(parsedFile);
      const fileSummary = this.summarizer.summarizeFile(prunedFile);

      const keySymbols = prunedFile.symbols
        .slice(0, 5)
        .map((s: any) => `- ${s.type} ${this.extractSymbolName(s)}`)
        .join('\n');

      return {
        filePath,
        summary: fileSummary.purpose,
        keySymbols,
      };
    } catch (error) {
      return {
        filePath,
        summary: `Error analyzing file: ${error}`,
        keySymbols: '',
      };
    }
  }

  /**
   * Extract symbol name from signature
   */
  private extractSymbolName(symbol: any): string {
    // Extract function/class name from signature
    const match = symbol.signature.match(/(?:function|class|const|let|var)\s+(\w+)|(\w+)\s*[:=]/);
    return match?.[1] || match?.[2] || symbol.type || 'unknown';
  }
}

// Export default instance for convenience
export const semanticCompactor = {
  async compactProject(projectPath: string, options: CompactionOptions = {}): Promise<any> {
    const compactor = new SemanticCompactor(projectPath, options);
    return await compactor.compact();
  },
};
