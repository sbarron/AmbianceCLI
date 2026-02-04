/**
 * @fileOverview: Abstract Syntax Tree analysis for code context compression with multi-language support
 * @module: ASTParser
 * @keyFunctions:
 *   - parseFile(): Parse source code into structured AST representation
 *   - extractSymbols(): Extract functions, classes, interfaces and key code constructs
 *   - analyzeDependencies(): Map imports, exports and code relationships
 *   - compressCodeBody(): Remove redundant patterns while preserving semantics
 *   - pruneAST(): Optimize AST structure for token efficiency
 * @dependencies:
 *   - @babel/parser: TypeScript/JavaScript parsing with robust error handling
 *   - @babel/traverse: AST traversal and analysis
 *   - tree-sitter: Multi-language parsing (optional dependency)
 *   - tree-sitter-typescript: TypeScript/TSX parsing support
 *   - tree-sitter-javascript: JavaScript parsing support
 *   - tree-sitter-python: Python parsing support
 * @context: Core parsing engine that transforms source code into structured representations for semantic compression, supporting multiple languages with graceful fallbacks
 */

import { parse as babelParse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { readFile } from 'fs/promises';
import { SupportedLanguage } from './fileDiscovery';
import { logger } from '../../utils/logger';

// Optional tree-sitter import
let Parser: any = null;
let TypeScript: any = null;
let JavaScript: any = null;
let Python: any = null;

// Dynamic import for ESM-only tree-sitter packages
async function initializeAstParsers() {
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

    logger.debug('✅ AST parsers initialized successfully');
  } catch (error) {
    logger.warn('⚠️ AST parsers not available, using Babel fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Simple parser creation function to replace missing getParser
function getParser(language: string): any | undefined {
  if (!TypeScript && !JavaScript && !Python) {
    return undefined;
  }

  const parser = new Parser();

  switch (language.toLowerCase()) {
    case 'typescript':
      if (TypeScript) {
        parser.setLanguage(TypeScript);
        return parser;
      }
      break;
    case 'javascript':
      if (JavaScript) {
        parser.setLanguage(JavaScript);
        return parser;
      }
      break;
    case 'python':
      if (Python) {
        parser.setLanguage(Python);
        return parser;
      }
      break;
  }

  return undefined;
}

// Simple definitions parsing function to replace missing parseDefinitions
function parseDefinitions(content: string, language: string): any[] {
  const parser = getParser(language);
  if (!parser) {
    return [];
  }

  try {
    const tree = parser.parse(content);
    // Basic symbol extraction - this is a simplified version
    return extractSymbolsFromTree(tree, content);
  } catch (error) {
    return [];
  }
}

// Helper function to extract symbols from tree-sitter tree
function extractSymbolsFromTree(tree: any, content: string): any[] {
  const symbols: any[] = [];
  const lines = content.split('\n');

  function walk(node: any) {
    if (
      node.type === 'function_declaration' ||
      node.type === 'class_declaration' ||
      node.type === 'interface_declaration'
    ) {
      const nameNode = node.child(1); // Usually the name is the second child
      if (nameNode) {
        const startPos = node.startPosition;
        const endPos = node.endPosition;

        symbols.push({
          name: nameNode.text,
          type: node.type.replace('_declaration', ''),
          startLine: startPos.row + 1,
          endLine: endPos.row + 1,
          startColumn: startPos.column,
          endColumn: endPos.column,
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);
  return symbols;
}

export interface Symbol {
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'export' | 'import' | 'method';
  signature: string;
  startLine: number;
  endLine: number;
  docstring?: string;
  isExported: boolean;
  isAsync?: boolean;
  parameters?: Parameter[];
  returnType?: string;
  body?: string;
  className?: string;
  isMethod?: boolean;
}

export interface Parameter {
  name: string;
  type?: string;
  optional?: boolean;
  defaultValue?: string;
}

export interface ParsedFile {
  absPath: string; // 🔑 Use absolute path as authoritative
  language: SupportedLanguage;
  symbols: Symbol[];
  imports: ImportStatement[];
  exports: ExportStatement[];
  errors: string[];
}

export interface ImportStatement {
  source: string;
  specifiers: Array<{
    name: string;
    alias?: string;
    type: 'default' | 'named' | 'namespace';
  }>;
}

export interface ExportStatement {
  name: string;
  type: 'default' | 'named';
  source?: string;
}

export class ASTParser {
  private parsers: Map<string, any> = new Map();

  /**
   * Parse a file and extract semantic information
   */
  async parseFile(filePath: string, language: SupportedLanguage): Promise<ParsedFile> {
    try {
      // 🔑 Use absolute path directly - never rebuild from project root
      const content = await readFile(filePath, 'utf-8');

      switch (language) {
        case 'typescript':
        case 'javascript':
          return await this.parseJavaScriptTypeScript(filePath, content, language);

        case 'python':
          return await this.parsePython(filePath, content);

        default:
          // For unsupported languages, use tree-sitter fallback
          return await this.parseWithTreeSitter(filePath, content, language);
      }
    } catch (error) {
      logger.warn('Failed to parse file', {
        filePath,
        error: (error as Error).message,
        parser: 'babel',
      });
      return {
        absPath: filePath,
        language,
        symbols: [],
        imports: [],
        exports: [],
        errors: [(error as Error).message],
      };
    }
  }

  /**
   * Dispose of all parsers and clean up resources
   */
  dispose(): void {
    // Clean up tree-sitter parsers
    for (const parser of this.parsers.values()) {
      try {
        // Tree-sitter parsers don't have a delete method, just clear the reference
        // The garbage collector will handle cleanup
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    this.parsers.clear();
  }

  /**
   * Parse JavaScript/TypeScript files using Babel
   */
  private async parseJavaScriptTypeScript(
    filePath: string,
    content: string,
    language: SupportedLanguage
  ): Promise<ParsedFile> {
    const symbols: Symbol[] = [];
    const imports: ImportStatement[] = [];
    const exports: ExportStatement[] = [];
    const errors: string[] = [];

    try {
      const ast = babelParse(content, {
        sourceType: 'module',
        plugins: [
          'typescript',
          'jsx',
          'decorators-legacy',
          'classProperties',
          'objectRestSpread',
          'functionBind',
          'exportDefaultFrom',
          'exportNamespaceFrom',
          'dynamicImport',
          'nullishCoalescingOperator',
          'optionalChaining',
        ],
        errorRecovery: true,
      });

      // Traverse the AST and extract symbols
      const self = this;
      traverse(ast, {
        // Function declarations
        FunctionDeclaration(path) {
          const node = path.node;
          if (node.id) {
            symbols.push({
              name: node.id.name,
              type: 'function',
              signature: self.generateFunctionSignature(node),
              startLine: node.loc?.start.line || 1,
              endLine: node.loc?.end.line || 1,
              docstring: self.extractLeadingComments(path),
              isExported: self.isExported(path),
              isAsync: node.async,
              parameters: self.extractParameters(node.params),
              returnType: self.extractReturnType(node),
              body: self.extractFunctionBody(node),
            });
          }
        },

        // Arrow functions and function expressions assigned to variables
        VariableDeclarator(path) {
          const node = path.node;
          if (
            t.isIdentifier(node.id) &&
            (t.isFunctionExpression(node.init) || t.isArrowFunctionExpression(node.init))
          ) {
            const func = node.init;
            symbols.push({
              name: node.id.name,
              type: 'function',
              signature: self.generateArrowFunctionSignature(node.id.name, func),
              startLine: node.loc?.start.line || 1,
              endLine: node.loc?.end.line || 1,
              docstring: self.extractLeadingComments(path),
              isExported: self.isExported(path.parentPath),
              isAsync: func.async,
              parameters: self.extractParameters(func.params),
              returnType: self.extractReturnType(func),
              body: self.extractFunctionBody(func),
            });
          } else if (t.isIdentifier(node.id)) {
            // Regular variables - only chunk if they're architecturally significant
            const signature = `${node.id.name}: ${self.inferType(node.init)}`;
            const docstring = self.extractLeadingComments(path);

            if (self.shouldChunkVariable(node.id.name, signature, docstring)) {
              symbols.push({
                name: node.id.name,
                type: 'variable',
                signature,
                startLine: node.loc?.start.line || 1,
                endLine: node.loc?.end.line || 1,
                docstring,
                isExported: self.isExported(path.parentPath),
              });
            }
          }
        },

        // Class declarations
        ClassDeclaration(path) {
          const node = path.node;
          if (node.id) {
            const methodNames: string[] = [];

            // Extract individual method symbols with full signatures
            node.body.body.forEach(member => {
              if (t.isClassMethod(member) && t.isIdentifier(member.key)) {
                const methodName = member.key.name;
                methodNames.push(methodName);

                // Create individual method symbol with full signature
                const params = self.extractMethodParameters(member.params);
                const returnType = self.extractReturnType(member);
                const signature = self.generateMethodSignature(member, methodName);

                symbols.push({
                  name: methodName,
                  type: 'method',
                  signature,
                  startLine: member.loc?.start.line || 1,
                  endLine: member.loc?.end.line || 1,
                  docstring: self.extractLeadingComments({ node: member, parent: path }),
                  isExported: self.isExported(path), // Methods inherit class export status
                  isAsync: member.async || false,
                  parameters: params,
                  returnType: returnType,
                  body: self.extractFunctionBody(member),
                  className: node.id?.name || 'UnknownClass',
                  isMethod: true,
                });
              }
            });

            // Keep the class symbol with method names for backward compatibility
            symbols.push({
              name: node.id.name,
              type: 'class',
              signature: `class ${node.id.name}${node.superClass ? ` extends ${self.nodeToString(node.superClass)}` : ''}`,
              startLine: node.loc?.start.line || 1,
              endLine: node.loc?.end.line || 1,
              docstring: self.extractLeadingComments(path),
              isExported: self.isExported(path),
              body: methodNames.length > 0 ? `Methods: ${methodNames.join(', ')}` : undefined,
            });
          }
        },

        // Interface declarations (TypeScript)
        TSInterfaceDeclaration(path) {
          const node = path.node;
          symbols.push({
            name: node.id.name,
            type: 'interface',
            signature: `interface ${node.id.name}`,
            startLine: node.loc?.start.line || 1,
            endLine: node.loc?.end.line || 1,
            docstring: self.extractLeadingComments(path),
            isExported: self.isExported(path),
          });
        },

        // Type aliases (TypeScript)
        TSTypeAliasDeclaration(path) {
          const node = path.node;
          symbols.push({
            name: node.id.name,
            type: 'type',
            signature: `type ${node.id.name} = ${self.nodeToString(node.typeAnnotation)}`,
            startLine: node.loc?.start.line || 1,
            endLine: node.loc?.end.line || 1,
            docstring: self.extractLeadingComments(path),
            isExported: self.isExported(path),
          });
        },

        // Import statements
        ImportDeclaration(path) {
          const node = path.node;
          const specifiers = node.specifiers.map(spec => {
            if (t.isImportDefaultSpecifier(spec)) {
              return { name: spec.local.name, type: 'default' as const };
            } else if (t.isImportNamespaceSpecifier(spec)) {
              return { name: spec.local.name, type: 'namespace' as const };
            } else if (t.isImportSpecifier(spec)) {
              return {
                name: t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value,
                alias: spec.local.name,
                type: 'named' as const,
              };
            }
            return { name: 'unknown', type: 'named' as const };
          });

          imports.push({
            source: node.source.value,
            specifiers,
          });
        },

        // Export statements
        ExportNamedDeclaration(path) {
          const node = path.node;
          if (node.declaration) {
            if (t.isFunctionDeclaration(node.declaration) && node.declaration.id) {
              exports.push({ name: node.declaration.id.name, type: 'named' });
            } else if (t.isClassDeclaration(node.declaration) && node.declaration.id) {
              exports.push({ name: node.declaration.id.name, type: 'named' });
            } else if (t.isVariableDeclaration(node.declaration)) {
              node.declaration.declarations.forEach(decl => {
                if (t.isIdentifier(decl.id)) {
                  exports.push({ name: decl.id.name, type: 'named' });
                }
              });
            }
          }

          if (node.specifiers) {
            node.specifiers.forEach(spec => {
              if (t.isExportSpecifier(spec)) {
                const name = t.isIdentifier(spec.exported)
                  ? spec.exported.name
                  : spec.exported.value;
                exports.push({
                  name,
                  type: 'named',
                  source: node.source?.value,
                });
              }
            });
          }
        },

        ExportDefaultDeclaration(path) {
          const node = path.node;
          let name = 'default';

          if (t.isFunctionDeclaration(node.declaration) && node.declaration.id) {
            name = node.declaration.id.name;
          } else if (t.isClassDeclaration(node.declaration) && node.declaration.id) {
            name = node.declaration.id.name;
          } else if (t.isIdentifier(node.declaration)) {
            name = node.declaration.name;
          }

          exports.push({ name, type: 'default' });
        },
      });
    } catch (error) {
      errors.push(`Babel parsing error: ${(error as Error).message}`);
    }

    return {
      absPath: filePath,
      language,
      symbols,
      imports,
      exports,
      errors,
    };
  }

  /**
   * Parse Python files using tree-sitter
   */
  private async parsePython(filePath: string, content: string): Promise<ParsedFile> {
    // For now, use tree-sitter fallback for Python
    // NOTE: Python parsing currently uses generic tree-sitter approach
    // Could be enhanced with Python-specific AST analysis for better symbol extraction
    return this.parseWithTreeSitter(filePath, content, 'python');
  }

  /**
   * Fallback parsing using tree-sitter with cached parsers
   */
  private async parseWithTreeSitter(
    filePath: string,
    content: string,
    language: SupportedLanguage
  ): Promise<ParsedFile> {
    const symbols: Symbol[] = [];
    const imports: ImportStatement[] = [];
    const exports: ExportStatement[] = [];
    const errors: string[] = [];

    try {
      // Use existing tree-sitter logic with cached parsers
      const langCode = this.languageToTreeSitterCode(language);
      if (langCode && Parser) {
        // Get or create cached parser
        let parser = this.parsers.get(langCode);
        if (!parser) {
          const newParser = getParser(langCode);
          if (newParser) {
            parser = newParser;
            this.parsers.set(langCode, parser);
          }
        }

        if (parser) {
          const tree = parser.parse(content);
          const definitions = this.extractDefinitionsFromTree(tree.rootNode);

          const lines = content.split('\n');
          definitions.forEach(def => {
            const text = lines.slice(def.startLine - 1, def.endLine).join('\n');
            const name = this.extractNameFromDefinition(text);

            symbols.push({
              name: name || 'anonymous',
              type: text.includes('class') ? 'class' : 'function',
              signature: text.split('\n')[0].trim(),
              startLine: def.startLine,
              endLine: def.endLine,
              isExported: text.includes('export'),
              body: text,
            });
          });
        } else {
          // Fallback to the original method
          const definitions = parseDefinitions(content, langCode);
          if (definitions) {
            const lines = content.split('\n');
            definitions.forEach((def: any) => {
              const text = lines.slice(def.startLine - 1, def.endLine).join('\n');
              const name = this.extractNameFromDefinition(text);

              symbols.push({
                name: name || 'anonymous',
                type: text.includes('class') ? 'class' : 'function',
                signature: text.split('\n')[0].trim(),
                startLine: def.startLine,
                endLine: def.endLine,
                isExported: text.includes('export'),
                body: text,
              });
            });
          }
        }
      }
    } catch (error) {
      errors.push(`Tree-sitter parsing error: ${(error as Error).message}`);
    }

    return {
      absPath: filePath,
      language,
      symbols,
      imports,
      exports,
      errors,
    };
  }

  /**
   * Extract definitions from tree-sitter tree
   */
  private extractDefinitionsFromTree(node: any): Array<{ startLine: number; endLine: number }> {
    const definitions: Array<{ startLine: number; endLine: number }> = [];

    function traverse(n: any) {
      if (n.type === 'function_declaration' || n.type === 'class_declaration') {
        definitions.push({
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
        });
      }
      for (let i = 0; i < n.childCount; i++) {
        traverse(n.child(i)!);
      }
    }

    traverse(node);
    return definitions;
  }

  // Helper methods
  private generateFunctionSignature(node: t.FunctionDeclaration): string {
    const name = node.id?.name || 'anonymous';
    const params = node.params.map(param => this.paramToString(param)).join(', ');
    const async = node.async ? 'async ' : '';
    const returnType = this.extractReturnType(node);
    return `${async}function ${name}(${params})${returnType ? `: ${returnType}` : ''}`;
  }

  private generateArrowFunctionSignature(
    name: string,
    node: t.ArrowFunctionExpression | t.FunctionExpression
  ): string {
    const params = node.params.map(param => this.paramToString(param)).join(', ');
    const async = node.async ? 'async ' : '';
    const returnType = this.extractReturnType(node);
    return `${async}${name} = (${params})${returnType ? `: ${returnType}` : ''} => ...`;
  }

  private generateMethodSignature(node: t.ClassMethod, methodName: string): string {
    const params = node.params.map(param => this.methodParamToString(param)).join(', ');
    const async = node.async ? 'async ' : '';
    const returnType = this.extractReturnType(node);
    return `${async}${methodName}(${params})${returnType ? `: ${returnType}` : ''}`;
  }

  private methodParamToString(param: t.TSParameterProperty | t.FunctionParameter): string {
    // Handle TypeScript parameter properties (constructor params with accessibility modifiers)
    if (t.isTSParameterProperty(param)) {
      return this.paramToString(param.parameter as any);
    }
    // Handle regular function parameters
    return this.paramToString(param as any);
  }

  private extractParameters(params: Array<t.Identifier | t.Pattern | t.RestElement>): Parameter[] {
    return params.map(param => {
      if (t.isIdentifier(param)) {
        return {
          name: param.name,
          type: this.extractTypeAnnotation(param.typeAnnotation),
          optional: false,
        };
      } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
        return {
          name: param.left.name,
          type: this.extractTypeAnnotation(param.left.typeAnnotation),
          optional: true,
          defaultValue: this.nodeToString(param.right),
        };
      }
      return { name: 'unknown', optional: false };
    });
  }

  private extractMethodParameters(
    params: Array<t.TSParameterProperty | t.FunctionParameter>
  ): Parameter[] {
    return params.map(param => {
      if (t.isTSParameterProperty(param)) {
        // Handle TypeScript parameter properties (constructor params with accessibility modifiers)
        const innerParam = param.parameter;
        if (t.isIdentifier(innerParam)) {
          return {
            name: innerParam.name,
            type: this.extractTypeAnnotation(innerParam.typeAnnotation),
            optional: false,
          };
        }
      } else if (t.isIdentifier(param)) {
        return {
          name: param.name,
          type: this.extractTypeAnnotation(param.typeAnnotation),
          optional: false,
        };
      } else if (t.isRestElement(param)) {
        return {
          name: `...${t.isIdentifier(param.argument) ? param.argument.name : 'args'}`,
          type: this.extractTypeAnnotation(param.typeAnnotation),
          optional: false,
        };
      } else if (t.isAssignmentPattern(param)) {
        const name = t.isIdentifier(param.left) ? param.left.name : 'param';
        const typeAnnotation = t.isIdentifier(param.left) ? param.left.typeAnnotation : undefined;
        return {
          name,
          type: this.extractTypeAnnotation(typeAnnotation),
          optional: true,
          defaultValue: this.nodeToString(param.right),
        };
      }
      return {
        name: 'param',
        type: undefined,
        optional: false,
      };
    });
  }

  private extractReturnType(node: t.Function): string | undefined {
    if (node.returnType && t.isTSTypeAnnotation(node.returnType)) {
      return this.nodeToString(node.returnType.typeAnnotation);
    }
    return undefined;
  }

  private extractTypeAnnotation(
    annotation: t.TypeAnnotation | t.TSTypeAnnotation | t.Noop | null | undefined
  ): string | undefined {
    if (annotation && t.isTSTypeAnnotation(annotation)) {
      return this.nodeToString(annotation.typeAnnotation);
    }
    return undefined;
  }

  private extractLeadingComments(path: any): string | undefined {
    const comments = path.node.leadingComments;
    if (comments && comments.length > 0) {
      return comments.map((comment: any) => comment.value.trim()).join('\n');
    }
    return undefined;
  }

  private extractFunctionBody(node: t.Function): string | undefined {
    if (t.isBlockStatement(node.body)) {
      const bodyText = this.nodeToString(node.body);
      // Return a summary if the body is too long
      if (bodyText.length > 200) {
        const lines = bodyText.split('\n').slice(1, -1); // Remove braces
        return lines.slice(0, 3).join('\n') + (lines.length > 3 ? '\n  // ...' : '');
      }
      return bodyText;
    } else if (t.isExpression(node.body)) {
      return this.nodeToString(node.body);
    }
    return undefined;
  }

  private isExported(path: any): boolean {
    let current = path;
    while (current) {
      if (t.isExportDefaultDeclaration(current.node) || t.isExportNamedDeclaration(current.node)) {
        return true;
      }
      current = current.parentPath;
    }
    return false;
  }

  private paramToString(param: t.Identifier | t.Pattern | t.RestElement): string {
    if (t.isIdentifier(param)) {
      const type = this.extractTypeAnnotation(param.typeAnnotation);
      return `${param.name}${type ? `: ${type}` : ''}`;
    } else if (t.isAssignmentPattern(param)) {
      return `${this.paramToString(param.left as any)} = ${this.nodeToString(param.right)}`;
    } else if (t.isRestElement(param)) {
      return `...${this.paramToString(param.argument as any)}`;
    }
    return this.nodeToString(param);
  }

  private nodeToString(node: any): string {
    try {
      if (!node) return '';
      if (t.isIdentifier(node)) return node.name;
      if (t.isStringLiteral(node)) return `"${node.value}"`;
      if (t.isNumericLiteral(node)) return node.value.toString();
      if (t.isBooleanLiteral(node)) return node.value.toString();
      if (t.isNullLiteral(node)) return 'null';

      // For complex nodes, return a simplified representation
      if (node.type) {
        switch (node.type) {
          case 'TSStringKeyword':
            return 'string';
          case 'TSNumberKeyword':
            return 'number';
          case 'TSBooleanKeyword':
            return 'boolean';
          case 'TSVoidKeyword':
            return 'void';
          case 'TSAnyKeyword':
            return 'any';
          case 'TSUnknownKeyword':
            return 'unknown';
          default:
            return node.type;
        }
      }

      return JSON.stringify(node).slice(0, 50) + '...';
    } catch {
      return 'unknown';
    }
  }

  private inferType(node: any): string {
    if (!node) return 'unknown';
    if (t.isStringLiteral(node)) return 'string';
    if (t.isNumericLiteral(node)) return 'number';
    if (t.isBooleanLiteral(node)) return 'boolean';
    if (t.isArrayExpression(node)) return 'array';
    if (t.isObjectExpression(node)) return 'object';
    if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) return 'function';
    return 'unknown';
  }

  private languageToTreeSitterCode(
    language: SupportedLanguage
  ): 'ts' | 'tsx' | 'js' | 'jsx' | null {
    switch (language) {
      case 'typescript':
        return 'ts';
      case 'javascript':
        return 'js';
      default:
        return null;
    }
  }

  private extractNameFromDefinition(text: string): string | null {
    const functionMatch = text.match(/(?:function|async\s+function)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (functionMatch) return functionMatch[1];

    const classMatch = text.match(/class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (classMatch) return classMatch[1];

    const constMatch = text.match(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (constMatch) return constMatch[1];

    return null;
  }

  /**
   * Determine if a variable should be chunked based on its characteristics
   */
  private shouldChunkVariable(name: string, signature: string, hasDocstring?: string): boolean {
    const nameLower = name.toLowerCase();

    // Always chunk if documented
    if (hasDocstring && hasDocstring.length > 20) return true;

    // Always chunk if it's exported or part of a module interface
    if (
      signature.includes('export') ||
      nameLower.includes('config') ||
      nameLower.includes('setting')
    ) {
      return true;
    }

    // Skip very short/terse variable names (likely locals)
    if (name.length <= 2) return false;

    // Skip common local variable patterns that add little semantic value
    const skipPatterns = [
      'temp',
      'tmp',
      'i',
      'j',
      'k',
      'x',
      'y',
      'z',
      'val',
      'err',
      'res',
      'req',
      'ctx',
      'data',
      'result',
      'response',
      'item',
      'element',
      'count',
      'len',
      'length',
      'index',
      'status',
      'message',
      'output',
      'input',
      'value',
    ];

    if (skipPatterns.some(pattern => nameLower.includes(pattern))) {
      return false;
    }

    // Skip variables that are clearly local/temporary
    if (nameLower.match(/^(get|set|is|has|can|should|will|did)[A-Z]/)) {
      return false;
    }

    // Skip variables with numbers at the end (often loop counters)
    if (nameLower.match(/\d+$/)) return false;

    // If we get here, the variable might be worth chunking
    // Be more selective - only chunk variables that are clearly architectural
    const architecturalPatterns = [
      'config',
      'setting',
      'manager',
      'service',
      'handler',
      'helper',
      'util',
      'factory',
      'builder',
      'parser',
      'store',
      'state',
      'cache',
      'db',
      'api',
      'client',
    ];

    // Only chunk if it's clearly an architectural pattern AND not a simple local variable
    const isArchitectural = architecturalPatterns.some(pattern => nameLower.includes(pattern));

    // Additional check: don't chunk if it looks like a simple local variable
    const simpleLocalPatterns = [
      'temp',
      'tmp',
      'data',
      'result',
      'response',
      'item',
      'count',
      'index',
      'len',
      'length',
      'err',
      'val',
    ];

    const isSimpleLocal = simpleLocalPatterns.some(pattern => nameLower.includes(pattern));

    return isArchitectural && !isSimpleLocal;
  }
}
