/**
 * @fileOverview: Intelligent semantic summarization for code symbols, files, and projects with architectural analysis
 * @module: SemanticSummarizer
 * @keyFunctions:
 *   - summarizeSymbol(): Create concise descriptions of individual code symbols with purpose and complexity
 *   - summarizeFile(): Generate file-level summaries with purpose, architecture and dependencies
 *   - summarizeProject(): Analyze project structure and identify key patterns and components
 *   - generateSymbolPurpose(): Extract semantic purpose from symbol signatures and relationships
 *   - assessComplexity(): Evaluate code complexity based on structure and relationships
 * @dependencies:
 *   - ASTPruner: PrunedSymbol, PrunedFile and Relationship data structures
 *   - SymbolSummary: Individual symbol summary interface
 *   - FileSummary: File-level summary interface
 *   - ProjectSummary: Project-level summary interface
 * @context: Provides intelligent summarization that extracts semantic meaning from code structures, enabling better understanding of code purpose, complexity, and architectural patterns
 */

import { PrunedSymbol, PrunedFile, Relationship } from './astPruner';

export interface SymbolSummary {
  id: string;
  name: string;
  type: string;
  signature: string;
  purpose: string;
  complexity: 'low' | 'medium' | 'high';
  connections: string[];
  breadcrumb: string;
  tags: string[];
}

export interface FileSummary {
  path: string;
  purpose: string;
  mainExports: string[];
  keyDependencies: string[];
  architecture: string;
  complexity: 'low' | 'medium' | 'high';
  tokenCount: number;
}

export interface ProjectSummary {
  totalFiles: number;
  totalSymbols: number;
  architecture: string;
  mainComponents: string[];
  keyPatterns: string[];
  totalTokens: number;
  compressionRatio: number;
}

export class SemanticSummarizer {
  /**
   * Summarize individual symbols with concise descriptions
   */
  summarizeSymbol(symbol: PrunedSymbol, file: PrunedFile): SymbolSummary {
    const purpose = this.generateSymbolPurpose(symbol);
    const complexity = this.assessSymbolComplexity(symbol);
    const connections = this.extractConnections(symbol);
    const breadcrumb = this.generateBreadcrumb(symbol, file);
    const tags = this.generateTags(symbol);

    return {
      id: symbol.id,
      name: symbol.name,
      type: symbol.type,
      signature: this.shortenSignature(symbol.signature),
      purpose,
      complexity,
      connections,
      breadcrumb,
      tags,
    };
  }

  /**
   * Summarize a file with its overall purpose and structure
   */
  summarizeFile(file: PrunedFile): FileSummary {
    const purpose = this.generateFilePurpose(file);
    const mainExports = this.identifyMainExports(file);
    const keyDependencies = this.identifyKeyDependencies(file);
    const architecture = this.identifyArchitecturalPattern(file);
    const complexity = this.assessFileComplexity(file);

    return {
      path: file.absPath,
      purpose,
      mainExports,
      keyDependencies,
      architecture,
      complexity,
      tokenCount: file.tokenCount,
    };
  }

  /**
   * Summarize entire project structure and patterns
   */
  summarizeProject(files: PrunedFile[]): ProjectSummary {
    const totalFiles = files.length;
    const totalSymbols = files.reduce((sum, file) => sum + file.symbols.length, 0);
    const totalTokens = files.reduce((sum, file) => sum + file.tokenCount, 0);

    const architecture = this.identifyProjectArchitecture(files);
    const mainComponents = this.identifyMainComponents(files);
    const keyPatterns = this.identifyCodePatterns(files);

    // Estimate compression ratio (rough calculation)
    const originalTokens = this.estimateOriginalTokenCount(files);
    const compressionRatio = originalTokens > 0 ? totalTokens / originalTokens : 1;

    return {
      totalFiles,
      totalSymbols,
      architecture,
      mainComponents,
      keyPatterns,
      totalTokens,
      compressionRatio,
    };
  }

  /**
   * Generate contextual descriptions for symbols
   */
  private generateSymbolPurpose(symbol: PrunedSymbol): string {
    const name = symbol.name.toLowerCase();
    const type = symbol.type;
    const signature = symbol.signature.toLowerCase();
    const docstring = symbol.docstring?.toLowerCase() || '';

    // Function purposes
    if (type === 'function') {
      if (name.includes('handler') || name.includes('handle')) {
        return 'Event/request handler function';
      }
      if (name.includes('init') || name.includes('setup') || name.includes('config')) {
        return 'Initialization/setup function';
      }
      if (name.includes('fetch') || name.includes('get') || name.includes('load')) {
        return 'Data retrieval function';
      }
      if (name.includes('create') || name.includes('build') || name.includes('make')) {
        return 'Factory/constructor function';
      }
      if (name.includes('validate') || name.includes('check') || name.includes('verify')) {
        return 'Validation function';
      }
      if (name.includes('parse') || name.includes('transform') || name.includes('convert')) {
        return 'Data transformation function';
      }
      if (signature.includes('async') || name.includes('async')) {
        return 'Asynchronous operation function';
      }
      if (docstring.includes('test') || name.includes('test')) {
        return 'Test function';
      }
      return 'Utility function';
    }

    // Class purposes
    if (type === 'class') {
      if (name.includes('service')) return 'Service class';
      if (name.includes('controller')) return 'Controller class';
      if (name.includes('component')) return 'Component class';
      if (name.includes('model') || name.includes('entity')) return 'Data model class';
      if (name.includes('manager') || name.includes('handler')) return 'Management class';
      if (name.includes('client') || name.includes('api')) return 'API client class';
      if (name.includes('parser') || name.includes('processor')) return 'Processing class';
      return 'Business logic class';
    }

    // Interface/Type purposes
    if (type === 'interface' || type === 'type') {
      if (name.includes('props') || name.includes('config')) return 'Configuration interface';
      if (name.includes('response') || name.includes('result')) return 'Response type definition';
      if (name.includes('request') || name.includes('params')) return 'Request type definition';
      if (name.includes('event') || name.includes('callback')) return 'Event type definition';
      return 'Type definition';
    }

    // Variable purposes
    if (type === 'variable') {
      if (name.includes('config') || name.includes('setting')) return 'Configuration variable';
      if (name.includes('constant') || name.toUpperCase() === name) return 'Constant value';
      if (name.includes('cache') || name.includes('store')) return 'Storage variable';
      return 'State variable';
    }

    return `${type} definition`;
  }

  /**
   * Assess complexity of a symbol
   */
  private assessSymbolComplexity(symbol: PrunedSymbol): 'low' | 'medium' | 'high' {
    let complexity = 0;

    // Parameters complexity
    if (symbol.signature.includes('(')) {
      const paramCount = (symbol.signature.match(/,/g) || []).length + 1;
      complexity += Math.min(paramCount * 2, 10);
    }

    // Relationships complexity
    complexity += Math.min(symbol.relationships.length * 3, 15);

    // Body complexity
    if (symbol.compactedBody) {
      const lines = symbol.compactedBody.split('\n').length;
      complexity += Math.min(lines, 20);
    }

    // Type complexity
    if (symbol.type === 'class') complexity += 10;
    if (symbol.type === 'interface') complexity += 5;

    // Async complexity
    if (symbol.signature.includes('async')) complexity += 5;

    if (complexity < 10) return 'low';
    if (complexity < 25) return 'medium';
    return 'high';
  }

  /**
   * Extract connections from symbol relationships
   */
  private extractConnections(symbol: PrunedSymbol): string[] {
    const connections: string[] = [];

    symbol.relationships.forEach(rel => {
      switch (rel.type) {
        case 'calls':
          connections.push(`calls ${rel.target}`);
          break;
        case 'extends':
          connections.push(`extends ${rel.target}`);
          break;
        case 'imports':
          connections.push(`imports ${rel.target}`);
          break;
        case 'exports':
          connections.push('exported');
          break;
        case 'references':
          connections.push(`uses ${rel.target}`);
          break;
      }
    });

    return connections;
  }

  /**
   * Generate breadcrumb path for symbol
   */
  private generateBreadcrumb(symbol: PrunedSymbol, file: PrunedFile): string {
    const parts: string[] = [];

    // Add file path component
    const pathParts = file.absPath.split('/');
    const fileName = pathParts[pathParts.length - 1];
    parts.push(fileName);

    // Add symbol name
    parts.push(symbol.name);

    // Add type info if useful
    if (symbol.type !== 'function' && symbol.type !== 'variable') {
      parts.push(`(${symbol.type})`);
    }

    return parts.join(' → ');
  }

  /**
   * Generate tags for better categorization
   */
  private generateTags(symbol: PrunedSymbol): string[] {
    const tags: string[] = [];

    // Add type tag
    tags.push(symbol.type);

    // Add export tag
    if (symbol.isExported) tags.push('exported');

    // Add complexity tags
    tags.push(this.assessSymbolComplexity(symbol));

    // Add pattern tags
    const name = symbol.name.toLowerCase();
    if (name.includes('async')) tags.push('async');
    if (name.includes('test')) tags.push('test');
    if (name.includes('handler')) tags.push('handler');
    if (name.includes('util')) tags.push('utility');
    if (name.includes('api')) tags.push('api');
    if (name.includes('component')) tags.push('component');

    // Add framework tags based on signature
    const sig = symbol.signature.toLowerCase();
    if (sig.includes('react')) tags.push('react');
    if (sig.includes('express')) tags.push('express');
    if (sig.includes('fastify')) tags.push('fastify');

    return [...new Set(tags)]; // Remove duplicates
  }

  /**
   * Shorten verbose signatures for better readability
   */
  private shortenSignature(signature: string): string {
    // Remove excessive generic type parameters
    let shortened = signature.replace(/<[^<>]*(<[^<>]*>)*[^<>]*>/g, '<T>');

    // Shorten long parameter lists
    if (shortened.includes('(')) {
      const paramStart = shortened.indexOf('(');
      const paramEnd = shortened.lastIndexOf(')');
      const params = shortened.substring(paramStart + 1, paramEnd);

      if (params.length > 100) {
        const paramCount = (params.match(/,/g) || []).length + 1;
        shortened =
          shortened.substring(0, paramStart + 1) +
          `${paramCount} params` +
          shortened.substring(paramEnd);
      }
    }

    // Limit total length
    if (shortened.length > 150) {
      shortened = shortened.substring(0, 147) + '...';
    }

    return shortened;
  }

  /**
   * Generate file purpose description
   */
  private generateFilePurpose(file: PrunedFile): string {
    const fileName = file.absPath.split('/').pop()?.toLowerCase() || '';
    const exports = file.exports.map(e => e.toLowerCase());
    const symbols = file.symbols;

    // Check common patterns
    if (fileName.includes('index')) return 'Entry point/barrel file';
    if (fileName.includes('config')) return 'Configuration file';
    if (fileName.includes('util') || fileName.includes('helper')) return 'Utility functions';
    if (fileName.includes('type') || fileName.includes('interface')) return 'Type definitions';
    if (fileName.includes('test') || fileName.includes('spec')) return 'Test file';
    if (fileName.includes('api') || fileName.includes('route')) return 'API endpoint definitions';
    if (fileName.includes('component')) return 'UI component';
    if (fileName.includes('service')) return 'Service layer';
    if (fileName.includes('model') || fileName.includes('entity')) return 'Data model';

    // Analyze symbols
    const functions = symbols.filter(s => s.type === 'function').length;
    const classes = symbols.filter(s => s.type === 'class').length;
    const interfaces = symbols.filter(s => s.type === 'interface').length;

    if (classes > functions) return 'Class definitions';
    if (interfaces > 0 && functions === 0) return 'Type/interface definitions';
    if (functions > 0 && classes === 0) return 'Utility functions';

    return 'Mixed functionality module';
  }

  /**
   * Identify main exports from a file
   */
  private identifyMainExports(file: PrunedFile): string[] {
    return file.exports.filter(exp => exp !== 'default').slice(0, 5); // Limit to top 5
  }

  /**
   * Identify key dependencies
   */
  private identifyKeyDependencies(file: PrunedFile): string[] {
    return file.dependencies
      .filter(dep => !dep.startsWith('.') && !dep.includes('node_modules'))
      .slice(0, 5); // Limit to top 5
  }

  /**
   * Identify architectural pattern
   */
  private identifyArchitecturalPattern(file: PrunedFile): string {
    const symbols = file.symbols;
    const classes = symbols.filter(s => s.type === 'class');
    const functions = symbols.filter(s => s.type === 'function');

    if (classes.length > 0 && functions.length === 0) return 'Object-oriented';
    if (functions.length > 0 && classes.length === 0) return 'Functional';
    if (symbols.some(s => s.name.includes('Component'))) return 'Component-based';
    if (symbols.some(s => s.name.includes('Service'))) return 'Service-oriented';
    if (symbols.some(s => s.name.includes('Controller'))) return 'MVC pattern';

    return 'Mixed paradigm';
  }

  /**
   * Assess file complexity
   */
  private assessFileComplexity(file: PrunedFile): 'low' | 'medium' | 'high' {
    const symbolCount = file.symbols.length;
    const avgImportance = file.symbols.reduce((sum, s) => sum + s.importance, 0) / symbolCount;
    const relationships = file.symbols.reduce((sum, s) => sum + s.relationships.length, 0);

    const score = symbolCount * 2 + relationships + avgImportance;

    if (score < 20) return 'low';
    if (score < 50) return 'medium';
    return 'high';
  }

  /**
   * Identify project architecture
   */
  private identifyProjectArchitecture(files: PrunedFile[]): string {
    const patterns: Record<string, number> = {};

    files.forEach(file => {
      const arch = this.identifyArchitecturalPattern(file);
      patterns[arch] = (patterns[arch] || 0) + 1;
    });

    const dominant = Object.entries(patterns).sort(([, a], [, b]) => b - a)[0];

    return dominant ? dominant[0] : 'Unknown';
  }

  /**
   * Identify main components across project
   */
  private identifyMainComponents(files: PrunedFile[]): string[] {
    const components = new Set<string>();

    files.forEach(file => {
      file.exports.forEach(exp => {
        if (exp !== 'default' && exp.length > 2) {
          components.add(exp);
        }
      });
    });

    return Array.from(components).slice(0, 10);
  }

  /**
   * Identify common code patterns
   */
  private identifyCodePatterns(files: PrunedFile[]): string[] {
    const patterns: string[] = [];

    // Check for common patterns
    let hasAsync = false;
    let hasClasses = false;
    let hasInterfaces = false;
    let hasTests = false;

    files.forEach(file => {
      file.symbols.forEach(symbol => {
        if (symbol.signature.includes('async')) hasAsync = true;
        if (symbol.type === 'class') hasClasses = true;
        if (symbol.type === 'interface') hasInterfaces = true;
        if (symbol.name.includes('test')) hasTests = true;
      });
    });

    if (hasAsync) patterns.push('Async/Promise patterns');
    if (hasClasses) patterns.push('Object-oriented design');
    if (hasInterfaces) patterns.push('Type-safe interfaces');
    if (hasTests) patterns.push('Test coverage');

    return patterns;
  }

  /**
   * Estimate original token count before compression
   */
  private estimateOriginalTokenCount(files: PrunedFile[]): number {
    // Rough estimation: assume 3x compression ratio on average
    return files.reduce((sum, file) => sum + file.tokenCount, 0) * 3;
  }
}
