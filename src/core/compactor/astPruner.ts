/**
 * @fileOverview: Intelligent AST compression and optimization for token-efficient code representation
 * @module: ASTPruner
 * @keyFunctions:
 *   - pruneFile(): Compress parsed AST into semantically-rich, token-efficient representation
 *   - pruneSymbol(): Apply semantic filtering and importance scoring to individual symbols
 *   - compactCodeBody(): Reduce function/class bodies while preserving signatures
 *   - mapRelationships(): Track dependencies, imports, exports and cross-references
 *   - generatePrunedFile(): Create optimized output for SemanticCompactor consumption
 * @dependencies:
 *   - ASTParser: Source AST parsing and symbol extraction
 *   - Symbol/ParsedFile: Core data structures from AST parsing
 *   - Relationship/PrunedSymbol: Compressed representation interfaces
 * @context: Transforms raw parsed ASTs into optimized structures suitable for LLM consumption, balancing semantic preservation with aggressive token optimization
 */

import { Symbol, ParsedFile, ImportStatement, ExportStatement } from './astParser';
import { logger } from '../../utils/logger';

export interface PrunedSymbol {
  id: string;
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'export' | 'import' | 'method';
  signature: string;
  location: {
    file: string; // This will be set to the absolute path from the parent file
    startLine: number;
    endLine: number;
  };
  docstring?: string;
  isExported: boolean;
  importance: number;
  relationships: Relationship[];
  compactedBody?: string;
}

export interface Relationship {
  type: 'imports' | 'exports' | 'calls' | 'extends' | 'implements' | 'references';
  target: string;
  file?: string;
}

export interface PrunedFile {
  absPath: string; // 🔑 Use absolute path as authoritative
  language: string;
  symbols: PrunedSymbol[];
  dependencies: string[];
  exports: string[];
  summary: string;
  tokenCount: number;
}

export class ASTProcessingOptions {
  includePrivateMethods: boolean = false;
  includeTestFiles: boolean = false;
  includeComments: boolean = true;
  maxFunctionBodyLines: number = 5;
  maxClassBodyLines: number = 10;
  preserveTypeAnnotations: boolean = true;
  includeImportStatements: boolean = true;
}

export class ASTPruner {
  private options: ASTProcessingOptions;

  constructor(options: Partial<ASTProcessingOptions> = {}) {
    this.options = { ...new ASTProcessingOptions(), ...options };
  }

  /**
   * Prune a parsed file to retain only semantically rich information
   */
  pruneFile(parsedFile: ParsedFile): PrunedFile {
    logger.debug('Pruning file', {
      filePath: parsedFile.absPath,
      symbolCount: parsedFile.symbols.length,
    });

    const prunedSymbols: PrunedSymbol[] = [];
    let totalTokens = 0;

    // Process each symbol
    for (const symbol of parsedFile.symbols) {
      const prunedSymbol = this.pruneSymbol(symbol, parsedFile);

      if (this.shouldIncludeSymbol(prunedSymbol)) {
        prunedSymbols.push(prunedSymbol);
        totalTokens += this.estimateTokenCount(prunedSymbol);
      }
    }

    // Sort symbols by importance
    prunedSymbols.sort((a, b) => b.importance - a.importance);

    // Extract dependencies and exports
    const dependencies = this.extractDependencies(parsedFile.imports);
    const exports = this.extractExports(parsedFile.exports);

    // Generate file summary
    const summary = this.generateFileSummary(prunedSymbols, dependencies, exports);

    return {
      absPath: parsedFile.absPath,
      language: parsedFile.language,
      symbols: prunedSymbols,
      dependencies,
      exports,
      summary,
      tokenCount: totalTokens,
    };
  }

  /**
   * Prune an individual symbol
   */
  private pruneSymbol(symbol: Symbol, file: ParsedFile): PrunedSymbol {
    const relationships = this.extractRelationships(symbol, file);
    const importance = this.calculateImportance(symbol, relationships);
    const compactedBody = this.compactBody(symbol);

    return {
      id: `${file.absPath}:${symbol.name}:${symbol.startLine}`,
      name: symbol.name,
      type: symbol.type,
      signature: this.cleanSignature(symbol.signature),
      location: {
        file: file.absPath, // 🔑 Use absolute path
        startLine: symbol.startLine,
        endLine: symbol.endLine,
      },
      docstring: this.options.includeComments ? symbol.docstring : undefined,
      isExported: symbol.isExported,
      importance,
      relationships,
      compactedBody,
    };
  }

  /**
   * Extract relationships between symbols
   */
  private extractRelationships(symbol: Symbol, file: ParsedFile): Relationship[] {
    const relationships: Relationship[] = [];

    // Add export relationship if symbol is exported
    if (symbol.isExported) {
      relationships.push({
        type: 'exports',
        target: symbol.name,
        file: file.absPath,
      });
    }

    // Extract function calls from body (simplified)
    if (symbol.body) {
      const functionCalls = this.extractFunctionCalls(symbol.body);
      functionCalls.forEach(call => {
        relationships.push({
          type: 'calls',
          target: call,
        });
      });
    }

    // Extract class inheritance
    if (symbol.type === 'class' && symbol.signature.includes('extends')) {
      const extendsMatch = symbol.signature.match(/extends\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (extendsMatch) {
        relationships.push({
          type: 'extends',
          target: extendsMatch[1],
        });
      }
    }

    // Extract type references
    const typeRefs = this.extractTypeReferences(symbol.signature);
    typeRefs.forEach(ref => {
      relationships.push({
        type: 'references',
        target: ref,
      });
    });

    return relationships;
  }

  /**
   * Calculate importance score for a symbol
   */
  private calculateImportance(symbol: Symbol, relationships: Relationship[]): number {
    let score = 0;

    // Base scores by type
    switch (symbol.type) {
      case 'function':
        score += 20;
        break;
      case 'class':
        score += 30;
        break;
      case 'interface':
      case 'type':
        score += 25;
        break;
      case 'variable':
        score += 10;
        break;
      case 'export':
        score += 15;
        break;
      case 'import':
        score += 5;
        break;
    }

    // 🔑 MAJOR PENALTY for local variables (likely inside functions)
    if (symbol.type === 'variable' && this.isLikelyLocalVariable(symbol)) {
      score -= 25; // Heavy penalty to push below inclusion threshold
    }

    // 🔑 MAJOR BONUS for exported symbols (public API)
    if (symbol.isExported) {
      score += 30; // Increased from 20
    }

    // 🔑 MAJOR BONUS for main architectural symbols
    const name = symbol.name.toLowerCase();
    if (
      name.includes('main') ||
      name.includes('init') ||
      name.includes('setup') ||
      name.includes('handler') ||
      name.includes('controller') ||
      name.includes('service') ||
      name.includes('manager') ||
      name.includes('factory') ||
      name.includes('builder') ||
      name.includes('provider')
    ) {
      score += 25; // Increased from 15
    }

    // 🔑 BONUS for entry point patterns
    if (name === 'index' || name === 'main' || name === 'app' || name === 'server') {
      score += 20;
    }

    // Bonus for documented symbols
    if (symbol.docstring && symbol.docstring.length > 10) {
      score += 10;
    }

    // Bonus for async functions (often important APIs)
    if (symbol.isAsync) {
      score += 8; // Increased from 5
    }

    // Bonus for symbols with parameters (functions with complexity)
    if (symbol.parameters && symbol.parameters.length > 0) {
      score += Math.min(symbol.parameters.length * 2, 10);
    }

    // Bonus for symbols with relationships
    score += Math.min(relationships.length * 3, 15);

    // Penalty for very short or very long bodies
    if (symbol.body) {
      const lines = symbol.body.split('\n').length;
      if (lines < 2) {
        score -= 5; // Too simple
      } else if (lines > 50) {
        score -= 10; // Too complex, likely auto-generated
      }
    }

    // Penalty for test-related symbols
    if (name.includes('test') || name.includes('spec') || name.includes('mock')) {
      score -= 20;
    }

    // Penalty for private/internal symbols (unless explicitly included)
    if (
      !this.options.includePrivateMethods &&
      (name.startsWith('_') || name.includes('internal') || name.includes('private'))
    ) {
      score -= 10;
    }

    return Math.max(0, score);
  }

  /**
   * Determine if a variable is likely a local variable inside a function
   */
  private isLikelyLocalVariable(symbol: Symbol): boolean {
    const name = symbol.name.toLowerCase();

    // Common local variable patterns
    const localVariablePatterns = [
      'starttime',
      'endtime',
      'result',
      'response',
      'data',
      'temp',
      'tmp',
      'elapsed',
      'duration',
      'error',
      'err',
      'value',
      'val',
      'item',
      'element',
      'index',
      'i',
      'j',
      'k',
      'count',
      'len',
      'length',
      'status',
      'message',
      'output',
      'input',
      'request',
      'req',
      'res',
      'ctx',
      'context',
    ];

    // Check if name matches common local variable patterns
    if (localVariablePatterns.some(pattern => name.includes(pattern))) {
      return true;
    }

    // Check if it's a short variable name (often local)
    if (name.length <= 3 && !['app', 'api', 'url', 'uri', 'key', 'id'].includes(name)) {
      return true;
    }

    // Check if it has common local variable naming patterns
    if (name.match(/^(get|set|is|has|can|should|will|did)[A-Z]/) && symbol.type === 'variable') {
      return true;
    }

    // Variables that start with numbers or have camelCase with temp-like endings
    if (name.match(/\d+$/) || name.endsWith('str') || name.endsWith('obj')) {
      return true;
    }

    return false;
  }

  /**
   * Compact function/class bodies to essential information
   */
  private compactBody(symbol: Symbol): string | undefined {
    if (!symbol.body) return undefined;

    const lines = symbol.body.split('\n');

    if (symbol.type === 'function') {
      // For functions, keep first few lines and signature info
      const maxLines = this.options.maxFunctionBodyLines;
      if (lines.length <= maxLines) {
        return symbol.body;
      }

      const importantLines = lines.slice(0, maxLines);
      return importantLines.join('\n') + '\n  // ... (truncated)';
    }

    if (symbol.type === 'class') {
      // For classes, extract method signatures
      const methodSignatures = this.extractMethodSignatures(symbol.body);
      if (methodSignatures.length > 0) {
        return `Methods: ${methodSignatures.join(', ')}`;
      }
    }

    // For other types, truncate if too long
    if (lines.length > 10) {
      return lines.slice(0, 5).join('\n') + '\n// ... (truncated)';
    }

    return symbol.body;
  }

  /**
   * Clean and normalize symbol signatures
   */
  private cleanSignature(signature: string): string {
    // Remove excessive whitespace
    let cleaned = signature.replace(/\s+/g, ' ').trim();

    // Simplify complex type annotations if not preserving them
    if (!this.options.preserveTypeAnnotations) {
      // Remove complex generic types
      cleaned = cleaned.replace(/<[^>]*>/g, '<T>');

      // Simplify union types
      cleaned = cleaned.replace(/\|\s*\w+(\s*\|\s*\w+)*/g, '| ...');
    }

    return cleaned;
  }

  /**
   * Check if a symbol should be included in the pruned output
   */
  private shouldIncludeSymbol(symbol: PrunedSymbol): boolean {
    // 🔑 ALWAYS exclude likely local variables regardless of other factors
    if (
      symbol.type === 'variable' &&
      this.isLikelyLocalVariable({
        name: symbol.name,
        type: symbol.type as any,
      } as Symbol)
    ) {
      return false;
    }

    // Always include if importance is high
    if (symbol.importance >= 30) return true;

    // Always include exported symbols (unless they're local variables)
    if (symbol.isExported) return true;

    // Include if has documentation
    if (symbol.docstring && symbol.docstring.length > 20) return true;

    // 🔑 Include important architectural symbols even if not exported
    if (symbol.importance >= 20) return true;

    // Skip symbols with very low importance
    if (symbol.importance < 8) return false; // Raised from 5

    // Skip test-related symbols unless explicitly included
    if (!this.options.includeTestFiles) {
      const name = symbol.name.toLowerCase();
      const file = symbol.location.file.toLowerCase();
      if (
        name.includes('test') ||
        name.includes('spec') ||
        file.includes('test') ||
        file.includes('spec')
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Extract dependencies from import statements
   */
  private extractDependencies(imports: ImportStatement[]): string[] {
    const deps = new Set<string>();

    imports.forEach(imp => {
      // Add the source module
      deps.add(imp.source);

      // Add important named imports
      imp.specifiers.forEach(spec => {
        if (spec.type === 'named' && this.isImportantImport(spec.name)) {
          deps.add(`${imp.source}#${spec.name}`);
        }
      });
    });

    return Array.from(deps);
  }

  /**
   * Extract exports from export statements
   */
  private extractExports(exports: ExportStatement[]): string[] {
    return exports.map(exp => (exp.type === 'default' ? 'default' : exp.name));
  }

  /**
   * Generate a summary of the file
   */
  private generateFileSummary(
    symbols: PrunedSymbol[],
    dependencies: string[],
    exports: string[]
  ): string {
    const summary: string[] = [];

    // Count symbols by type
    const typeCounts = symbols.reduce(
      (acc, symbol) => {
        acc[symbol.type] = (acc[symbol.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Build summary parts
    const parts: string[] = [];

    if (typeCounts.function) parts.push(`${typeCounts.function} functions`);
    if (typeCounts.class) parts.push(`${typeCounts.class} classes`);
    if (typeCounts.interface) parts.push(`${typeCounts.interface} interfaces`);
    if (typeCounts.type) parts.push(`${typeCounts.type} types`);

    if (parts.length > 0) {
      summary.push(`Contains: ${parts.join(', ')}`);
    }

    if (exports.length > 0) {
      summary.push(`Exports: ${exports.slice(0, 5).join(', ')}${exports.length > 5 ? '...' : ''}`);
    }

    if (dependencies.length > 0) {
      const mainDeps = dependencies
        .filter(dep => !dep.includes('node_modules') && !dep.startsWith('.'))
        .slice(0, 3);
      if (mainDeps.length > 0) {
        summary.push(`Dependencies: ${mainDeps.join(', ')}`);
      }
    }

    return summary.join('. ');
  }

  /**
   * Extract function calls from code body (simplified)
   */
  private extractFunctionCalls(body: string): string[] {
    const calls: string[] = [];

    // Simple regex to find function calls
    const callPattern = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let match;

    while ((match = callPattern.exec(body)) !== null) {
      const functionName = match[1];
      // Skip common language constructs
      if (!['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(functionName)) {
        calls.push(functionName);
      }
    }

    return [...new Set(calls)]; // Remove duplicates
  }

  /**
   * Extract type references from signatures
   */
  private extractTypeReferences(signature: string): string[] {
    const types: string[] = [];

    // Extract custom types (capitalized identifiers that aren't keywords)
    const typePattern = /\b([A-Z][a-zA-Z0-9_]*)\b/g;
    let match;

    while ((match = typePattern.exec(signature)) !== null) {
      const typeName = match[1];
      // Skip common built-in types
      if (
        !['String', 'Number', 'Boolean', 'Array', 'Object', 'Function', 'Promise'].includes(
          typeName
        )
      ) {
        types.push(typeName);
      }
    }

    return [...new Set(types)];
  }

  /**
   * Extract method signatures from class body
   */
  private extractMethodSignatures(body: string): string[] {
    const methods: string[] = [];

    // Simple extraction of method signatures
    const methodPattern =
      /(?:public|private|protected)?\s*(?:static)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let match;

    while ((match = methodPattern.exec(body)) !== null) {
      methods.push(match[1]);
    }

    return [...new Set(methods)];
  }

  /**
   * Check if an import is important enough to track
   */
  private isImportantImport(name: string): boolean {
    // Track important framework/library imports
    const importantNames = [
      'Component',
      'React',
      'useState',
      'useEffect',
      'Router',
      'Express',
      'Controller',
      'Service',
      'Injectable',
      'Module',
      'Entity',
      'Repository',
    ];

    return importantNames.some(important => name.includes(important) || important.includes(name));
  }

  /**
   * Estimate token count for a symbol
   */
  private estimateTokenCount(symbol: PrunedSymbol): number {
    let tokens = 0;

    // Base tokens for signature
    tokens += symbol.signature.split(/\s+/).length;

    // Tokens for docstring
    if (symbol.docstring) {
      tokens += symbol.docstring.split(/\s+/).length;
    }

    // Tokens for compacted body
    if (symbol.compactedBody) {
      tokens += symbol.compactedBody.split(/\s+/).length;
    }

    // Additional metadata tokens
    tokens += 10; // For type, location, relationships, etc.

    return tokens;
  }
}
