/**
 * @fileOverview: Project-wide function/method manifest generator
 * @module: ProjectManifest
 * @purpose: Generate compact listings of files with their functions for navigation and orientation
 */

import { FileDiscovery, FileInfo } from '../../core/compactor/fileDiscovery';
import { ASTParser } from '../../core/compactor/astParser';
import { logger } from '../../utils/logger';
import { validateAndResolvePath } from '../utils/pathUtils';
import * as path from 'path';
import * as fs from 'fs';

export interface ManifestRequest {
  projectPath: string;
  filePattern?: string;
  exportsOnly?: boolean;
  includeTypes?: boolean;
  includeClasses?: boolean;
  includeInterfaces?: boolean;
  maxFiles?: number;
  format?: 'compact' | 'tree' | 'json' | 'flat';
  groupByFolder?: boolean;
  sortBy?: 'name' | 'line';
  includeLines?: boolean;
  excludePatterns?: string[];
  language?: string; // Added language filter
}

export interface SymbolInfo {
  name: string;
  kind: 'function' | 'method' | 'class' | 'interface' | 'type' | 'const' | 'variable';
  signature: string;
  line: number;
  exported: boolean;
  async?: boolean;
  static?: boolean;
  visibility?: 'public' | 'private' | 'protected';
  parentClass?: string;
}

export interface ManifestEntry {
  file: string;
  relPath: string;
  symbols: SymbolInfo[];
  metadata?: {
    language: string;
    symbolCount: number;
    functionCount: number;
    classCount: number;
    interfaceCount: number;
  };
}

export interface ManifestMetadata {
  totalFiles: number;
  totalSymbols: number;
  totalFunctions: number;
  totalClasses: number;
  totalInterfaces: number;
  processingTimeMs: number;
  languages: string[];
}

export interface ManifestResult {
  success: boolean;
  manifest: ManifestEntry[];
  metadata: ManifestMetadata;
  formattedOutput?: string;
}

/**
 * Generates a project manifest by discovering files and extracting symbols.
 */
export async function generateProjectManifest(args: ManifestRequest): Promise<ManifestResult> {
  const startTime = Date.now();

  const {
    projectPath,
    filePattern,
    exportsOnly = false,
    includeTypes = false,
    includeClasses = false,
    includeInterfaces = false,
    excludePatterns = [],
    maxFiles,
    format = 'compact',
    language, // Destructure language
  } = args;

  if (!projectPath) {
    throw new Error('projectPath is required');
  }

  const resolvedProjectPath = validateAndResolvePath(projectPath);
  logger.info(`Generating manifest for: ${resolvedProjectPath}`);

  try {
    // 1. Discover files
    const fileDiscovery = new FileDiscovery(resolvedProjectPath);
    let files = await fileDiscovery.discoverFiles();

    // 1.5 Apply file pattern filter if specified
    if (filePattern) {
      files = files.filter(f => matchesPattern(f.relPath, filePattern));
    }

    // 2. Filter by language if specified
    if (language) {
      files = files.filter(f => f.language === language);
      logger.info(`Filtered by language: ${language}. Found ${files.length} files.`);
    }

    // 3. Apply exclude patterns
    if (excludePatterns.length > 0) {
      const excludeRegexes = excludePatterns.map(pattern => {
        const regexStr = pattern
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '.');
        return new RegExp(regexStr);
      });

      files = files.filter(f => !excludeRegexes.some(regex => regex.test(f.relPath)));
    }

    // 4. Sort and Limit files
    files = fileDiscovery.sortByRelevance(files);
    if (maxFiles && files.length > maxFiles) {
      logger.info(`Limiting to ${maxFiles} files (found ${files.length})`);
      files = files.slice(0, maxFiles);
    }

    // 5. Extract symbols for each file
    const manifest: ManifestEntry[] = [];
    const languagesSet = new Set<string>();

    for (const file of files) {
      try {
        const symbols = await extractFileSymbols(file, {
          exportsOnly,
          includeTypes,
          includeClasses,
          includeInterfaces,
        });

        if (symbols.length > 0) {
          languagesSet.add(file.language);

          const functionCount = symbols.filter(
            s => s.kind === 'function' || s.kind === 'method'
          ).length;
          const classCount = symbols.filter(s => s.kind === 'class').length;
          const interfaceCount = symbols.filter(s => s.kind === 'interface').length;

          manifest.push({
            file: file.absPath,
            relPath: file.relPath,
            symbols,
            metadata: {
              language: file.language,
              symbolCount: symbols.length,
              functionCount,
              classCount,
              interfaceCount,
            },
          });
        }
      } catch (error) {
        logger.debug('Failed to extract symbols', {
          file: file.relPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 6. Calculate totals
    const totalSymbols = manifest.reduce((sum, entry) => sum + entry.symbols.length, 0);
    const totalFunctions = manifest.reduce(
      (sum, entry) => sum + (entry.metadata?.functionCount || 0),
      0
    );
    const totalClasses = manifest.reduce(
      (sum, entry) => sum + (entry.metadata?.classCount || 0),
      0
    );
    const totalInterfaces = manifest.reduce(
      (sum, entry) => sum + (entry.metadata?.interfaceCount || 0),
      0
    );

    const processingTimeMs = Date.now() - startTime;

    logger.info('✅ Manifest generation completed', {
      totalFiles: manifest.length,
      totalSymbols,
      totalFunctions,
      processingTimeMs,
    });

    const result: ManifestResult = {
      success: true,
      manifest,
      metadata: {
        totalFiles: manifest.length,
        totalSymbols,
        totalFunctions,
        totalClasses,
        totalInterfaces,
        processingTimeMs,
        languages: Array.from(languagesSet),
      },
    };

    // Format output if needed
    if (format !== 'json') {
      result.formattedOutput = formatManifest(result, args);
    }

    return result;
  } catch (error) {
    logger.error('❌ Manifest generation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Extract symbols from a single file
 */
async function extractFileSymbols(
  file: FileInfo,
  options: {
    exportsOnly: boolean;
    includeTypes: boolean;
    includeClasses: boolean;
    includeInterfaces: boolean;
  }
): Promise<SymbolInfo[]> {
  const { exportsOnly, includeTypes, includeClasses, includeInterfaces } = options;

  const content = await fs.promises.readFile(file.absPath, 'utf-8');

  try {
    // Use ASTParser to extract symbols
    const parser = new ASTParser();
    const parsedFile = await parser.parseFile(file.absPath, file.language as any);

    if (!parsedFile || !parsedFile.symbols || parsedFile.symbols.length === 0) {
      return extractSymbolsWithFallback(content, file.language, options);
    }

    // Convert AST symbols to SymbolInfo format
    const symbols: SymbolInfo[] = parsedFile.symbols
      .filter((symbol: any) => {
        const isExported = Boolean(symbol.exported ?? symbol.isExported);
        // Filter by export status
        if (exportsOnly && !isExported) return false;

        // Filter by type
        if (!includeTypes && symbol.type === 'type') return false;
        if (!includeClasses && symbol.type === 'class') return false;
        if (!includeInterfaces && symbol.type === 'interface') return false;

        return true;
      })
      .map((symbol: any) => ({
        name: symbol.name,
        kind: mapSymbolKind(symbol.type),
        signature: symbol.signature || formatSignature(symbol),
        line: symbol.startLine || symbol.line || 0,
        exported: Boolean(symbol.exported ?? symbol.isExported),
        async: symbol.async,
        static: symbol.static,
        visibility: symbol.visibility as any,
        parentClass: symbol.parent,
      }));

    return symbols;
  } catch (error) {
    logger.debug('AST parsing failed, trying fallback extraction', {
      file: file.relPath,
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback: Simple regex-based extraction
    return extractSymbolsWithFallback(content, file.language, options);
  }
}

/**
 * Map AST parser kinds to our standard kinds
 */
function mapSymbolKind(kind: string): SymbolInfo['kind'] {
  const lowerKind = kind.toLowerCase();

  if (lowerKind.includes('function') || lowerKind.includes('method')) {
    return lowerKind.includes('method') ? 'method' : 'function';
  }
  if (lowerKind.includes('class')) return 'class';
  if (lowerKind.includes('interface')) return 'interface';
  if (lowerKind.includes('type')) return 'type';
  if (lowerKind.includes('const')) return 'const';
  if (lowerKind.includes('variable') || lowerKind.includes('var')) return 'variable';

  return 'function'; // Default fallback
}

/**
 * Format signature for display
 */
function formatSignature(symbol: any): string {
  if (symbol.signature) return symbol.signature;

  let sig = symbol.name;

  if (symbol.parameters) {
    const params = Array.isArray(symbol.parameters)
      ? symbol.parameters.join(', ')
      : symbol.parameters;
    sig += `(${params})`;
  } else if (symbol.kind?.includes('function') || symbol.kind?.includes('method')) {
    sig += '()';
  }

  if (symbol.returnType) {
    sig += `: ${symbol.returnType}`;
  }

  return sig;
}

/**
 * Fallback extraction using regex patterns
 */
function extractSymbolsWithFallback(
  content: string,
  language: string,
  options?: {
    exportsOnly: boolean;
    includeTypes: boolean;
    includeClasses: boolean;
    includeInterfaces: boolean;
  }
): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const lines = content.split('\n');

  // TypeScript/JavaScript patterns
  if (language === 'typescript' || language === 'javascript') {
    const functionPatterns = [
      /^export (?:async )?function\s+(\w+)/,
      /^(?:async )?function\s+(\w+)/,
      /^export const\s+(\w+)\s*=/,
      /^const\s+(\w+)\s*=/,
    ];
    const exportDefaultPattern = /^export default\s+(\w+)/;

    const classPattern = /^(?:export )?class\s+(\w+)/;
    const interfacePattern = /^(?:export )?interface\s+(\w+)/;
    const typePattern = /^(?:export )?type\s+(\w+)/;

    // Heuristic: avoid parsing function/class/type declarations embedded inside template literals.
    let inTemplateLiteral = false;
    const countUnescapedBackticks = (line: string): number => {
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '`' && (i === 0 || line[i - 1] !== '\\')) count += 1;
      }
      return count;
    };

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      const lineStartsInsideTemplate = inTemplateLiteral;

      if (!lineStartsInsideTemplate) {
        // Check functions/constants
        for (const pattern of functionPatterns) {
          const match = trimmed.match(pattern);
          if (match) {
            const isConst = /^\s*(?:export\s+)?const\b/.test(trimmed);
            symbols.push({
              name: match[1],
              kind: isConst ? 'const' : 'function',
              signature: isConst ? `${match[1]}` : `${match[1]}()`,
              line: idx + 1,
              exported: trimmed.startsWith('export'),
            });
            break;
          }
        }

        const exportDefaultMatch = trimmed.match(exportDefaultPattern);
        if (exportDefaultMatch) {
          symbols.push({
            name: exportDefaultMatch[1],
            kind: 'variable',
            signature: `default ${exportDefaultMatch[1]}`,
            line: idx + 1,
            exported: true,
          });
        }

        // Check classes
        const classMatch = trimmed.match(classPattern);
        if (classMatch) {
          symbols.push({
            name: classMatch[1],
            kind: 'class',
            signature: classMatch[1],
            line: idx + 1,
            exported: trimmed.startsWith('export'),
          });
        }

        // Check interfaces
        const interfaceMatch = trimmed.match(interfacePattern);
        if (interfaceMatch) {
          symbols.push({
            name: interfaceMatch[1],
            kind: 'interface',
            signature: interfaceMatch[1],
            line: idx + 1,
            exported: trimmed.startsWith('export'),
          });
        }

        // Check types
        const typeMatch = trimmed.match(typePattern);
        if (typeMatch) {
          symbols.push({
            name: typeMatch[1],
            kind: 'type',
            signature: typeMatch[1],
            line: idx + 1,
            exported: trimmed.startsWith('export'),
          });
        }
      }

      if (countUnescapedBackticks(line) % 2 === 1) {
        inTemplateLiteral = !inTemplateLiteral;
      }
    });
  }

  // Python patterns
  if (language === 'python') {
    const functionPattern = /^def\s+(\w+)\s*\(/;
    const classPattern = /^class\s+(\w+)/;

    lines.forEach((line, idx) => {
      const trimmed = line.trim();

      const funcMatch = trimmed.match(functionPattern);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          kind: 'function',
          signature: `${funcMatch[1]}()`,
          line: idx + 1,
          exported: true, // Python doesn't have explicit exports
        });
      }

      const classMatch = trimmed.match(classPattern);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          kind: 'class',
          signature: classMatch[1],
          line: idx + 1,
          exported: true,
        });
      }
    });
  }

  if (!options) {
    return symbols;
  }

  return symbols.filter(symbol => {
    if (options.exportsOnly && !symbol.exported) return false;
    if (!options.includeTypes && symbol.kind === 'type') return false;
    if (!options.includeClasses && symbol.kind === 'class') return false;
    if (!options.includeInterfaces && symbol.kind === 'interface') return false;
    return true;
  });
}

/**
 * Check if path matches glob pattern
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  const posixPath = filePath.replace(/\\/g, '/');
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');

  return new RegExp('^' + regexStr + '$').test(posixPath);
}

/**
 * Format manifest for display
 */
function formatManifest(result: ManifestResult, args: ManifestRequest): string {
  const { format = 'compact', groupByFolder = false, sortBy = 'name', includeLines = false } = args;

  switch (format) {
    case 'flat':
      return formatFlat(result, includeLines);
    case 'tree':
      return formatTree(result, groupByFolder);
    case 'compact':
    default:
      return formatCompact(result, includeLines);
  }
}

/**
 * Compact format: File with indented function list
 */
function formatCompact(result: ManifestResult, includeLines: boolean): string {
  const lines: string[] = [];

  lines.push('# Project Manifest\n');
  lines.push(
    `Found ${result.metadata.totalFunctions} functions in ${result.metadata.totalFiles} files\n`
  );

  for (const entry of result.manifest) {
    lines.push(`\n${entry.relPath}`);

    for (const symbol of entry.symbols) {
      const prefix = symbol.kind === 'method' ? '  │  ' : '  ├─ ';
      const lineNum = includeLines ? `:${symbol.line}` : '';
      const exported = symbol.exported ? '📤 ' : '';

      lines.push(`${prefix}${exported}${symbol.signature}${lineNum}`);
    }
  }

  return lines.join('\n');
}

/**
 * Flat format: One line per symbol (grep-friendly)
 */
function formatFlat(result: ManifestResult, includeLines: boolean): string {
  const lines: string[] = [];

  for (const entry of result.manifest) {
    for (const symbol of entry.symbols) {
      const lineNum = includeLines ? `:${symbol.line}` : '';
      lines.push(`${entry.relPath}${lineNum} ${symbol.kind} ${symbol.name}`);
    }
  }

  return lines.join('\n');
}

/**
 * Tree format: Grouped by symbol kind
 */
function formatTree(result: ManifestResult, groupByFolder: boolean): string {
  const lines: string[] = [];

  lines.push('# Project Manifest (Tree View)\n');

  for (const entry of result.manifest) {
    lines.push(`\n${entry.relPath}`);

    // Group symbols by kind
    const byKind: Record<string, SymbolInfo[]> = {};
    for (const symbol of entry.symbols) {
      const kind = symbol.kind;
      if (!byKind[kind]) byKind[kind] = [];
      byKind[kind].push(symbol);
    }

    // Display each kind group
    const kinds = Object.keys(byKind).sort();
    for (const kind of kinds) {
      const kindSymbols = byKind[kind];
      const kindLabel =
        kind === 'function'
          ? 'Functions'
          : kind === 'method'
            ? 'Methods'
            : kind === 'class'
              ? 'Classes'
              : kind === 'interface'
                ? 'Interfaces'
                : kind.charAt(0).toUpperCase() + kind.slice(1) + 's';

      lines.push(`  ├─ [${kindLabel}]`);

      for (const symbol of kindSymbols) {
        const exported = symbol.exported ? '📤 ' : '';
        lines.push(`  │  ├─ ${exported}${symbol.signature}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Runtime handler for CLI
 */
export async function handleProjectManifest(args: ManifestRequest): Promise<any> {
  try {
    const result = await generateProjectManifest(args);

    if (args.format === 'json') {
      return result;
    }

    return {
      success: true,
      content: result.formattedOutput || '',
      metadata: result.metadata,
      usage: `Found ${result.metadata.totalFunctions} functions in ${result.metadata.totalFiles} files`,
    };
  } catch (error) {
    logger.error('❌ Manifest handler failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      content: 'Failed to generate manifest',
    };
  }
}
