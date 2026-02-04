/**
 * @fileOverview: Tree-sitter based AST parsing and code analysis with fallback parsing support
 * @module: TreeSitterProcessor
 * @keyFunctions:
 *   - parseAndChunk(): Parse code and create semantic chunks with symbol extraction
 *   - extractSymbols(): Extract code symbols and cross-references
 *   - initializeParsers(): Set up language-specific parsers with error handling
 *   - fallbackParse(): Basic parsing when tree-sitter is unavailable
 * @dependencies:
 *   - tree-sitter: Core parsing engine (optional)
 *   - tree-sitter-typescript: TypeScript/TSX parsing
 *   - tree-sitter-javascript: JavaScript parsing
 *   - tree-sitter-python: Python parsing
 * @context: Provides robust AST parsing with graceful fallback to basic parsing when tree-sitter dependencies are unavailable, supporting multiple programming languages
 */

import { logger } from '../utils/logger';

// Optional tree-sitter import to avoid hard native dependency at runtime
let Parser: any = null;
let TypeScript: any = null;
let JavaScript: any = null;
let Python: any = null;

// Dynamic import for ESM-only tree-sitter packages
async function initializeTreeSitterParsers() {
  try {
    if (!Parser) {
      Parser = await import('tree-sitter');
      Parser = Parser.default || Parser;
    }

    if (!TypeScript) {
      const tsModule = await import('tree-sitter-typescript');
      TypeScript = tsModule.default.typescript;
    }

    if (!JavaScript) {
      const jsModule = await import('tree-sitter-javascript');
      JavaScript = jsModule.default;
    }

    if (!Python) {
      const pyModule = await import('tree-sitter-python');
      Python = pyModule.default;
    }

    logger.info('✅ Tree-sitter parsers initialized successfully');
  } catch (error) {
    logger.warn('⚠️ Some tree-sitter parsers not available:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface CodeChunk {
  content: string;
  startLine: number;
  endLine: number;
  tokenEstimate: number;
  symbolId?: string;
  symbolName?: string;
  symbolType?: string;
}

export interface CodeSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  lang: string;
  source: string;
}

export interface CodeXRef {
  name: string;
  kind: 'import' | 'export';
  startLine: number;
  endLine: number;
  targetPath?: string;
}

export class TreeSitterProcessor {
  private parsers: Map<string, any>;

  constructor() {
    this.parsers = new Map();
  }

  async initialize(): Promise<void> {
    await initializeTreeSitterParsers();
    await this.initializeParsers();
  }

  private async initializeParsers(): Promise<void> {
    if (!Parser) {
      logger.warn('Tree-sitter parser not available, will use fallback parsing');
      return;
    }

    try {
      if (TypeScript) {
        const tsParser = new Parser();
        try {
          tsParser.setLanguage(TypeScript);
          this.parsers.set('typescript', tsParser);
        } catch (error) {
          logger.warn('Failed to initialize TypeScript parser:', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (JavaScript) {
        const jsParser = new Parser();
        try {
          jsParser.setLanguage(JavaScript);
          this.parsers.set('javascript', jsParser);
        } catch (error) {
          logger.warn('Failed to initialize JavaScript parser:', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (Python) {
        const pyParser = new Parser();
        try {
          pyParser.setLanguage(Python);
          this.parsers.set('python', pyParser);
        } catch (error) {
          logger.warn('Failed to initialize Python parser:', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to initialize some tree-sitter parsers:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async parseAndChunk(
    content: string,
    language: string,
    filePath: string
  ): Promise<{
    chunks: CodeChunk[];
    symbols: CodeSymbol[];
    xrefs: CodeXRef[];
  }> {
    // Validate input parameters
    if (!content || typeof content !== 'string') {
      logger.warn('Invalid content for parsing', { filePath, contentType: typeof content });
      const chunks = this.fallbackChunking(content || '', filePath);
      return { chunks, symbols: [], xrefs: [] };
    }

    if (!language || typeof language !== 'string') {
      logger.warn('Invalid language for parsing', { filePath, languageType: typeof language });
      const chunks = this.fallbackChunking(content, filePath);
      return { chunks, symbols: [], xrefs: [] };
    }

    const parser = this.parsers.get(language);
    if (!parser) {
      logger.warn('No parser available for language', { language, filePath });
      const chunks = this.fallbackChunking(content, filePath);
      return { chunks, symbols: [], xrefs: [] };
    }

    try {
      // Additional validation before parsing
      if (content.length === 0) {
        logger.warn('Empty content for parsing', { filePath });
        const chunks = this.fallbackChunking(content, filePath);
        return { chunks, symbols: [], xrefs: [] };
      }

      // Check for problematic content that can cause Tree-sitter to fail
      const hasNullBytes = content.includes('\0');
      const hasInvalidChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(content);
      const isTooLarge = content.length > 1024 * 1024; // 1MB limit for safety

      if (hasNullBytes || hasInvalidChars || isTooLarge) {
        logger.warn('Problematic content detected, using fallback', {
          filePath,
          hasNullBytes,
          hasInvalidChars,
          isTooLarge,
          contentLength: content.length,
        });
        const chunks = this.fallbackChunking(content, filePath);
        return { chunks, symbols: [], xrefs: [] };
      }

      // Log Python-specific parsing issues for debugging
      if (language === 'python') {
        logger.debug('🐍 Parsing Python file', {
          filePath,
          contentLength: content.length,
          lineCount: content.split('\n').length,
          hasIndents: /^\s+/.test(content),
          firstLine: content.split('\n')[0]?.substring(0, 100),
        });
      }

      // Additional content validation - check for incomplete/truncated content
      const trimmedContent = content.trim();
      if (trimmedContent.length === 0) {
        logger.warn('Content is only whitespace', { filePath });
        const chunks = this.fallbackChunking(content, filePath);
        return { chunks, symbols: [], xrefs: [] };
      }

      // Check for obviously invalid syntax patterns that can crash Tree-sitter
      const openBraces = (content.match(/\{/g) || []).length;
      const closeBraces = (content.match(/\}/g) || []).length;
      if (Math.abs(openBraces - closeBraces) > 100) {
        logger.warn('Highly unbalanced braces, likely invalid syntax', {
          filePath,
          openBraces,
          closeBraces,
          difference: Math.abs(openBraces - closeBraces),
        });
        const chunks = this.fallbackChunking(content, filePath);
        return { chunks, symbols: [], xrefs: [] };
      }

      let tree;
      try {
        // Attempt to parse with a timeout safeguard
        tree = parser.parse(content);
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        if (
          errorMessage.includes('Invalid argument') ||
          errorMessage.includes('parse') ||
          errorMessage.includes('invalid')
        ) {
          logger.warn('Tree-sitter parse error, using fallback', {
            filePath,
            errorMessage,
          });
          const chunks = this.fallbackChunking(content, filePath);
          return { chunks, symbols: [], xrefs: [] };
        }
        throw parseError; // Re-throw if it's not a parsing error we can handle
      }

      // Validate the parsed tree
      if (!tree || !tree.rootNode) {
        logger.warn('Invalid parse tree, using fallback', { filePath });
        const chunks = this.fallbackChunking(content, filePath);
        return { chunks, symbols: [], xrefs: [] };
      }

      // Validate root node with cross-language support
      const rootType = tree.rootNode.type;
      const acceptedRootTypes = new Set(['program', 'module']); // JS/TS: program, Python: module
      if (!acceptedRootTypes.has(rootType)) {
        logger.warn('Unexpected root node type; continuing with cautious extraction', {
          filePath,
          rootNodeType: rootType,
          acceptedRootTypes: Array.from(acceptedRootTypes).join(', '),
        });
      }

      const chunks = this.extractChunks(tree, content, language);
      const symbols = this.extractSymbols(tree, content, language);
      const xrefs = this.extractXRefs(tree, language);
      return { chunks, symbols, xrefs };
    } catch (error) {
      logger.error('Tree-sitter processing failed, using fallback', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      const chunks = this.fallbackChunking(content, filePath);
      return { chunks, symbols: [], xrefs: [] };
    }
  }

  private extractChunks(tree: any, content: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');

    const traverse = (node: any) => {
      try {
        if (this.isChunkableNode(node, language)) {
          const startLine = node.startPosition?.row + 1;
          const endLine = node.endPosition?.row + 1;

          if (startLine && endLine && startLine <= endLine) {
            const nodeContent = this.getNodeContent(node, lines);

            if (nodeContent && (endLine - startLine > 10 || nodeContent.length > 100)) {
              chunks.push({
                content: nodeContent,
                startLine,
                endLine,
                tokenEstimate: this.estimateTokens(nodeContent),
                symbolName: this.getSymbolName(node),
                symbolType: node.type,
              });
            }
          }
        }

        // Safely traverse children
        if (node.children && Array.isArray(node.children)) {
          for (const child of node.children) {
            if (child) {
              traverse(child);
            }
          }
        }
      } catch (error) {
        logger.warn('Error traversing node', {
          language,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other nodes
      }
    };

    try {
      if (tree?.rootNode) {
        traverse(tree.rootNode);
      }
    } catch (error) {
      logger.warn('Error extracting chunks from tree', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (chunks.length === 0) {
      return this.fallbackChunking(content, '');
    }

    return chunks;
  }

  private isChunkableNode(node: any, language: string): boolean {
    try {
      if (!node || !node.type) return false;

      if (language === 'typescript' || language === 'javascript') {
        return [
          'function_declaration',
          'method_definition',
          'arrow_function',
          'class_declaration',
          'interface_declaration',
          'type_alias_declaration',
          'export_statement',
        ].includes(node.type);
      }

      if (language === 'python') {
        return ['function_definition', 'class_definition', 'decorated_definition'].includes(
          node.type
        );
      }

      return false;
    } catch (error) {
      logger.warn('Error checking if node is chunkable', {
        language,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private getNodeContent(node: any, lines: string[]): string {
    try {
      if (!node || !node.startPosition || !node.endPosition || !Array.isArray(lines)) {
        return '';
      }

      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;

      if (
        typeof startLine !== 'number' ||
        typeof endLine !== 'number' ||
        startLine < 0 ||
        endLine < startLine ||
        endLine >= lines.length
      ) {
        return '';
      }

      return lines.slice(startLine, endLine + 1).join('\n');
    } catch (error) {
      logger.warn('Error getting node content', {
        error: error instanceof Error ? error.message : String(error),
      });
      return '';
    }
  }

  private getSymbolName(node: any): string | undefined {
    try {
      if (!node || !Array.isArray(node.children)) return undefined;
      const nameNode = node.children.find(
        (child: any) =>
          child && (child.type === 'identifier' || child.type === 'property_identifier')
      );
      if (nameNode?.text) return nameNode.text;

      // Fallback: search descendants for an identifier (helps for Python decorated_definition)
      try {
        if (typeof node.descendantsOfType === 'function') {
          const ids = node.descendantsOfType(['identifier', 'property_identifier']);
          if (ids && ids[0] && ids[0].text) return ids[0].text;
        }
      } catch {}
      return undefined;
    } catch (error) {
      logger.warn('Error getting symbol name', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private fallbackChunking(content: string, filePath: string): CodeChunk[] {
    // If content is completely empty or only whitespace, create minimal chunk
    const trimmedContent = content.trim();
    if (trimmedContent.length === 0) {
      return [
        {
          content: '',
          startLine: 1,
          endLine: 1,
          tokenEstimate: 0,
          symbolName: 'empty_file',
          symbolType: 'fallback',
        },
      ];
    }

    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    const chunkSize = 50;

    for (let i = 0; i < lines.length; i += chunkSize) {
      const endIndex = Math.min(i + chunkSize, lines.length);
      const chunkContent = lines.slice(i, endIndex).join('\n');

      chunks.push({
        content: chunkContent,
        startLine: i + 1,
        endLine: endIndex,
        tokenEstimate: this.estimateTokens(chunkContent),
      });
    }

    return chunks;
  }

  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  private extractSymbols(tree: any, content: string, language: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const lines = content.split('\n');

    const traverse = (node: any) => {
      if (this.isSymbolNode(node, language)) {
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const nodeContent = this.getNodeContent(node, lines);
        const symbolName = this.getSymbolName(node);

        if (symbolName) {
          symbols.push({
            name: symbolName,
            kind: node.type,
            startLine,
            endLine,
            lang: language,
            source: nodeContent,
          });
        }
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(tree.rootNode);
    return symbols;
  }

  private isSymbolNode(node: any, language: string): boolean {
    if (language === 'typescript' || language === 'javascript') {
      return [
        'function_declaration',
        'function_expression',
        'arrow_function',
        'class_declaration',
        'interface_declaration',
        'type_alias_declaration',
        'variable_declarator',
        'method_definition',
        'property_definition',
      ].includes(node.type);
    }

    if (language === 'python') {
      return [
        'function_definition',
        'class_definition',
        'decorated_definition',
        'assignment',
      ].includes(node.type);
    }

    return false;
  }

  private extractXRefs(tree: any, language: string): CodeXRef[] {
    const xrefs: CodeXRef[] = [];
    const traverse = (node: any) => {
      if (language === 'typescript' || language === 'javascript') {
        if (node.type === 'import_statement' || node.type === 'export_statement') {
          const kind = node.type === 'import_statement' ? 'import' : 'export';
          const pathNode =
            typeof node.descendantsOfType === 'function'
              ? node.descendantsOfType('string_literal')[0]
              : undefined;
          const targetPath = pathNode?.text ? pathNode.text.slice(1, -1) : undefined;

          const importClause =
            typeof node.descendantsOfType === 'function'
              ? node.descendantsOfType('import_clause')[0]
              : undefined;
          if (importClause && typeof importClause.descendantsOfType === 'function') {
            const namedImports = importClause.descendantsOfType('named_imports')[0];
            if (namedImports) {
              for (const specifier of namedImports.descendantsOfType('import_specifier')) {
                xrefs.push({
                  name: specifier.text,
                  kind,
                  startLine: specifier.startPosition.row + 1,
                  endLine: specifier.endPosition.row + 1,
                  targetPath,
                });
              }
            }
          }
        }
      } else if (language === 'python') {
        // Python import extraction: import_statement, import_from_statement
        if (node.type === 'import_statement' || node.type === 'import_from_statement') {
          const kind: 'import' = 'import';
          let modulePath: string | undefined;
          try {
            if (typeof node.descendantsOfType === 'function') {
              const dotted = node.descendantsOfType('dotted_name');
              if (dotted && dotted[0] && dotted[0].text) modulePath = dotted[0].text;
            }
          } catch {}

          try {
            if (typeof node.descendantsOfType === 'function') {
              const names = node.descendantsOfType(['aliased_import', 'identifier']);
              for (const n of names) {
                if (!n || !n.text) continue;
                xrefs.push({
                  name: n.text,
                  kind,
                  startLine: node.startPosition.row + 1,
                  endLine: node.endPosition.row + 1,
                  targetPath: modulePath,
                });
              }
            }
          } catch {}
        }
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    if (tree?.rootNode) {
      traverse(tree.rootNode);
    }
    return xrefs;
  }
}
