/**
 * @fileOverview: Local file summary tool for AST-based file analysis
 * @module: FileSummary
 * @keyFunctions:
 *   - localFileSummaryTool: Tool definition for file analysis
 *   - handleFileSummary(): Handler for file summary requests
 *   - getComprehensiveASTAnalysis(): Comprehensive AST analysis without filtering
 *   - extractAllFunctions(): Extract all functions from file
 *   - getLanguageFromPath(): Determine language from file extension
 * @context: Provides detailed file analysis with symbol extraction and complexity calculation
 */

import * as path from 'path';
import { SemanticCompactor } from '../../core/compactor/semanticCompactor';
import { logger } from '../../utils/logger';
import { validateAndResolvePath } from '../utils/pathUtils';
import {
  formatFileSummaryOutput,
  generateQuickFileAnalysis,
} from '../../tools/localTools/formatters/fileSummaryFormatters';
import {
  handleNonCodeFile,
  extractFileHeader,
} from '../../tools/localTools/analyzers/fileAnalyzers';
import { calculateCyclomaticComplexity } from '../../tools/localTools/analyzers/complexityAnalysis';
import { handleAstGrep, executeAstGrep } from '../grep/astGrep';
import { getPatterns, preparePattern, SymbolPattern } from '../../tools/localTools/symbolPatterns';
import { ASTParser } from '../../core/compactor/astParser';

/**
 * Lightweight type resolution that maps AST node kinds to readable identifiers
 */
function resolveTypeFromAST(signature: string): string {
  if (!signature) return signature;

  // Map common AST node kinds to readable types
  const typeMappings: Record<string, string> = {
    TSTypeReference: 'Type',
    TSStringKeyword: 'string',
    TSNumberKeyword: 'number',
    TSBooleanKeyword: 'boolean',
    TSVoidKeyword: 'void',
    TSUndefinedKeyword: 'undefined',
    TSNullKeyword: 'null',
    TSAnyKeyword: 'any',
    TSUnknownKeyword: 'unknown',
    TSNeverKeyword: 'never',
    TSObjectKeyword: 'object',
    TSSymbolKeyword: 'symbol',
    TSBigIntKeyword: 'bigint',
    TSArrayType: 'Array',
    TSTupleType: 'Tuple',
    TSUnionType: 'Union',
    TSIntersectionType: 'Intersection',
    TSFunctionType: 'Function',
    TSMethodSignature: 'Method',
    TSPropertySignature: 'Property',
    TSIndexSignature: 'Index',
    TSConstructSignature: 'Constructor',
    TSCallSignature: 'Call',
    TSInterfaceDeclaration: 'Interface',
    TSClassDeclaration: 'Class',
    TSEnumDeclaration: 'Enum',
    TSTypeAliasDeclaration: 'TypeAlias',
    TSModuleDeclaration: 'Module',
    TSInterfaceBody: 'InterfaceBody',
    TSClassBody: 'ClassBody',
    TSModuleBody: 'ModuleBody',
    TSParameterProperty: 'Parameter',
    TSPropertyDeclaration: 'Property',
    TSMethodDeclaration: 'Method',
    TSConstructorDeclaration: 'Constructor',
    TSGetAccessor: 'Getter',
    TSSetAccessor: 'Setter',
  };

  let resolvedSignature = signature;

  // Replace AST node kinds with readable equivalents
  for (const [astKind, readableType] of Object.entries(typeMappings)) {
    resolvedSignature = resolvedSignature.replace(new RegExp(astKind, 'g'), readableType);
  }

  // Handle common patterns that might not be caught
  resolvedSignature = resolvedSignature
    .replace(/TS\((\w+)\)/g, '$1') // Remove TS() wrapper
    .replace(/TS/g, '') // Remove TS prefix from remaining types
    .replace(/TypeType/g, 'Type') // Fix double Type
    .replace(/ArrayArray/g, 'Array') // Fix double Array
    .replace(/FunctionFunction/g, 'Function'); // Fix double Function

  return resolvedSignature;
}

/**
 * Handler for file summary requests
 */
export async function handleFileSummary(args: any): Promise<any> {
  const { filePath, includeSymbols = true, maxSymbols = 20, format = 'structured' } = args;

  logger.info('🔍 handleFileSummary called with', {
    filePath,
    argsKeys: Object.keys(args),
    args: args,
  });

  // Validate that filePath is provided and is absolute
  if (!filePath) {
    throw new Error('❌ filePath is required. Please provide an absolute path to the file.');
  }
  const resolvedFilePath = validateAndResolvePath(filePath);
  const projectPath = path.dirname(resolvedFilePath);

  logger.info('📄 Analyzing file', {
    originalPath: filePath,
    resolvedPath: resolvedFilePath,
    projectPath,
    includeSymbols,
    maxSymbols,
  });

  try {
    // Check if file exists before proceeding
    const fs = await import('fs/promises');
    try {
      await fs.access(resolvedFilePath);
    } catch (error) {
      throw new Error('File not found');
    }

    const languageInfo = getLanguageFromPath(filePath);
    const language = languageInfo.lang;

    // Check if this is a non-code file that doesn't need AST analysis
    if (
      language === 'json' ||
      language === 'markdown' ||
      language === 'yaml' ||
      language === 'toml' ||
      language === 'text'
    ) {
      return await handleNonCodeFile(
        resolvedFilePath,
        language,
        format,
        includeSymbols,
        maxSymbols
      );
    }

    // Use semantic compactor for single file analysis (optional)
    let nodes = [];
    try {
      const compactor = new SemanticCompactor(projectPath);
      nodes = await compactor.getSummary(resolvedFilePath);
      compactor.dispose();
    } catch (error) {
      logger.warn('Skipping semantic compactor summary for single file', {
        projectPath,
        error: error instanceof Error ? error.message : String(error),
      });
      nodes = [];
    }

    // 🔑 Get comprehensive analysis directly from AST (bypass semantic compactor filtering)
    logger.info('🔍 About to call getComprehensiveASTAnalysis', { resolvedFilePath });
    let astAnalysis;
    try {
      astAnalysis = await getComprehensiveASTAnalysis(resolvedFilePath);
    } catch (error) {
      logger.error('❌ getComprehensiveASTAnalysis failed', {
        error: error instanceof Error ? error.message : String(error),
        filePath: resolvedFilePath,
      });
      throw error;
    }

    if (!astAnalysis) {
      logger.error('❌ getComprehensiveASTAnalysis returned undefined', { resolvedFilePath });
      throw new Error('AST analysis returned undefined');
    }

    logger.info('✅ Got AST analysis', {
      totalSymbols: astAnalysis?.totalSymbols,
      hasAllFunctions: !!astAnalysis?.allFunctions,
      hasAllClasses: !!astAnalysis?.allClasses,
      hasAllInterfaces: !!astAnalysis?.allInterfaces,
    });

    // Get semantic compactor results for comparison (but don't rely on them for symbol count)
    // Debug: Log the AST analysis results
    logger.debug('🔍 AST Analysis Results', {
      filePath: resolvedFilePath,
      totalSymbols: astAnalysis.totalSymbols,
      functions: astAnalysis.allFunctions.length,
      classes: astAnalysis.allClasses.length,
      interfaces: astAnalysis.allInterfaces.length,
      exportedSymbols: astAnalysis.exportedSymbols.length,
      topSymbols: astAnalysis.topSymbols.length,
      sampleFunctions: astAnalysis.allFunctions
        .slice(0, 3)
        .map(f => ({ name: f.name, type: f.type, line: f.line })),
      sampleClasses: astAnalysis.allClasses
        .slice(0, 3)
        .map(c => ({ name: c.name, type: c.type, line: c.line })),
    });

    // Force use the actual AST analysis results instead of semantic compactor
    logger.info('🔧 Using AST analysis results directly', {
      symbolCount: astAnalysis.totalSymbols,
      functions: astAnalysis.allFunctions.length,
      classes: astAnalysis.allClasses.length,
    });

    // Extract file header information
    const fileHeader = await extractFileHeader(resolvedFilePath);

    // Calculate cyclomatic complexity
    let complexityData = {
      rating: 'low',
      description: 'Simple code',
      totalComplexity: 1,
      decisionPoints: 0,
      breakdown: {},
    };
    try {
      const fs = await import('fs');
      const fileContent = await fs.promises.readFile(resolvedFilePath, 'utf8');
      complexityData = calculateCyclomaticComplexity(fileContent);
    } catch (error) {
      // Fallback to simple symbol-based complexity if file reading fails
      complexityData.rating =
        astAnalysis.totalSymbols > 50 ? 'high' : astAnalysis.totalSymbols > 20 ? 'medium' : 'low';
      complexityData.description = `Based on ${astAnalysis.totalSymbols} symbols`;
    }

    // Clean up resources
    // compactor.dispose(); // Moved inside try-catch

    const summary = {
      file: filePath,
      exists: astAnalysis.totalSymbols > 0,
      symbolCount: astAnalysis.totalSymbols, // 🔑 Use actual AST symbol count
      fileHeader: fileHeader,
      allFunctions: astAnalysis.allFunctions,
      exportedSymbols: astAnalysis.exportedSymbols,
      allClasses: astAnalysis.allClasses, // 🔑 Add class information
      allInterfaces: astAnalysis.allInterfaces, // 🔑 Add interface information
      symbols: includeSymbols
        ? astAnalysis.topSymbols.slice(0, maxSymbols) // 🔑 Use better symbol selection
        : [],
      complexity: complexityData.rating,
      complexityData: complexityData, // 🔑 Add detailed complexity information
      language,
    };

    const quickAnalysis = generateQuickFileAnalysis(summary);

    // Format the output based on preference
    let formattedSummary: string;
    try {
      formattedSummary = formatFileSummaryOutput(summary, quickAnalysis, format);
      if (typeof formattedSummary !== 'string') {
        logger.warn('Formatter returned non-string value', {
          type: typeof formattedSummary,
          value: formattedSummary,
        });
        formattedSummary = `Error: Formatter returned ${typeof formattedSummary} instead of string`;
      }
    } catch (error) {
      logger.error('Failed to format file summary', {
        error: error instanceof Error ? error.message : String(error),
      });
      formattedSummary = `Error formatting summary: ${error instanceof Error ? error.message : String(error)}`;
    }

    logger.info('✅ File analysis completed', {
      symbolCount: summary.symbolCount,
      complexity: summary.complexity,
    });

    return {
      success: true,
      summary: formattedSummary,
      quickAnalysis,
      metadata: {
        format,
        symbolCount: summary.symbolCount,
        complexity: summary.complexity,
        language: summary.language,
      },
      usage: `Found ${summary.symbolCount} symbols with ${summary.complexity} complexity`,
    };
  } catch (error) {
    logger.error('❌ File analysis failed', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      fallback: `Could not analyze ${filePath}. File may not exist, be too large, or contain unsupported language.`,
      suggestion: 'Try local_project_hints to understand the overall project structure instead.',
    };
  }
}

/**
 * Get language from file path extension with ast-grep code
 */
export function getLanguageFromPath(filePath: string): { lang: string; grep?: string } {
  const ext = path.extname(filePath).toLowerCase();
  const languageMap: Record<string, { lang: string; grep?: string }> = {
    '.ts': { lang: 'typescript', grep: 'ts' },
    '.tsx': { lang: 'typescript', grep: 'tsx' },
    '.js': { lang: 'javascript', grep: 'js' },
    '.jsx': { lang: 'javascript', grep: 'jsx' },
    '.py': { lang: 'python', grep: 'py' },
    '.go': { lang: 'go', grep: 'go' },
    '.rs': { lang: 'rust', grep: 'rs' },
    '.cpp': { lang: 'cpp', grep: 'cpp' },
    '.c': { lang: 'c', grep: 'c' },
    '.java': { lang: 'java', grep: 'java' },
    '.kt': { lang: 'kotlin', grep: 'kt' },
    '.swift': { lang: 'swift', grep: 'swift' },
    '.php': { lang: 'php', grep: 'php' },
    '.rb': { lang: 'ruby', grep: 'rb' },
    '.html': { lang: 'html', grep: 'html' },
    '.htm': { lang: 'html', grep: 'html' },
    '.astro': { lang: 'html', grep: 'html' },
    '.vue': { lang: 'html', grep: 'html' },
    '.svelte': { lang: 'html', grep: 'html' },
    '.css': { lang: 'css', grep: 'css' },
    '.scss': { lang: 'css', grep: 'css' },
    '.sass': { lang: 'css', grep: 'css' },
    '.less': { lang: 'css', grep: 'css' },
    // ... existing others without grep ...
    '.json': { lang: 'json' },
    '.md': { lang: 'markdown' },
    '.mdx': { lang: 'markdown' },
    '.yaml': { lang: 'yaml' },
    '.yml': { lang: 'yaml' },
    '.xml': { lang: 'xml' },
    // ...
  };
  const result = languageMap[ext] || { lang: 'unknown' };
  return result;
}

/**
 * Extract all functions (standalone and class methods) directly from AST
 */
export async function extractAllFunctions(filePath: string): Promise<any[]> {
  try {
    const { ASTParser } = await import('../../core/compactor/astParser');

    const language = getLanguageFromPath(filePath) as any;
    const parser = new ASTParser();

    // Parse the file to get all symbols including class methods
    const parsedFile = await parser.parseFile(filePath, language);

    // Extract all function-like symbols (functions, methods, arrow functions)
    const allFunctions: any[] = [];

    for (const symbol of parsedFile.symbols) {
      if (symbol.type === 'function') {
        allFunctions.push({
          name: symbol.name,
          signature: resolveTypeFromAST(symbol.signature),
          line: symbol.startLine,
          isAsync: symbol.isAsync || symbol.signature.includes('async'),
          isExported: symbol.isExported,
          isMethod: false,
          className: undefined,
          parameters: extractParametersFromSignature(symbol.signature),
          returnType: resolveTypeFromAST(symbol.returnType || ''),
          returnedSymbols: extractReturnedSymbols(symbol.body),
          purpose: 'Function',
        });
      } else if (symbol.type === 'method') {
        // Handle individual method symbols with full signatures
        allFunctions.push({
          name: symbol.name,
          signature: resolveTypeFromAST(symbol.signature),
          line: symbol.startLine,
          isAsync: symbol.isAsync || false,
          isExported: symbol.isExported,
          isMethod: true,
          className: symbol.className,
          parameters: symbol.parameters || extractParametersFromSignature(symbol.signature),
          returnType: resolveTypeFromAST(symbol.returnType || ''),
          returnedSymbols: extractReturnedSymbols(symbol.body),
          purpose: 'Method',
        });
      } else if (symbol.type === 'class') {
        // Class symbols are handled in getComprehensiveASTAnalysis - skip here since we're only extracting functions
        // Methods are now handled separately as individual 'method' symbols
      }
    }

    parser.dispose();
    return allFunctions;
  } catch (error) {
    logger.warn('Failed to extract functions from AST', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get comprehensive AST analysis without semantic compactor filtering
 * Now with ast-grep fallback for multi-lang symbols
 */
export async function getComprehensiveASTAnalysis(filePath: string): Promise<{
  totalSymbols: number;
  allFunctions: any[];
  allClasses: any[];
  allInterfaces: any[];
  exportedSymbols: string[];
  topSymbols: any[];
}> {
  try {
    logger.info('🔍 Starting AST analysis', { filePath });
    const languageInfo = getLanguageFromPath(filePath);
    const language = languageInfo.lang as any;
    const grepLang = languageInfo.grep;
    logger.info('📝 Detected language', { language, grepLang });

    const parser = new ASTParser();
    logger.info('⚙️ Created AST parser, about to parse file');
    let parsedFile = await parser.parseFile(filePath, language);
    // Handle undefined/null from parser for unsupported langs (e.g., Python/Go no grammar)
    if (!parsedFile) {
      logger.warn('ASTParser returned undefined, forcing fallback', { filePath, language });
      parsedFile = {
        symbols: [],
        imports: [],
        exports: [],
        errors: [],
        absPath: filePath,
        language,
      };
    }
    logger.info('✅ Parsed file successfully', {
      hasSymbols: !!parsedFile?.symbols,
      symbolCount: parsedFile?.symbols?.length || 0,
    });

    let allFunctions: any[] = [];
    let allClasses: any[] = [];
    const allInterfaces: any[] = [];
    let exportedSymbols: string[] = [];

    // Existing JS/TS/Python processing
    for (const symbol of parsedFile.symbols) {
      if (symbol.type === 'function') {
        allFunctions.push({
          name: symbol.name,
          signature: resolveTypeFromAST(symbol.signature),
          line: symbol.startLine,
          isAsync: symbol.isAsync || symbol.signature.includes('async'),
          isExported: symbol.isExported,
          isMethod: false,
          className: undefined,
          parameters: extractParametersFromSignature(symbol.signature),
          returnType: resolveTypeFromAST(symbol.returnType || ''),
          returnedSymbols: extractReturnedSymbols(symbol.body),
          purpose: 'Function',
        });
      } else if (symbol.type === 'method') {
        // Handle individual method symbols with full signatures
        allFunctions.push({
          name: symbol.name,
          signature: resolveTypeFromAST(symbol.signature),
          line: symbol.startLine,
          isAsync: symbol.isAsync || false,
          isExported: symbol.isExported,
          isMethod: true,
          className: symbol.className,
          parameters: symbol.parameters || extractParametersFromSignature(symbol.signature),
          returnType: resolveTypeFromAST(symbol.returnType || ''),
          returnedSymbols: extractReturnedSymbols(symbol.body),
          purpose: 'Method',
        });
      } else if (symbol.type === 'class') {
        allClasses.push({
          name: symbol.name,
          line: symbol.startLine,
          isExported: symbol.isExported,
          signature: resolveTypeFromAST(symbol.signature),
          methods:
            symbol.body && symbol.body.startsWith('Methods:')
              ? symbol.body
                  .replace('Methods:', '')
                  .trim()
                  .split(',')
                  .map(m => m.trim())
                  .filter(m => m && m !== 'constructor')
              : [],
        });
      } else if (symbol.type === 'interface') {
        allInterfaces.push({
          name: symbol.name,
          line: symbol.startLine,
          signature: resolveTypeFromAST(symbol.signature),
          purpose: 'Type definition',
        });
      }

      // Collect exported symbols
      if (symbol.isExported && !exportedSymbols.includes(symbol.name)) {
        exportedSymbols.push(symbol.name);
      }
    } // Close the for loop

    // Add exports from export statements
    if (parsedFile.exports) {
      parsedFile.exports.forEach(exportStmt => {
        if (exportStmt.name && !exportedSymbols.includes(exportStmt.name)) {
          exportedSymbols.push(exportStmt.name);
        }
      });
    }

    // Fallback to ast-grep if few/no symbols or non-JS/TS (force for samples/unsupported)
    let initialSymbolCount = parsedFile.symbols.length || 0;
    const isNonJsTs = grepLang && !['ts', 'js', 'jsx', 'tsx'].includes(grepLang);
    if ((initialSymbolCount < 2 || isNonJsTs) && grepLang) {
      logger.info('🔄 Falling back to ast-grep for symbol extraction', {
        filePath,
        grepLang,
        initialSymbolCount,
      });
      const astGrepSymbols = extractSymbolsWithAstGrep(filePath, grepLang);
      allFunctions = [...allFunctions, ...astGrepSymbols.functions];
      allClasses = [...allClasses, ...astGrepSymbols.classes];
      exportedSymbols = [...exportedSymbols, ...(astGrepSymbols.exports || [])];
      logger.info('✅ Ast-grep extraction complete', {
        functions: astGrepSymbols.functions.length,
        classes: astGrepSymbols.classes.length,
      });
      initialSymbolCount += astGrepSymbols.functions.length + astGrepSymbols.classes.length;
    }

    // Create top symbols list (prioritize important symbols)
    const topSymbols: any[] = [];

    // Add classes first (most important)
    allClasses.forEach(cls => {
      topSymbols.push({
        name: cls.name,
        type: 'class',
        line: cls.line,
        purpose: 'Core class',
        signature:
          resolveTypeFromAST(cls.signature).substring(0, 100) +
          (cls.signature.length > 100 ? '...' : ''),
      });
    });

    // Add interfaces
    allInterfaces.forEach(iface => {
      topSymbols.push({
        name: iface.name,
        type: 'interface',
        line: iface.line,
        purpose: iface.purpose,
        signature:
          resolveTypeFromAST(iface.signature).substring(0, 100) +
          (iface.signature.length > 100 ? '...' : ''),
      });
    });

    // Add some key functions (exported first)
    const keyFunctions = allFunctions
      .filter(f => !f.isMethod) // Only standalone functions
      .sort((a, b) => (b.isExported ? 1 : 0) - (a.isExported ? 1 : 0))
      .slice(0, 5);

    keyFunctions.forEach(func => {
      topSymbols.push({
        name: func.name,
        type: 'function',
        line: func.line,
        purpose: func.purpose,
        signature:
          resolveTypeFromAST(func.signature).substring(0, 100) +
          (func.signature.length > 100 ? '...' : ''),
      });
    });

    parser.dispose();

    return {
      totalSymbols: initialSymbolCount, // Use updated count after fallback
      allFunctions,
      allClasses,
      allInterfaces,
      exportedSymbols,
      topSymbols,
    };
  } catch (error) {
    logger.warn('Failed to get comprehensive AST analysis', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      totalSymbols: 0,
      allFunctions: [],
      allClasses: [],
      allInterfaces: [],
      exportedSymbols: [],
      topSymbols: [],
    };
  }
}

/**
 * Extract symbols using ast-grep patterns (multi-lang fallback)
 */
function extractSymbolsWithAstGrep(
  filePath: string,
  grepLang: string
): {
  functions: any[];
  classes: any[];
  exports: string[];
} {
  const functions: any[] = [];
  const classes: any[] = [];
  const exports: string[] = [];

  // Get patterns for this lang
  const funcPatterns = getPatterns(grepLang, 'functions');
  const classPatterns = getPatterns(grepLang, 'classes');
  const methodPatterns = getPatterns(grepLang, 'methods') || [];

  // Run for functions
  for (const pat of funcPatterns) {
    try {
      // Use direct CLI call to ast-grep for more reliable results
      const { execSync } = require('child_process');
      const command = `npx ast-grep --pattern "${pat.pattern.replace(/"/g, '\\"')}" --lang ${pat.lang} --json=stream "${filePath}"`;

      let matches: any[] = [];
      try {
        const stdout = execSync(command, {
          cwd: process.cwd(),
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        // Parse the JSON stream output
        matches = stdout
          .trim()
          .split('\n')
          .filter((line: string) => line.trim())
          .map((line: string) => {
            try {
              return JSON.parse(line);
            } catch (e) {
              logger.warn('Failed to parse ast-grep JSON line for functions', { line, error: e });
              return null;
            }
          })
          .filter((match: any) => match !== null);
      } catch (error) {
        // Command failed or no matches found
        logger.warn('ast-grep command failed for functions', {
          command,
          error: error instanceof Error ? error.message : String(error),
        });
        matches = [];
      }

      const result = { matches };

      if (result && (result as any).matches) {
        (result as any).matches.forEach((match: any) => {
          // Parse function name from the matched text
          let name = 'unknown';
          const fullText = match.lines || match.text;
          if (grepLang === 'py' && fullText.includes('def ')) {
            // Extract function name from "def function_name("
            const funcMatch = fullText.match(/def\s+(\w+)\s*\(/);
            if (funcMatch) name = funcMatch[1];
          } else if (grepLang === 'go' && fullText.includes('func ')) {
            // Extract function name from "func functionName("
            const funcMatch = fullText.match(/func\s+(\w+)\s*\(/);
            if (funcMatch) name = funcMatch[1];
          } else if (grepLang === 'rust' && fullText.includes('fn ')) {
            // Extract function name from "fn function_name("
            const funcMatch = fullText.match(/fn\s+(\w+)\s*\(/);
            if (funcMatch) name = funcMatch[1];
          }

          functions.push({
            name,
            type: 'function',
            signature: fullText.trim(),
            line: match.range.start.line + 1, // Convert to 1-based line numbers
            isExported: false, // Detect via separate pattern if needed
            parameters: [],
            returnType: '',
            body: '',
            purpose: 'Function',
          });
          exports.push(name); // Assume exported
        });
      }
    } catch (error) {
      logger.warn('Failed to extract functions with ast-grep', {
        pattern: pat.pattern,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Similar for classes and methods (adapt to allClasses/allFunctions)
  for (const pat of classPatterns) {
    try {
      // Use direct CLI call to ast-grep for more reliable results
      const { execSync } = require('child_process');
      const command = `npx ast-grep --pattern "${pat.pattern.replace(/"/g, '\\"')}" --lang ${pat.lang} --json=stream "${filePath}"`;

      let matches: any[] = [];
      try {
        const stdout = execSync(command, {
          cwd: process.cwd(),
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        // Parse the JSON stream output
        matches = stdout
          .trim()
          .split('\n')
          .filter((line: string) => line.trim())
          .map((line: string) => {
            try {
              return JSON.parse(line);
            } catch (e) {
              return null;
            }
          })
          .filter((match: any) => match !== null);
      } catch (error) {
        // Command failed or no matches found
        matches = [];
      }

      const result = { matches };

      if (result && (result as any).matches) {
        (result as any).matches.forEach((match: any) => {
          // Parse class name from the matched text
          let name = 'unknown';
          const fullText = match.lines || match.text;
          if (grepLang === 'py' && fullText.includes('class ')) {
            // Extract class name from "class ClassName("
            const classMatch = fullText.match(/class\s+(\w+)/);
            if (classMatch) name = classMatch[1];
          } else if (grepLang === 'java' && fullText.includes('class ')) {
            // Extract class name from "public class ClassName"
            const classMatch = fullText.match(/class\s+(\w+)/);
            if (classMatch) name = classMatch[1];
          }

          classes.push({
            name,
            type: 'class',
            signature: fullText.trim(),
            line: match.range.start.line + 1, // Convert to 1-based line numbers
            isExported: false, // Detect via separate pattern if needed
            methods: [], // Methods are handled separately
            purpose: 'Class',
          });
          exports.push(name); // Assume exported
        });
      }
    } catch (error) {
      logger.warn('Failed to extract classes with ast-grep', {
        pattern: pat.pattern,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const pat of methodPatterns) {
    try {
      // Use direct CLI call to ast-grep for more reliable results
      const { execSync } = require('child_process');
      const command = `npx ast-grep --pattern "${pat.pattern.replace(/"/g, '\\"')}" --lang ${pat.lang} --json=stream "${filePath}"`;

      let matches: any[] = [];
      try {
        const stdout = execSync(command, {
          cwd: process.cwd(),
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        // Parse the JSON stream output
        matches = stdout
          .trim()
          .split('\n')
          .filter((line: string) => line.trim())
          .map((line: string) => {
            try {
              return JSON.parse(line);
            } catch (e) {
              return null;
            }
          })
          .filter((match: any) => match !== null);
      } catch (error) {
        // Command failed or no matches found
        matches = [];
      }

      const result = { matches };

      if (result && (result as any).matches) {
        (result as any).matches.forEach((match: any) => {
          // Parse method name from the matched text
          let name = 'unknown';
          let isMethod = false;
          let isClass = false;

          const matchText = match.lines || match.text;
          if (grepLang === 'java' && matchText.includes('public ')) {
            // Check if it's a class declaration first
            const classMatch = matchText.match(/public\s+class\s+(\w+)/);
            if (classMatch) {
              name = classMatch[1];
              isClass = true;
              // Skip if already in classes array (avoid duplicates)
              if (!classes.find(c => c.name === name && c.line === match.range.start.line + 1)) {
                classes.push({
                  name,
                  type: 'class',
                  signature: matchText.trim(),
                  line: match.range.start.line + 1,
                  isExported: true,
                  methods: [],
                  purpose: 'Class',
                });
                exports.push(name);
              }
              return; // Skip adding to functions
            }

            // Extract method name from "public ReturnType methodName("
            const methodMatch = matchText.match(/public\s+(?:static\s+)?(\w+)\s+(\w+)\s*\(/);
            if (methodMatch) {
              name = methodMatch[2]; // The second capture group is the method name
              isMethod = true;
            } else {
              // Try to match constructors "public ClassName("
              const constructorMatch = matchText.match(/public\s+(\w+)\s*\(/);
              if (constructorMatch) {
                name = constructorMatch[1];
                isMethod = true;
              }
            }
          }

          if (isMethod && !isClass) {
            functions.push({
              name,
              type: 'method',
              signature: matchText.trim(),
              line: match.range.start.line + 1,
              isExported: false,
              isMethod: true,
              parameters: [],
              returnType: '',
              body: '',
              purpose: 'Method',
            });
            exports.push(name);
          }
        });
      }
    } catch (error) {
      logger.warn('Failed to extract methods with ast-grep', {
        pattern: pat.pattern,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { functions, classes, exports };
}

/**
 * Extract symbols that are returned from function body
 */
export function extractReturnedSymbols(functionBody: string | undefined): string[] {
  if (!functionBody) return [];

  try {
    const returnedSymbols: string[] = [];

    // Match return statements
    const returnMatches = functionBody.match(/return\s+([^;}\n]+)/g);

    if (returnMatches) {
      returnMatches.forEach(returnStmt => {
        // Clean up the return statement
        const returnValue = returnStmt.replace(/^return\s+/, '').trim();

        // Extract object returns like { success: true, data: result }
        if (returnValue.startsWith('{') && returnValue.includes(':')) {
          const objectMatches = returnValue.match(/(\w+):/g);
          if (objectMatches) {
            objectMatches.forEach(match => {
              const key = match.replace(':', '').trim();
              if (key && !returnedSymbols.includes(key)) {
                returnedSymbols.push(key);
              }
            });
          }
        }

        // Extract simple variable returns
        const simpleVarMatch = returnValue.match(/^(\w+)(\s*[;,}]|$)/);
        if (simpleVarMatch) {
          const varName = simpleVarMatch[1];
          if (
            varName &&
            !['true', 'false', 'null', 'undefined'].includes(varName) &&
            !returnedSymbols.includes(varName)
          ) {
            returnedSymbols.push(varName);
          }
        }

        // Extract function calls like return someFunction()
        const funcCallMatch = returnValue.match(/^(\w+)\s*\(/);
        if (funcCallMatch) {
          const funcName = funcCallMatch[1];
          if (funcName && !returnedSymbols.includes(funcName)) {
            returnedSymbols.push(`${funcName}()`);
          }
        }

        // Extract property access like return this.property
        const propMatch = returnValue.match(/^(\w+)\.(\w+)/);
        if (propMatch) {
          const propAccess = `${propMatch[1]}.${propMatch[2]}`;
          if (!returnedSymbols.includes(propAccess)) {
            returnedSymbols.push(propAccess);
          }
        }
      });
    }

    return returnedSymbols.slice(0, 5); // Limit to first 5 returned symbols
  } catch (error) {
    return [];
  }
}

/**
 * Extract parameters from function signature
 */
export function extractParametersFromSignature(signature: string): string[] {
  try {
    // Match function parameters between parentheses
    const paramMatch = signature.match(/\(([^)]*)\)/);
    if (!paramMatch || !paramMatch[1].trim()) {
      return [];
    }

    const paramString = paramMatch[1].trim();
    if (paramString === '') return [];

    // Split by comma but be careful of nested types
    const params = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < paramString.length; i++) {
      const char = paramString[i];
      if (char === ',' && depth === 0) {
        params.push(current.trim());
        current = '';
      } else {
        if (char === '(' || char === '<') depth++;
        if (char === ')' || char === '>') depth--;
        current += char;
      }
    }

    if (current.trim()) {
      params.push(current.trim());
    }

    return params.filter(p => p.length > 0);
  } catch (error) {
    return [];
  }
}
