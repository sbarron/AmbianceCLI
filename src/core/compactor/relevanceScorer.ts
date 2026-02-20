/**
 * @fileOverview: Intelligent relevance scoring and filtering for code symbols based on query context and task type
 * @module: RelevanceScorer
 * @keyFunctions:
 *   - scoreAndFilter(): Score and filter symbols based on relevance context and token budget
 *   - scoreSymbol(): Calculate comprehensive relevance score for individual symbols
 *   - calculateRelevanceScore(): Score based on query matching and task type alignment
 *   - calculateContextScore(): Evaluate symbol importance within file and project context
 *   - calculateQualityScore(): Assess code quality and documentation completeness
 * @dependencies:
 *   - Deduplicator: HashedSymbol interface for symbol representation
 *   - ASTPruner: PrunedFile data structure for file context
 *   - SemanticSummarizer: SymbolSummary for quality assessment
 *   - RelevanceContext: Query and task type context interface
 * @context: Provides intelligent symbol ranking and filtering that prioritizes the most relevant code based on user queries, task types, and token budget constraints
 */

import { HashedSymbol } from './deduplicator';
import { PrunedFile } from './astPruner';
import { SymbolSummary } from './semanticSummarizer';
import { logger } from '../../utils/logger';

export interface RelevanceContext {
  query?: string;
  fileContext?: string[];
  symbolContext?: string[];
  taskType?: 'debug' | 'implement' | 'understand' | 'refactor' | 'test' | 'document';
  maxTokens?: number;
  preferredTypes?: (
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'variable'
    | 'export'
    | 'import'
    | 'method'
  )[];
}

export interface ScoredSymbol {
  symbol: HashedSymbol;
  queryMatchScore: number;
  relevanceScore: number;
  contextScore: number;
  qualityScore: number;
  totalScore: number;
  reasoning: string[];
}

export interface FilteredResult {
  symbols: ScoredSymbol[];
  totalTokens: number;
  filesIncluded: number;
  averageRelevance: number;
  topCategories: string[];
}

export class RelevanceScorer {
  /**
   * Score and filter symbols based on relevance context
   */
  scoreAndFilter(files: PrunedFile[], context: RelevanceContext): FilteredResult {
    const allSymbols = this.extractAllSymbols(files);
    logger.info('Starting relevance scoring', {
      symbolCount: allSymbols.length,
      hasQuery: !!context?.query,
    });

    const scoredSymbols = allSymbols.map(symbol => this.scoreSymbol(symbol, context, files));

    // Sort by total score
    scoredSymbols.sort((a, b) => b.totalScore - a.totalScore);

    // Filter by token budget if specified
    const tokenBudgetFiltered = this.applyTokenBudget(scoredSymbols, context.maxTokens);
    const filtered = this.applyQueryFocus(tokenBudgetFiltered, context);

    const result = this.buildResult(filtered, files.length);

    logger.info('Relevance scoring completed', {
      originalSymbols: allSymbols.length,
      filteredSymbols: result.symbols.length,
      averageRelevance: parseFloat(result.averageRelevance.toFixed(2)),
    });

    return result;
  }

  /**
   * Score an individual symbol for relevance
   */
  private scoreSymbol(
    symbol: HashedSymbol,
    context: RelevanceContext,
    allFiles: PrunedFile[]
  ): ScoredSymbol {
    const reasoning: string[] = [];

    const queryMatchScore = context.query
      ? this.calculateQueryMatchScore(symbol, context.query)
      : 0;
    const relevanceScore = this.calculateRelevanceScore(
      symbol,
      context,
      reasoning,
      queryMatchScore
    );
    const contextScore = this.calculateContextScore(symbol, context, allFiles, reasoning);
    const qualityScore = this.calculateQualityScore(symbol, reasoning);

    // Task-specific weighted scoring
    let weights: { relevance: number; context: number; quality: number; importance: number };

    switch (context.taskType) {
      case 'understand':
        // For understanding, prioritize quality (documentation) and context (relationships)
        weights = { relevance: 0.3, context: 0.35, quality: 0.25, importance: 0.1 };
        break;
      case 'implement':
        // For implementation, prioritize relevance (task match) and importance (exported symbols)
        weights = { relevance: 0.45, context: 0.25, quality: 0.15, importance: 0.15 };
        break;
      case 'debug':
        // For debugging, heavily prioritize relevance and context
        weights = { relevance: 0.5, context: 0.3, quality: 0.1, importance: 0.1 };
        break;
      default:
        // Default balanced weighting
        weights = { relevance: 0.4, context: 0.3, quality: 0.2, importance: 0.1 };
    }

    const totalScore =
      relevanceScore * weights.relevance +
      contextScore * weights.context +
      qualityScore * weights.quality +
      symbol.importance * weights.importance;

    return {
      symbol,
      queryMatchScore,
      relevanceScore,
      contextScore,
      qualityScore,
      totalScore,
      reasoning,
    };
  }

  /**
   * Calculate relevance score based on query and task type
   */
  private calculateRelevanceScore(
    symbol: HashedSymbol,
    context: RelevanceContext,
    reasoning: string[],
    precomputedQueryScore?: number
  ): number {
    let score = 0;

    // Query matching
    if (context.query) {
      const queryScore =
        typeof precomputedQueryScore === 'number'
          ? precomputedQueryScore
          : this.calculateQueryMatchScore(symbol, context.query);
      score += queryScore * 30;
      if (queryScore > 0.3) {
        reasoning.push(`Query match: ${(queryScore * 100).toFixed(0)}%`);
      }
    }

    // Task type relevance
    if (context.taskType) {
      const taskScore = this.calculateTaskRelevance(symbol, context.taskType);
      score += taskScore * 20;
      if (taskScore > 0.5) {
        reasoning.push(`Relevant for ${context.taskType} task`);
      }
    }

    // Preferred types
    if (context.preferredTypes && context.preferredTypes.includes(symbol.type)) {
      score += 15;
      reasoning.push(`Preferred type: ${symbol.type}`);
    }

    // Export bonus (exported symbols are often more important for understanding)
    if (symbol.isExported) {
      score += 10;
      reasoning.push('Exported symbol');
    }

    // Documentation bonus
    if (symbol.docstring && symbol.docstring.length > 20) {
      score += 8;
      reasoning.push('Well documented');
    }

    return Math.min(score, 100);
  }

  /**
   * Calculate contextual score based on file and symbol relationships
   */
  private calculateContextScore(
    symbol: HashedSymbol,
    context: RelevanceContext,
    allFiles: PrunedFile[],
    reasoning: string[]
  ): number {
    let score = 0;

    // File context matching
    if (context.fileContext) {
      const fileScore = this.calculateFileContextScore(symbol, context.fileContext);
      score += fileScore * 25;
      if (fileScore > 0.5) {
        reasoning.push('File context match');
      }
    }

    // Symbol context matching (related symbols)
    if (context.symbolContext) {
      const symbolScore = this.calculateSymbolContextScore(symbol, context.symbolContext);
      score += symbolScore * 20;
      if (symbolScore > 0.5) {
        reasoning.push('Symbol context match');
      }
    }

    // Relationship density (symbols with more relationships are often more central)
    const relationshipScore = Math.min(symbol.relationships.length * 3, 15);
    score += relationshipScore;
    if (relationshipScore > 10) {
      reasoning.push('Highly connected');
    }

    // Cross-file importance (symbols used across multiple files)
    const crossFileScore = this.calculateCrossFileImportance(symbol, allFiles);
    score += crossFileScore * 10;
    if (crossFileScore > 0.5) {
      reasoning.push('Used across files');
    }

    return Math.min(score, 100);
  }

  /**
   * Calculate quality score based on code quality indicators
   */
  private calculateQualityScore(symbol: HashedSymbol, reasoning: string[]): number {
    let score = 0;

    // Complexity appropriateness (not too simple, not too complex)
    const complexityScore = this.assessComplexityScore(symbol);
    score += complexityScore * 15;

    // Naming quality
    const namingScore = this.assessNamingQuality(symbol.name);
    score += namingScore * 10;
    if (namingScore > 0.7) {
      reasoning.push('Good naming');
    }

    // Type safety (TypeScript types, interfaces)
    if (symbol.type === 'interface' || symbol.type === 'type') {
      score += 10;
      reasoning.push('Type definition');
    }

    // Async patterns (relevant in modern codebases)
    if (symbol.signature.includes('async') || symbol.signature.includes('Promise')) {
      score += 8;
      reasoning.push('Async pattern');
    }

    // Error handling patterns
    if (this.hasErrorHandling(symbol)) {
      score += 5;
      reasoning.push('Error handling');
    }

    // Base quality score for all symbols
    score += 20;

    return Math.min(score, 100);
  }

  /**
   * Calculate query match score using multiple strategies
   */
  private calculateQueryMatchScore(symbol: HashedSymbol, query: string): number {
    const queryLower = query.toLowerCase();
    const symbolName = symbol.name.toLowerCase();
    const signature = symbol.signature.toLowerCase();
    const docstring = symbol.docstring?.toLowerCase() || '';
    const body = symbol.compactedBody?.toLowerCase() || '';

    let score = 0;

    // Exact name match
    if (symbolName === queryLower) return 1.0;

    // Name contains query
    if (symbolName.includes(queryLower)) {
      score = Math.max(score, 0.8);
    }

    // Query contains symbol name (reverse match)
    if (queryLower.includes(symbolName) && symbolName.length > 3) {
      score = Math.max(score, 0.7);
    }

    // Signature match
    if (signature.includes(queryLower)) {
      score = Math.max(score, 0.6);
    }

    // Docstring match
    if (docstring.includes(queryLower)) {
      score = Math.max(score, 0.5);
    }

    // Body content match
    if (body.includes(queryLower)) {
      score = Math.max(score, 0.4);
    }

    // Fuzzy matching for typos/variations
    const fuzzyScore = this.calculateFuzzyMatch(symbolName, queryLower);
    score = Math.max(score, fuzzyScore * 0.6);

    // Semantic word matching
    const wordScore = this.calculateWordOverlap(queryLower, symbolName + ' ' + signature);
    score = Math.max(score, wordScore * 0.5);

    return score;
  }

  /**
   * Calculate task-specific relevance
   */
  private calculateTaskRelevance(symbol: HashedSymbol, taskType: string): number {
    const name = symbol.name.toLowerCase();
    const signature = symbol.signature.toLowerCase();
    const type = symbol.type;

    switch (taskType) {
      case 'debug':
        // Prioritize error handling, logging, validation functions
        if (
          name.includes('error') ||
          name.includes('log') ||
          name.includes('debug') ||
          name.includes('validate') ||
          name.includes('check')
        )
          return 0.9;
        if (signature.includes('try') || signature.includes('catch') || signature.includes('throw'))
          return 0.8;
        if (type === 'function' && symbol.compactedBody?.includes('console')) return 0.7;
        return 0.3;

      case 'implement':
        // Prioritize actionable entry points, implementation patterns, and modifiable code
        if (type === 'function' && symbol.isExported && !symbol.docstring?.includes('@deprecated'))
          return 0.9; // Primary functions
        if (type === 'interface' || type === 'type') return 0.85; // Type contracts
        if (
          name.includes('create') ||
          name.includes('build') ||
          name.includes('make') ||
          name.includes('setup')
        )
          return 0.8;
        if (type === 'class' && symbol.isExported) return 0.75; // Instantiable classes
        if (name.includes('handler') || name.includes('processor') || name.includes('manager'))
          return 0.7;
        if (symbol.isExported && type !== 'variable') return 0.65; // Most exported non-variables
        if (type === 'function' && !name.startsWith('_')) return 0.6; // Public functions
        return 0.3; // Lower baseline, focus on actionable code

      case 'understand':
        // Prioritize architectural components, well-documented symbols, and central abstractions
        if (symbol.docstring && symbol.docstring.length > 50) return 0.95; // Higher for well-documented
        if (type === 'interface' || type === 'type') return 0.9; // Type definitions are crucial for understanding
        if (type === 'class' && symbol.docstring) return 0.9; // Documented classes
        if (symbol.isExported && symbol.relationships.length > 3) return 0.85; // Central exported symbols
        if (
          name.includes('main') ||
          name.includes('index') ||
          name.includes('init') ||
          name.includes('config')
        )
          return 0.8;
        if (symbol.isExported) return 0.75; // All exported symbols are valuable for understanding
        if (type === 'class') return 0.7;
        if (symbol.relationships.length > 2) return 0.6; // Connected symbols help understand architecture
        return 0.4; // Lower baseline for understanding tasks

      case 'refactor':
        // Prioritize complex functions, classes with many relationships
        if (symbol.relationships.length > 5) return 0.9;
        if (type === 'class' && symbol.compactedBody?.includes('Methods:')) return 0.8;
        if (
          type === 'function' &&
          symbol.compactedBody &&
          symbol.compactedBody.split('\n').length > 10
        )
          return 0.7;
        return 0.4;

      case 'test':
        // Prioritize testable functions and classes
        if (name.includes('test') || name.includes('spec')) return 0.9;
        if (type === 'function' && !name.startsWith('_')) return 0.8;
        if (type === 'class') return 0.7;
        return 0.3;

      case 'document':
        // Prioritize exported, complex symbols without good documentation
        if (symbol.isExported && !symbol.docstring) return 0.9;
        if (type === 'class' || type === 'interface') return 0.8;
        if (symbol.relationships.length > 3) return 0.7;
        return 0.4;

      default:
        return 0.5;
    }
  }

  /**
   * Calculate file context score
   */
  private calculateFileContextScore(symbol: HashedSymbol, fileContext: string[]): number {
    const symbolFile = symbol.location.file.toLowerCase();

    for (const contextFile of fileContext) {
      const contextLower = contextFile.toLowerCase();

      // Exact file match
      if (symbolFile.includes(contextLower) || contextLower.includes(symbolFile)) {
        return 1.0;
      }

      // Directory match
      const symbolDir = symbolFile.split('/').slice(0, -1).join('/');
      const contextDir = contextLower.split('/').slice(0, -1).join('/');
      if (symbolDir === contextDir) {
        return 0.8;
      }
    }

    return 0;
  }

  /**
   * Calculate symbol context score
   */
  private calculateSymbolContextScore(symbol: HashedSymbol, symbolContext: string[]): number {
    let maxScore = 0;

    for (const contextSymbol of symbolContext) {
      const contextLower = contextSymbol.toLowerCase();

      // Direct name match
      if (symbol.name.toLowerCase() === contextLower) {
        maxScore = Math.max(maxScore, 1.0);
        continue;
      }

      // Relationship match
      for (const rel of symbol.relationships) {
        if (rel.target.toLowerCase().includes(contextLower)) {
          maxScore = Math.max(maxScore, 0.8);
        }
      }

      // Signature contains context symbol
      if (symbol.signature.toLowerCase().includes(contextLower)) {
        maxScore = Math.max(maxScore, 0.6);
      }
    }

    return maxScore;
  }

  /**
   * Calculate cross-file importance
   */
  private calculateCrossFileImportance(symbol: HashedSymbol, allFiles: PrunedFile[]): number {
    let usageCount = 0;
    const symbolName = symbol.name;

    for (const file of allFiles) {
      if (file.absPath === symbol.location.file) continue;

      // Check if symbol is imported or referenced
      const isImported = file.dependencies.some(dep => dep.includes(symbolName));
      const isReferenced = file.symbols.some(
        s =>
          s.signature.includes(symbolName) ||
          s.compactedBody?.includes(symbolName) ||
          s.relationships.some(r => r.target === symbolName)
      );

      if (isImported || isReferenced) {
        usageCount++;
      }
    }

    return Math.min(usageCount / allFiles.length, 1.0);
  }

  /**
   * Assess complexity score (prefer moderate complexity)
   */
  private assessComplexityScore(symbol: HashedSymbol): number {
    const relationships = symbol.relationships.length;
    const bodyLines = symbol.compactedBody?.split('\n').length || 0;
    const paramCount = (symbol.signature.match(/,/g) || []).length + 1;

    const complexity = relationships + bodyLines + paramCount;

    // Prefer moderate complexity (not too simple, not too complex)
    if (complexity < 3) return 0.3; // Too simple
    if (complexity < 10) return 1.0; // Good complexity
    if (complexity < 20) return 0.8; // Moderate complexity
    if (complexity < 40) return 0.5; // High complexity
    return 0.2; // Very high complexity
  }

  /**
   * Assess naming quality
   */
  private assessNamingQuality(name: string): number {
    let score = 0.5; // Base score

    // Good length (not too short, not too long)
    if (name.length >= 3 && name.length <= 30) score += 0.2;

    // Uses camelCase or snake_case
    if (/^[a-z][a-zA-Z0-9]*$/.test(name) || /^[a-z][a-z0-9_]*$/.test(name)) score += 0.2;

    // Descriptive (contains verbs/nouns)
    const descriptiveWords = [
      'get',
      'set',
      'create',
      'update',
      'delete',
      'handle',
      'process',
      'validate',
      'parse',
      'build',
    ];
    if (descriptiveWords.some(word => name.toLowerCase().includes(word))) score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Check if symbol has error handling patterns
   */
  private hasErrorHandling(symbol: HashedSymbol): boolean {
    const signature = symbol.signature.toLowerCase();
    const body = symbol.compactedBody?.toLowerCase() || '';

    return (
      signature.includes('error') ||
      signature.includes('exception') ||
      body.includes('try') ||
      body.includes('catch') ||
      body.includes('throw') ||
      body.includes('error')
    );
  }

  /**
   * Calculate fuzzy string matching score
   */
  private calculateFuzzyMatch(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate word overlap between query and text
   */
  private calculateWordOverlap(query: string, text: string): number {
    const queryWords = query.split(/\W+/).filter(w => w.length > 2);
    const textWords = text.split(/\W+/).filter(w => w.length > 2);

    if (queryWords.length === 0) return 0;

    const matches = queryWords.filter(word =>
      textWords.some(textWord => textWord.includes(word) || word.includes(textWord))
    );

    return matches.length / queryWords.length;
  }

  /**
   * Extract all symbols from files
   */
  private extractAllSymbols(files: PrunedFile[]): HashedSymbol[] {
    return files.flatMap(file =>
      file.symbols.filter(symbol => symbol && typeof symbol === 'object')
    ) as HashedSymbol[];
  }

  /**
   * Apply token budget constraints
   */
  private applyTokenBudget(scoredSymbols: ScoredSymbol[], maxTokens?: number): ScoredSymbol[] {
    if (!maxTokens) return scoredSymbols;

    const filtered: ScoredSymbol[] = [];
    let totalTokens = 0;

    for (const scoredSymbol of scoredSymbols) {
      const symbolTokens = this.estimateTokenCount(scoredSymbol.symbol);

      if (totalTokens + symbolTokens <= maxTokens) {
        filtered.push(scoredSymbol);
        totalTokens += symbolTokens;
      } else {
        break;
      }
    }

    return filtered;
  }

  /**
   * Keep query-driven contexts focused even when token budget is large enough to include everything.
   */
  private applyQueryFocus(
    scoredSymbols: ScoredSymbol[],
    context: RelevanceContext
  ): ScoredSymbol[] {
    const query = context.query?.trim();
    if (!query || scoredSymbols.length === 0) {
      return scoredSymbols;
    }

    const maxByRatio = Math.ceil(scoredSymbols.length * 0.45);
    const maxSymbols = Math.max(6, Math.min(24, maxByRatio));

    const strongMatches = scoredSymbols.filter(symbol => symbol.queryMatchScore >= 0.2);
    if (strongMatches.length > 0) {
      return strongMatches.slice(0, maxSymbols);
    }

    const weakMatches = scoredSymbols.filter(symbol => symbol.queryMatchScore >= 0.08);
    if (weakMatches.length > 0) {
      return weakMatches.slice(0, maxSymbols);
    }

    // No lexical matches: return a smaller high-signal slice instead of full-project output.
    return scoredSymbols.slice(0, Math.min(maxSymbols, 8));
  }

  /**
   * Estimate token count for a symbol
   */
  private estimateTokenCount(symbol: HashedSymbol): number {
    let tokens = 0;

    tokens += symbol.signature.split(/\s+/).length;
    if (symbol.docstring) tokens += symbol.docstring.split(/\s+/).length;
    if (symbol.compactedBody) tokens += symbol.compactedBody.split(/\s+/).length;
    tokens += 10; // Metadata overhead

    return tokens;
  }

  /**
   * Build final result
   */
  private buildResult(scoredSymbols: ScoredSymbol[], totalFiles: number): FilteredResult {
    const totalTokens = scoredSymbols.reduce(
      (sum, s) => sum + this.estimateTokenCount(s.symbol),
      0
    );
    const filesIncluded = new Set(scoredSymbols.map(s => s.symbol.location.file)).size;
    const averageRelevance =
      scoredSymbols.length > 0
        ? scoredSymbols.reduce((sum, s) => sum + s.totalScore, 0) / scoredSymbols.length
        : 0;

    // Calculate top categories
    const categories = new Map<string, number>();
    scoredSymbols.forEach(s => {
      const category = s.symbol.type;
      categories.set(category, (categories.get(category) || 0) + 1);
    });

    const topCategories = Array.from(categories.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([category]) => category);

    return {
      symbols: scoredSymbols,
      totalTokens,
      filesIncluded,
      averageRelevance,
      topCategories,
    };
  }
}
