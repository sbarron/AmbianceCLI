/**
 * @fileOverview: AST Query Engine for enhanced local context
 * @module: AstQueryEngine
 * @keyFunctions:
 *   - runAstQueriesOnFiles(): Execute DSL queries across project files
 *   - parseFileAst(): Parse files to AST with multi-language support
 *   - matchAstQuery(): Match individual query against AST
 *   - extractSymbolContext(): Extract symbols with surrounding context
 * @context: Provides fast AST-based code searching and symbol extraction
 */

import * as babel from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { readFileSync } from 'fs';
import * as path from 'path';
import { FileInfo } from '../../core/compactor/fileDiscovery';
import { AstQuery, CandidateSymbol } from './enhancedLocalContext';
import { logger } from '../../utils/logger';

// ===== LANGUAGE DETECTION AND PARSING =====

export interface ParsedFile {
  filePath: string;
  relPath: string;
  language: string;
  ast: any;
  content: string;
  symbols: ExtractedSymbol[];
}

export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'variable' | 'import' | 'export' | 'call' | 'route';
  start: number;
  end: number;
  line: number;
  signature?: string;
  file: string;
  relFile: string;
  returnsJsx?: boolean;
}

/**
 * Run AST queries across multiple files
 */
export async function runAstQueriesOnFiles(
  files: FileInfo[],
  queries: AstQuery[],
  maxFiles: number = 100
): Promise<CandidateSymbol[]> {
  logger.info('🔍 Running AST queries', {
    fileCount: files.length,
    queryCount: queries.length,
    maxFiles,
  });

  const candidates: CandidateSymbol[] = [];
  let filesProcessed = 0;

  // Process files in batches for performance
  const filesToProcess = files.slice(0, maxFiles);

  for (const file of filesToProcess) {
    if (!isSourceCodeFile(file.absPath)) continue;

    try {
      const parsed = await parseFileToAst(file);
      if (!parsed) continue;

      // Run all queries against this file
      for (const query of queries) {
        const matches = await matchQueryInFile(parsed, query);
        candidates.push(...matches);
      }

      filesProcessed++;
    } catch (error) {
      logger.debug('⚠️ Failed to parse file for AST queries', {
        file: file.relPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('✅ AST queries completed', {
    filesProcessed,
    candidatesFound: candidates.length,
  });

  return candidates;
}

/**
 * Parse a single file to AST
 */
async function parseFileToAst(file: FileInfo): Promise<ParsedFile | null> {
  try {
    const content = readFileSync(file.absPath, 'utf8');
    const language = detectLanguageFromFile(file.absPath);

    if (!['javascript', 'typescript'].includes(language)) {
      // For now, only support JS/TS. Could extend to other languages with tree-sitter
      return null;
    }

    const ast = babel.parse(content, {
      sourceType: 'module',
      plugins: [
        'typescript',
        'jsx',
        'decorators-legacy',
        'classProperties',
        'objectRestSpread',
        'asyncGenerators',
        'functionBind',
        'exportDefaultFrom',
        'exportNamespaceFrom',
        'dynamicImport',
        'nullishCoalescingOperator',
        'optionalChaining',
      ],
    });

    // Extract symbols from AST
    const symbols = extractSymbolsFromAst(ast, file);

    return {
      filePath: file.absPath,
      relPath: file.relPath,
      language,
      ast,
      content,
      symbols,
    };
  } catch (error) {
    logger.debug('Failed to parse file', { file: file.relPath, error });
    return null;
  }
}

/**
 * Extract symbols from parsed AST
 */
function extractSymbolsFromAst(ast: any, file: FileInfo): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  traverse(ast, {
    FunctionDeclaration(path) {
      const node = path.node;
      if (node.id?.name) {
        symbols.push({
          name: node.id.name,
          kind: 'function',
          start: node.start || 0,
          end: node.end || 0,
          line: node.loc?.start.line || 0,
          signature: generateFunctionSignature(node),
          file: file.absPath,
          relFile: file.relPath,
        });
      }
    },

    FunctionExpression(path) {
      const parent = path.parent;
      let name = 'anonymous';

      if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
        name = parent.id.name;
      } else if (t.isProperty(parent) && t.isIdentifier(parent.key)) {
        name = parent.key.name;
      }

      symbols.push({
        name,
        kind: 'function',
        start: path.node.start || 0,
        end: path.node.end || 0,
        line: path.node.loc?.start.line || 0,
        signature: generateFunctionSignature(path.node),
        file: file.absPath,
        relFile: file.relPath,
      });
    },

    ArrowFunctionExpression(path) {
      const parent = path.parent;
      let name = 'arrow';

      if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
        name = parent.id.name;
      } else if (t.isProperty(parent) && t.isIdentifier(parent.key)) {
        name = parent.key.name;
      }

      symbols.push({
        name,
        kind: 'function',
        start: path.node.start || 0,
        end: path.node.end || 0,
        line: path.node.loc?.start.line || 0,
        file: file.absPath,
        relFile: file.relPath,
      });
    },

    ClassDeclaration(path) {
      const node = path.node;
      if (node.id?.name) {
        symbols.push({
          name: node.id.name,
          kind: 'class',
          start: node.start || 0,
          end: node.end || 0,
          line: node.loc?.start.line || 0,
          file: file.absPath,
          relFile: file.relPath,
        });
      }
    },

    TSInterfaceDeclaration(path) {
      const node = path.node;
      symbols.push({
        name: node.id.name,
        kind: 'interface',
        start: node.start || 0,
        end: node.end || 0,
        line: node.loc?.start.line || 0,
        file: file.absPath,
        relFile: file.relPath,
      });
    },

    VariableDeclarator(path) {
      const node = path.node;
      if (t.isIdentifier(node.id)) {
        symbols.push({
          name: node.id.name,
          kind: 'variable',
          start: node.start || 0,
          end: node.end || 0,
          line: node.loc?.start.line || 0,
          file: file.absPath,
          relFile: file.relPath,
        });
      }
    },

    ImportDeclaration(path) {
      const node = path.node;
      symbols.push({
        name: `import from ${node.source.value}`,
        kind: 'import',
        start: node.start || 0,
        end: node.end || 0,
        line: node.loc?.start.line || 0,
        file: file.absPath,
        relFile: file.relPath,
      });
    },

    ExportNamedDeclaration(path) {
      const node = path.node;
      const declaration = node.declaration;

      if (declaration) {
        if (t.isFunctionDeclaration(declaration) && declaration.id) {
          symbols.push({
            name: declaration.id.name,
            kind: 'export',
            start: node.start || 0,
            end: node.end || 0,
            line: node.loc?.start.line || 0,
            file: file.absPath,
            relFile: file.relPath,
          });
        } else if (t.isVariableDeclaration(declaration)) {
          declaration.declarations.forEach(decl => {
            if (t.isIdentifier(decl.id)) {
              symbols.push({
                name: decl.id.name,
                kind: 'export',
                start: node.start || 0,
                end: node.end || 0,
                line: node.loc?.start.line || 0,
                file: file.absPath,
                relFile: file.relPath,
              });
            }
          });
        }
      }
    },

    ExportDefaultDeclaration(path) {
      const node: any = path.node;
      let returnsJsx = false;
      try {
        path.traverse({
          ReturnStatement(p: any) {
            const arg = p.node?.argument;
            if (arg && (arg.type === 'JSXElement' || arg.type === 'JSXFragment')) {
              returnsJsx = true;
            }
          },
        } as any);
      } catch (error) {
        logger.debug('Failed to analyze default export return value', {
          file: file.relPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      symbols.push({
        name: 'default',
        kind: 'export',
        start: node.start || 0,
        end: node.end || 0,
        line: node.loc?.start.line || 0,
        file: file.absPath,
        relFile: file.relPath,
        returnsJsx,
      });
    },

    CallExpression(path) {
      const node = path.node;
      let callName = 'unknown';

      if (t.isIdentifier(node.callee)) {
        callName = node.callee.name;
      } else if (t.isMemberExpression(node.callee)) {
        if (t.isIdentifier(node.callee.object) && t.isIdentifier(node.callee.property)) {
          callName = `${node.callee.object.name}.${node.callee.property.name}`;
        }
      }

      symbols.push({
        name: callName,
        kind: 'call',
        start: node.start || 0,
        end: node.end || 0,
        line: node.loc?.start.line || 0,
        file: file.absPath,
        relFile: file.relPath,
      });
    },
  });

  return symbols;
}

/**
 * Match a query against a parsed file
 */
async function matchQueryInFile(parsed: ParsedFile, query: AstQuery): Promise<CandidateSymbol[]> {
  const candidates: CandidateSymbol[] = [];

  switch (query.kind) {
    case 'import':
      candidates.push(...matchImportQuery(parsed, query));
      break;
    case 'export':
      candidates.push(...matchExportQuery(parsed, query));
      break;
    case 'call':
      candidates.push(...matchCallQuery(parsed, query));
      break;
    case 'new':
      candidates.push(...matchNewQuery(parsed, query));
      break;
    case 'env':
      candidates.push(...matchEnvQuery(parsed, query));
      break;
    case 'route':
      candidates.push(...matchRouteQuery(parsed, query));
      break;
  }

  return candidates;
}

/**
 * Match import queries
 */
function matchImportQuery(
  parsed: ParsedFile,
  query: Extract<AstQuery, { kind: 'import' }>
): CandidateSymbol[] {
  const candidates: CandidateSymbol[] = [];
  const sourcePattern = query.source;

  for (const symbol of parsed.symbols) {
    if (symbol.kind === 'import') {
      // Extract source from "import from source" format
      const match = symbol.name.match(/import from (.+)/);
      if (match) {
        const source = match[1];
        if (matchesPattern(source, sourcePattern)) {
          candidates.push({
            file: parsed.filePath,
            symbol: symbol.name,
            start: symbol.start,
            end: symbol.end,
            kind: 'import',
            score: 0.8,
            reasons: [`import source matches: ${source}`],
            role: 'dependency',
          });
        }
      }
    }
  }

  return candidates;
}

/**
 * Match export queries
 */
function matchExportQuery(
  parsed: ParsedFile,
  query: Extract<AstQuery, { kind: 'export' }>
): CandidateSymbol[] {
  const candidates: CandidateSymbol[] = [];
  const namePattern = query.name;

  for (const symbol of parsed.symbols) {
    if (symbol.kind === 'export') {
      if (matchesPattern(symbol.name, namePattern)) {
        const reasons: string[] = [`export name matches: ${symbol.name}`];
        if (symbol.returnsJsx) reasons.push('export:returnsJsx');
        candidates.push({
          file: parsed.filePath,
          symbol: symbol.name,
          start: symbol.start,
          end: symbol.end,
          kind: 'export',
          score: 0.9,
          reasons,
          role: 'interface',
        });
      }
    }
  }

  return candidates;
}

/**
 * Match call queries
 */
function matchCallQuery(
  parsed: ParsedFile,
  query: Extract<AstQuery, { kind: 'call' }>
): CandidateSymbol[] {
  const candidates: CandidateSymbol[] = [];
  const calleePattern = query.callee;
  const inFiles = query.inFiles;

  // Check if file matches inFiles constraint
  if (inFiles && !inFiles.some(pattern => matchesGlob(parsed.relPath, pattern))) {
    return candidates;
  }

  for (const symbol of parsed.symbols) {
    if (symbol.kind === 'call') {
      if (matchesPattern(symbol.name, calleePattern)) {
        candidates.push({
          file: parsed.filePath,
          symbol: symbol.name,
          start: symbol.start,
          end: symbol.end,
          kind: 'call',
          score: 0.7,
          reasons: [`call matches: ${symbol.name}`],
          role: 'operation',
        });
      }
    }
  }

  return candidates;
}

/**
 * Match new queries
 */
function matchNewQuery(
  parsed: ParsedFile,
  query: Extract<AstQuery, { kind: 'new' }>
): CandidateSymbol[] {
  const candidates: CandidateSymbol[] = [];
  const classPattern = query.className;

  // Build dynamic regex for constructor calls
  const classSource =
    typeof classPattern === 'string'
      ? classPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      : classPattern.source;
  const regex = new RegExp(`\\bnew\\s+(${classSource})\\s*\\(`, 'g');

  let match: RegExpExecArray | null;
  while ((match = regex.exec(parsed.content)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    const before = parsed.content.slice(0, start);
    const line = (before.match(/\n/g) || []).length + 1;

    candidates.push({
      file: parsed.filePath,
      symbol: `new ${match[1]}`,
      start,
      end,
      kind: 'call',
      score: 0.7,
      reasons: [`constructor matches: ${match[1]}`],
      role: 'operation',
    });
  }

  return candidates;
}

/**
 * Match environment variable queries
 */
function matchEnvQuery(
  parsed: ParsedFile,
  query: Extract<AstQuery, { kind: 'env' }>
): CandidateSymbol[] {
  const candidates: CandidateSymbol[] = [];
  const keyPattern = query.key;

  // Look for process.env usage in the content
  const envRegex = /process\.env\.(\w+)/g;
  let match;

  while ((match = envRegex.exec(parsed.content)) !== null) {
    const envKey = match[1];
    if (matchesPattern(envKey, keyPattern)) {
      const start = match.index;
      const end = match.index + match[0].length;

      candidates.push({
        file: parsed.filePath,
        symbol: `process.env.${envKey}`,
        start,
        end,
        kind: 'env',
        score: 0.8,
        reasons: [`env key matches: ${envKey}`],
        role: 'config',
      });
    }
  }

  return candidates;
}

/**
 * Match route queries
 */
function matchRouteQuery(
  parsed: ParsedFile,
  query: Extract<AstQuery, { kind: 'route' }>
): CandidateSymbol[] {
  const candidates: CandidateSymbol[] = [];
  // Determine method pattern
  const methodPattern = query.method
    ? typeof query.method === 'string'
      ? query.method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      : query.method.source
    : '(get|post|put|delete|patch|head|options)';

  // Build regex to capture app/router method and path string
  const regex = new RegExp(
    `\\b(app|router)\\.${methodPattern}\\s*\\(\\s*([\"'\`])([^\"'\`]+)\\2`,
    'gi'
  );

  let match: RegExpExecArray | null;
  while ((match = regex.exec(parsed.content)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    const before = parsed.content.slice(0, start);
    const line = (before.match(/\n/g) || []).length + 1;
    const method = match[0].match(/\.(\w+)\s*\(/)?.[1] || 'route';
    const path = match[3] || '/';

    candidates.push({
      file: parsed.filePath,
      symbol: `${method.toUpperCase()} ${path}`,
      start,
      end,
      kind: 'export',
      score: 0.85,
      reasons: ['route:method-path'],
      role: 'request handler',
    });
  }

  return candidates;
}

// ===== UTILITY FUNCTIONS =====

function isSourceCodeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'].includes(ext);
}

function detectLanguageFromFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    default:
      return 'unknown';
  }
}

function matchesPattern(text: string, pattern: string | RegExp): boolean {
  if (typeof pattern === 'string') {
    return text.includes(pattern);
  } else {
    return pattern.test(text);
  }
}

function matchesGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching - could be enhanced with a proper glob library
  const regex = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.');
  return new RegExp(regex).test(filePath);
}

function generateFunctionSignature(node: any): string {
  // Generate a simple function signature
  if (
    t.isFunctionDeclaration(node) ||
    t.isFunctionExpression(node) ||
    t.isArrowFunctionExpression(node)
  ) {
    const params = node.params
      .map((param: any) => {
        if (t.isIdentifier(param)) {
          return param.name;
        }
        return 'param';
      })
      .join(', ');

    const name = node.type === 'ArrowFunctionExpression' ? 'arrow' : node.id?.name || 'function';
    return `${name}(${params})`;
  }

  return 'function';
}
