/**
 * @fileOverview: File analysis utilities for different file types
 * @module: FileAnalyzers
 * @keyFunctions:
 *   - extractFileHeader(): Extract file header comments or preview
 *   - handleNonCodeFile(): Analyze non-code files (JSON, Markdown, YAML)
 *   - analyzeJsonFile(): JSON file structure analysis
 *   - analyzeMarkdownFile(): Markdown content analysis
 *   - analyzeYamlFile(): YAML configuration analysis
 * @context: Provides comprehensive file analysis for various file types
 */

import * as path from 'path';
import { logger } from '../../../utils/logger';
import { formatFileSummaryOutput } from '../formatters/fileSummaryFormatters';
import { JsonASTAnalyzer } from './jsonASTAnalyzer';

/**
 * Extract file header comment block or first 15 lines for context
 */
export async function extractFileHeader(filePath: string): Promise<{
  type: 'comment' | 'code' | 'empty';
  content: string;
  lineCount: number;
}> {
  try {
    const fs = await import('fs/promises');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    if (lines.length === 0) {
      return { type: 'empty', content: '', lineCount: 0 };
    }

    // Check for block comment at the start
    const trimmedFirst = lines[0].trim();

    if (trimmedFirst.startsWith('/**') || trimmedFirst.startsWith('/*')) {
      // Extract block comment
      const headerLines: string[] = [];
      let foundEnd = false;

      for (let i = 0; i < Math.min(lines.length, 50); i++) {
        // Limit to first 50 lines
        const line = lines[i];
        headerLines.push(line);

        if (line.includes('*/')) {
          foundEnd = true;
          break;
        }
      }

      if (foundEnd) {
        return {
          type: 'comment',
          content: headerLines.join('\n'),
          lineCount: headerLines.length,
        };
      }
    }

    // Check for multiple single-line comments at the start
    if (trimmedFirst.startsWith('//') || trimmedFirst.startsWith('#')) {
      const headerLines: string[] = [];
      const commentChar = trimmedFirst.startsWith('//') ? '//' : '#';

      for (let i = 0; i < Math.min(lines.length, 25); i++) {
        // Limit to first 25 lines for single-line comments
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === '' || trimmed.startsWith(commentChar)) {
          headerLines.push(line);
        } else if (headerLines.length > 2) {
          // Stop if we've collected some comments and hit non-comment
          break;
        } else {
          // If we haven't found meaningful comments yet, include this line
          headerLines.push(line);
          if (headerLines.length >= 15) break;
        }
      }

      if (headerLines.length > 3) {
        // Only return if we found substantial comments
        return {
          type: 'comment',
          content: headerLines.join('\n'),
          lineCount: headerLines.length,
        };
      }
    }

    // Fallback: return first 15 lines as code context
    const contextLines = lines.slice(0, 15);
    return {
      type: 'code',
      content: contextLines.join('\n'),
      lineCount: contextLines.length,
    };
  } catch (error) {
    logger.warn('Failed to extract file header', { filePath, error: (error as Error).message });
    return { type: 'empty', content: '', lineCount: 0 };
  }
}

/**
 * Handle non-code files (JSON, Markdown, YAML, etc.) with lightweight analysis
 */
export async function handleNonCodeFile(
  filePath: string,
  language: string,
  format: string,
  includeSymbols: boolean,
  maxSymbols: number
): Promise<any> {
  try {
    const fs = await import('fs');
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    const fileName = path.basename(filePath);
    const fileSize = Buffer.byteLength(fileContent, 'utf8');

    let analysis: any = {
      file: filePath,
      exists: true,
      language,
      size: fileSize,
      lines: fileContent.split('\n').length,
      symbols: [],
      complexity: 'low', // Non-code files are inherently low complexity
      complexityData: {
        rating: 'low',
        description: 'Non-code file',
        totalComplexity: 1,
        decisionPoints: 0,
      },
    };

    // Language-specific analysis
    switch (language) {
      case 'json':
        analysis = await analyzeJsonFile(fileContent, analysis, includeSymbols, maxSymbols);
        break;
      case 'markdown':
        analysis = await analyzeMarkdownFile(fileContent, analysis, includeSymbols, maxSymbols);
        break;
      case 'yaml':
        analysis = await analyzeYamlFile(fileContent, analysis, includeSymbols, maxSymbols);
        break;
      default:
        analysis.symbolCount = 0;
        analysis.structure = 'Plain text file';
    }

    const quickAnalysis = `${fileName} (${language}): ${analysis.symbolCount || 0} elements, ${analysis.complexity} complexity, ${analysis.structure || 'Data'} file`;

    return {
      success: true,
      summary: formatFileSummaryOutput(analysis, quickAnalysis, format),
      quickAnalysis,
      metadata: {
        format,
        symbolCount: analysis.symbolCount || 0,
        complexity: analysis.complexity,
        language,
      },
      usage: `Found ${analysis.symbolCount || 0} elements with ${analysis.complexity} complexity`,
    };
  } catch (error) {
    logger.error('Failed to analyze non-code file', {
      filePath,
      language,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      fallback: `Could not analyze ${path.basename(filePath)}. File may not exist, be too large, or contain unsupported content.`,
      suggestion: 'Try local_project_hints to understand the overall project structure instead.',
    };
  }
}

/**
 * Analyze JSON files - extract keys, structure, and validation using AST-based approach
 */
export async function analyzeJsonFile(
  content: string,
  analysis: any,
  includeSymbols: boolean,
  maxSymbols: number
): Promise<any> {
  try {
    logger.debug('analyzeJsonFile called', {
      contentLength: content?.length,
      hasAnalysis: !!analysis,
      includeSymbols,
      maxSymbols,
    });

    // Use new AST-based analyzer
    const astAnalyzer = new JsonASTAnalyzer();
    await astAnalyzer.initialize();

    const jsonInfo = await astAnalyzer.analyzeJsonContent(content);

    logger.debug('JSON AST analysis result', {
      hasResult: !!jsonInfo,
      isPrimitive: jsonInfo?.isPrimitive,
      isArray: jsonInfo?.isArray,
      isObject: jsonInfo?.isObject,
      topLevelKeys: jsonInfo?.topLevelKeys,
      keyCount: jsonInfo?.keyCount,
    });

    if (!jsonInfo) {
      throw new Error('Failed to analyze JSON with AST analyzer');
    }

    // Map AST analysis to existing analysis structure for compatibility
    if (jsonInfo.isPrimitive) {
      analysis.symbolCount = 0;
      analysis.structure = `JSON ${jsonInfo.primitiveType}`;
      analysis.jsonInfo = {
        topLevelKeys: [],
        totalKeys: 0,
        hasNesting: false,
        dataTypes: [],
        primitiveType: jsonInfo.primitiveType,
      };
      return analysis;
    }

    if (jsonInfo.isArray) {
      analysis.symbolCount = jsonInfo.arrayLength || 0;
      analysis.structure = 'JSON array';
      analysis.jsonInfo = {
        topLevelKeys: [],
        totalKeys: jsonInfo.arrayLength || 0,
        hasNesting: jsonInfo.depth > 1,
        dataTypes: [],
        arrayLength: jsonInfo.arrayLength,
      };
      return analysis;
    }

    // Object analysis
    const keys = jsonInfo.topLevelKeys || [];
    analysis.symbolCount = keys.length;

    // Use detected config type or default
    analysis.structure = jsonInfo.configType || 'JSON configuration';

    analysis.jsonInfo = {
      topLevelKeys: keys.slice(0, 10),
      totalKeys: keys.length,
      hasNesting: jsonInfo.depth > 1,
      dataTypes: jsonInfo.nestedStructure
        ? Object.entries(jsonInfo.nestedStructure).map(([key, info]: [string, any]) => ({
            key,
            type: info.type,
            depth: info.depth,
          }))
        : [],
      depth: jsonInfo.depth,
      configType: jsonInfo.configType,
      nestedStructure: jsonInfo.nestedStructure || {},
    };

    if (includeSymbols) {
      // Use symbols from AST analyzer
      const astResult = await astAnalyzer.analyzeContent(content);
      if (astResult?.symbols) {
        analysis.symbols = astResult.symbols.slice(0, maxSymbols).map(sym => ({
          name: sym.name,
          type: sym.metadata?.valueType || 'unknown',
          depth: sym.metadata?.depth || 0,
        }));
      }
    }
  } catch (error) {
    analysis.symbolCount = 0;
    analysis.structure = 'Invalid JSON';
    analysis.parseError = (error as Error).message;
  }

  return analysis;
}

/**
 * Analyze Markdown files - extract headers, sections, and structure
 */
export async function analyzeMarkdownFile(
  content: string,
  analysis: any,
  includeSymbols: boolean,
  maxSymbols: number
): Promise<any> {
  const lines = content.split('\n');
  const headers = lines.filter(line => line.trim().startsWith('#'));
  const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
  const links = content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];

  analysis.symbolCount = headers.length;
  analysis.structure = 'Documentation';
  analysis.markdownInfo = {
    headers: headers.slice(0, 10).map(h => ({
      level: h.match(/^#+/)?.[0].length || 0,
      text: h.replace(/^#+\s*/, '').trim(),
    })),
    totalHeaders: headers.length,
    codeBlockCount: codeBlocks.length,
    linkCount: links.length,
    wordCount: content.split(/\s+/).length,
  };

  if (includeSymbols) {
    analysis.symbols = headers.slice(0, maxSymbols).map(header => ({
      name: header.replace(/^#+\s*/, '').trim(),
      type: 'header',
      level: header.match(/^#+/)?.[0].length || 0,
    }));
  }

  return analysis;
}

/**
 * Analyze YAML files - extract structure and keys
 */
export async function analyzeYamlFile(
  content: string,
  analysis: any,
  includeSymbols: boolean,
  maxSymbols: number
): Promise<any> {
  // Simple YAML analysis without external dependencies
  const lines = content.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
  const keys = lines
    .filter(line => line.includes(':') && !line.trim().startsWith('-'))
    .map(line => line.split(':')[0].trim())
    .filter(key => key && !key.includes(' '));

  analysis.symbolCount = keys.length;
  analysis.structure = 'YAML configuration';
  analysis.yamlInfo = {
    topLevelKeys: [...new Set(keys)].slice(0, 10),
    totalKeys: keys.length,
    totalLines: lines.length,
  };

  if (includeSymbols) {
    analysis.symbols = [...new Set(keys)].slice(0, maxSymbols).map(key => ({
      name: key,
      type: 'key',
      context: 'yaml',
    }));
  }

  return analysis;
}
