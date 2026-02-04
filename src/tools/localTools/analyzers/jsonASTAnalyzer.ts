/**
 * @fileOverview: AST-based JSON file analyzer
 * @module: JsonASTAnalyzer
 * @keyFunctions:
 *   - JsonASTAnalyzer: AST-based JSON analysis using schemas
 *   - analyzeJsonStructure(): Deep JSON structure analysis
 *   - detectConfigType(): Detect configuration file types
 *   - extractKeys(): Extract all keys with nesting information
 * @context: Provides comprehensive JSON analysis using AST approach
 */

import { ASTAnalyzer, ASTSymbol, ASTAnalysisResult } from './astAnalyzer';
import { logger } from '../../../utils/logger';

/**
 * JSON-specific analysis information
 */
export interface JsonAnalysisInfo {
  isArray: boolean;
  isObject: boolean;
  isPrimitive: boolean;
  primitiveType?: 'string' | 'number' | 'boolean' | 'null';
  depth: number;
  keyCount: number;
  arrayLength?: number;
  configType?: string; // package.json, tsconfig.json, etc.
  topLevelKeys: string[];
  nestedStructure: Record<string, any>;
}

/**
 * JSON AST Analyzer
 */
export class JsonASTAnalyzer extends ASTAnalyzer {
  constructor() {
    super('json');
  }

  /**
   * Parse JSON content into AST structure
   */
  protected parseLanguageSpecific(content: string): any {
    try {
      const parsed = JSON.parse(content);
      return this.buildASTFromJson(parsed, 'document');
    } catch (error) {
      logger.error('Failed to parse JSON', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Build AST structure from parsed JSON
   */
  private buildASTFromJson(value: any, nodeType: string, key?: string): any {
    const node: any = {
      type: nodeType,
      text: JSON.stringify(value, null, 2).slice(0, 100), // Truncate for display
      startLine: 0, // Would need source map for accurate positions
      endLine: 0,
      startColumn: 0,
      endColumn: 0,
      children: [],
      fields: {},
    };

    if (key !== undefined) {
      node.fields.key = key;
    }

    // Handle different JSON types
    if (value === null) {
      node.type = 'null';
    } else if (typeof value === 'boolean') {
      node.type = value ? 'true' : 'false';
    } else if (typeof value === 'number') {
      node.type = 'number';
      node.fields.value = value;
    } else if (typeof value === 'string') {
      node.type = 'string';
      node.fields.value = value;
      node.text = value;
    } else if (Array.isArray(value)) {
      node.type = 'array';
      node.children = value.map((item, index) =>
        this.buildASTFromJson(item, this.inferNodeType(item), index.toString())
      );
    } else if (typeof value === 'object') {
      node.type = 'object';
      // Create pair nodes with the value as a child
      node.children = Object.entries(value).map(([k, v]) => {
        const pairNode = {
          type: 'pair',
          text: `${k}: ${JSON.stringify(v).slice(0, 50)}`,
          startLine: 0,
          endLine: 0,
          startColumn: 0,
          endColumn: 0,
          fields: { key: k },
          children: [this.buildASTFromJson(v, this.inferNodeType(v))],
        };
        return pairNode;
      });
    }

    return node;
  }

  /**
   * Infer node type from JSON value
   */
  private inferNodeType(value: any): string {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    return 'unknown';
  }

  /**
   * Analyze JSON file with enhanced information
   */
  public async analyzeJsonFile(filePath: string): Promise<JsonAnalysisInfo | null> {
    const result = await this.analyzeFile(filePath);
    if (!result) return null;

    return this.extractJsonInfo(result);
  }

  /**
   * Analyze JSON content with enhanced information
   */
  public async analyzeJsonContent(content: string): Promise<JsonAnalysisInfo | null> {
    const result = await this.analyzeContent(content);
    if (!result) return null;

    return this.extractJsonInfo(result);
  }

  /**
   * Extract JSON-specific information from analysis result
   */
  private extractJsonInfo(result: ASTAnalysisResult): JsonAnalysisInfo {
    const ast = result.raw;
    const rootType = ast?.type || 'unknown';

    const info: JsonAnalysisInfo = {
      isArray: rootType === 'array',
      isObject: rootType === 'object',
      isPrimitive: ['string', 'number', 'true', 'false', 'null'].includes(rootType),
      depth: result.structure.depth,
      keyCount: 0,
      topLevelKeys: [],
      nestedStructure: {},
    };

    // Handle primitives
    if (info.isPrimitive) {
      if (rootType === 'true' || rootType === 'false') {
        info.primitiveType = 'boolean';
      } else if (rootType === 'null') {
        info.primitiveType = 'null';
      } else if (rootType === 'number') {
        info.primitiveType = 'number';
      } else if (rootType === 'string') {
        info.primitiveType = 'string';
      }
      return info;
    }

    // Handle arrays
    if (info.isArray && ast?.children) {
      info.arrayLength = ast.children.length;
      return info;
    }

    // Handle objects
    if (info.isObject && ast?.children) {
      const keys = ast.children
        .filter((child: any) => child.type === 'pair' && child.fields?.key)
        .map((child: any) => child.fields.key);

      info.keyCount = keys.length;
      info.topLevelKeys = keys;

      // Build nested structure map
      info.nestedStructure = this.buildStructureMap(ast);

      // Detect configuration file type
      info.configType = this.detectConfigType(keys);
    }

    return info;
  }

  /**
   * Build a map of nested structure
   */
  private buildStructureMap(ast: any, prefix: string = ''): Record<string, any> {
    const structure: Record<string, any> = {};

    if (!ast?.children) return structure;

    for (const child of ast.children) {
      if (child.type === 'pair' && child.fields?.key) {
        const key = child.fields.key;
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (child.children && child.children.length > 0) {
          const valueNode = child.children[0];
          structure[fullKey] = {
            type: valueNode.type,
            depth: prefix.split('.').length + 1,
          };

          // Recurse for nested objects
          if (valueNode.type === 'object') {
            Object.assign(structure, this.buildStructureMap(valueNode, fullKey));
          }
        }
      }
    }

    return structure;
  }

  /**
   * Detect configuration file type based on keys
   */
  private detectConfigType(keys: string[]): string | undefined {
    const keySet = new Set(keys);

    // Package.json detection
    if (keySet.has('name') && keySet.has('version')) {
      if (keySet.has('dependencies') || keySet.has('devDependencies')) {
        return 'package.json';
      }
    }

    // tsconfig.json detection
    if (keySet.has('compilerOptions')) {
      return 'tsconfig.json';
    }

    // ESLint config detection
    if (keySet.has('rules') || keySet.has('extends')) {
      if (keySet.has('env') || keySet.has('parser')) {
        return '.eslintrc.json';
      }
    }

    // Jest config detection
    if (keySet.has('testMatch') || keySet.has('testEnvironment')) {
      return 'jest.config.json';
    }

    // Prettier config detection
    if (keySet.has('printWidth') || keySet.has('tabWidth') || keySet.has('singleQuote')) {
      return '.prettierrc.json';
    }

    // VS Code settings detection
    if (keys.some(k => k.startsWith('editor.') || k.startsWith('workbench.'))) {
      return 'settings.json';
    }

    return undefined;
  }

  /**
   * Extract symbols from JSON AST
   */
  protected extractSymbols(ast: any): ASTSymbol[] {
    const symbols: ASTSymbol[] = [];

    const extractFromNode = (node: any, path: string[] = []) => {
      if (!node) return;

      if (node.type === 'pair' && node.fields?.key) {
        const key = node.fields.key;
        const currentPath = [...path, key];

        symbols.push({
          name: currentPath.join('.'),
          type: 'key',
          line: node.startLine || 0,
          column: node.startColumn || 0,
          scope: path.length > 0 ? path.join('.') : 'root',
          metadata: {
            depth: currentPath.length,
            valueType: node.children?.[0]?.type || 'unknown',
          },
        });

        // Recurse into children
        if (node.children) {
          for (const child of node.children) {
            extractFromNode(child, currentPath);
          }
        }
      } else if (node.children) {
        // Continue traversing
        for (const child of node.children) {
          extractFromNode(child, path);
        }
      }
    };

    extractFromNode(ast);
    return symbols;
  }
}

/**
 * Convenience function to create and use JSON analyzer
 */
export async function analyzeJsonFile(filePath: string): Promise<JsonAnalysisInfo | null> {
  const analyzer = new JsonASTAnalyzer();
  await analyzer.initialize();
  return analyzer.analyzeJsonFile(filePath);
}

/**
 * Convenience function to analyze JSON content
 */
export async function analyzeJsonContent(content: string): Promise<JsonAnalysisInfo | null> {
  const analyzer = new JsonASTAnalyzer();
  await analyzer.initialize();
  return analyzer.analyzeJsonContent(content);
}
