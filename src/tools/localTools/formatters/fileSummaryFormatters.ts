/**
 * @fileOverview: File summary output formatters for AST-based file analysis
 * @module: FileSummaryFormatters
 * @keyFunctions:
 *   - formatFileSummaryOutput(): Main formatter dispatcher
 *   - formatFileSummaryAsXML(): XML format for structured data exchange
 *   - formatFileSummaryAsStructured(): Markdown format for human readability
 *   - formatFileSummaryAsCompact(): Minimal format for space-constrained environments
 * @context: Provides multiple output formats for file analysis results
 */

import * as path from 'path';
import { escapeXml } from './contextFormatters';

/**
 * Main formatter dispatcher for file summary output
 */
export function formatFileSummaryOutput(
  summary: any,
  quickAnalysis: string,
  format: string
): string {
  switch (format) {
    case 'xml':
      return formatFileSummaryAsXML(summary, quickAnalysis);
    case 'compact':
      return formatFileSummaryAsCompact(summary, quickAnalysis);
    case 'structured':
    default:
      return formatFileSummaryAsStructured(summary, quickAnalysis);
  }
}

/**
 * Format file summary as XML for structured data exchange
 */
export function formatFileSummaryAsXML(summary: any, quickAnalysis: string): string {
  const headerXml =
    summary.fileHeader && summary.fileHeader.content
      ? `  <file_header>
    <type>${summary.fileHeader.type}</type>
    <line_count>${summary.fileHeader.lineCount}</line_count>
    <content><![CDATA[${summary.fileHeader.content}]]></content>
  </file_header>`
      : '';

  const functionsXml =
    summary.allFunctions && summary.allFunctions.length > 0
      ? `  <functions>
    ${summary.allFunctions
      .map(
        (func: any) => `
    <function>
      <name>${escapeXml(func.name)}</name>
      <line>${func.line}</line>
      <is_async>${func.isAsync}</is_async>
      <is_exported>${func.isExported}</is_exported>
      <parameter_count>${func.parameters.length}</parameter_count>
      <signature>${escapeXml(func.signature)}</signature>
    </function>`
      )
      .join('')}
  </functions>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<file_summary>
  <metadata>
    <file_path>${escapeXml(summary.file)}</file_path>
    <exists>${summary.exists}</exists>
    <language>${summary.language}</language>
    <complexity>${summary.complexity}</complexity>
    <symbol_count>${summary.symbolCount}</symbol_count>
    <function_count>${summary.allFunctions ? summary.allFunctions.length : 0}</function_count>
    ${
      summary.complexityData
        ? `<cyclomatic_complexity>
      <total>${summary.complexityData.totalComplexity}</total>
      <decision_points>${summary.complexityData.decisionPoints}</decision_points>
      <rating>${summary.complexityData.rating}</rating>
      <description><![CDATA[${summary.complexityData.description}]]></description>
    </cyclomatic_complexity>`
        : ''
    }
  </metadata>
  <quick_analysis>${escapeXml(quickAnalysis)}</quick_analysis>${headerXml}${functionsXml}
  <symbols>
    ${summary.symbols
      .map(
        (symbol: any) => `
    <symbol>
      <name>${escapeXml(symbol.name)}</name>
      <type>${escapeXml(symbol.type)}</type>
      <line>${symbol.line}</line>
      <purpose>${escapeXml(symbol.purpose || '')}</purpose>
      <signature>${escapeXml(symbol.signature)}</signature>
    </symbol>`
      )
      .join('')}
  </symbols>
</file_summary>`;
}

/**
 * Format file summary as structured markdown for human readability
 */
export function formatFileSummaryAsStructured(summary: any, quickAnalysis: string): string {
  const fileName = path.basename(summary.file);

  let output = `# 📄 File Analysis: ${fileName}\n\n`;
  output += `**Language**: ${summary.language}\n`;
  output += `**Symbol Count**: ${summary.symbolCount}\n`;
  output += `**Complexity**: ${summary.complexity}\n\n`;

  if (summary.fileHeader && summary.fileHeader.content) {
    output += `## File Header\n\n${summary.fileHeader.content}\n\n`;
  }

  if (summary.allFunctions && summary.allFunctions.length > 0) {
    output += `## Functions (${summary.allFunctions.length})\n\n`;
    summary.allFunctions.slice(0, 10).forEach((func: any) => {
      output += `- **${func.name}** (line ${func.line})${func.isAsync ? ' [async]' : ''}${func.isExported ? ' [exported]' : ''}\n`;
      if (func.signature) {
        output += `  \`${func.signature.substring(0, 80)}${func.signature.length > 80 ? '...' : ''}\`\n`;
      }
    });
    output += '\n';
  }

  if (summary.allClasses && summary.allClasses.length > 0) {
    output += `## Classes (${summary.allClasses.length})\n\n`;
    summary.allClasses.forEach((cls: any) => {
      output += `- **${cls.name}** (line ${cls.line})${cls.isExported ? ' [exported]' : ''}\n`;
      if (cls.methods && cls.methods.length > 0) {
        output += `  Methods: ${cls.methods.join(', ')}\n`;
      }
    });
    output += '\n';
  }

  if (summary.complexityData) {
    output += `## Complexity Analysis\n\n`;
    output += `- **Total Complexity**: ${summary.complexityData.totalComplexity}\n`;
    output += `- **Decision Points**: ${summary.complexityData.decisionPoints}\n`;
    output += `- **Rating**: ${summary.complexityData.rating} - ${summary.complexityData.description}\n\n`;
  }

  output += `## Quick Analysis\n\n${quickAnalysis}`;

  return output;
}

/**
 * Format file summary in compact format for space-constrained environments
 */
export function formatFileSummaryAsCompact(summary: any, quickAnalysis: string): string {
  const topSymbols = summary.symbols
    .slice(0, 5)
    .map((s: any) => `${s.name}(${s.type})`)
    .join(', ');
  const headerInfo =
    summary.fileHeader && summary.fileHeader.content
      ? `\nHEADER: ${summary.fileHeader.type} (${summary.fileHeader.lineCount} lines)`
      : '';
  const functionsInfo =
    summary.allFunctions && summary.allFunctions.length > 0
      ? `\nFUNCTIONS: ${summary.allFunctions.length} total (${summary.allFunctions.filter((f: any) => f.isExported).length} exported, ${summary.allFunctions.filter((f: any) => f.isAsync).length} async)`
      : '';

  const complexityInfo = summary.complexityData
    ? ` | CC: ${summary.complexityData.totalComplexity} (${summary.complexityData.decisionPoints} decision points)`
    : '';

  return `FILE: ${summary.file} | LANG: ${summary.language} | COMPLEXITY: ${summary.complexity}${complexityInfo} | SYMBOLS: ${summary.symbolCount}
ANALYSIS: ${quickAnalysis}${headerInfo}${functionsInfo}
TOP_SYMBOLS: ${topSymbols}`;
}

/**
 * Classify symbol purpose based on name and type patterns
 */
export function classifySymbolPurpose(symbol: any): string {
  const name = symbol.name.toLowerCase();
  const type = symbol.type;

  // Better purpose classification
  if (type === 'class') {
    if (name.includes('server') || name.includes('service')) return 'Core service class';
    if (name.includes('manager') || name.includes('handler')) return 'Business logic class';
    if (name.includes('component')) return 'UI component class';
    return 'Business logic class';
  }

  if (type === 'function') {
    if (name.includes('setup') || name.includes('init')) return 'Initialization function';
    if (name.includes('handler') || name.includes('handle')) return 'Event handler function';
    if (name.includes('start') || name.includes('run')) return 'Entry point function';
    if (symbol.signature?.includes('async')) return 'Async operation function';
    return 'Utility function';
  }

  if (type === 'interface') {
    return 'Type contract definition';
  }

  if (type === 'export') {
    return 'Module export';
  }

  if (type === 'import') {
    return 'Module import';
  }

  if (type === 'variable') {
    if (name.includes('config') || name.includes('settings')) return 'Configuration variable';
    if (name.includes('state') || name.includes('data')) return 'State variable';
    return 'Data variable';
  }

  return 'General symbol';
}

/**
 * Generate quick file analysis summary
 */
export function generateQuickFileAnalysis(summary: any): string {
  const { file, symbolCount, complexity, language } = summary;
  const fileName = path.basename(file);

  // Analyze symbol types for better insights
  const symbolsByType = summary.symbols.reduce((acc: any, symbol: any) => {
    acc[symbol.type] = (acc[symbol.type] || 0) + 1;
    return acc;
  }, {});

  // Get top symbols by importance/type priority
  const topSymbols = summary.symbols
    .filter((s: any) => s.type !== 'variable' || s.purpose !== 'State variable') // Exclude basic variables
    .slice(0, 3)
    .map((s: any) => `${s.name}(${s.type})`)
    .join(', ');

  // Analyze architecture patterns
  const hasClass = symbolsByType.class > 0;
  const hasInterface = symbolsByType.interface > 0;
  const hasAsync = summary.symbols.some((s: any) => s.signature?.includes('async'));
  const isExportHeavy =
    summary.symbols.filter((s: any) => s.purpose?.includes('Export')).length > 1;

  let pattern = '';
  if (hasClass && hasInterface) pattern = 'OOP design';
  else if (hasClass) pattern = 'Class-based';
  else if (hasInterface) pattern = 'Interface-driven';
  else if (hasAsync) pattern = 'Async/functional';
  else if (isExportHeavy) pattern = 'Module/library';
  else pattern = 'Utility';

  return `${fileName} (${language}): ${symbolCount} symbols, ${complexity} complexity, ${pattern} pattern. Key: ${topSymbols || 'Analysis in progress'}`;
}

/**
 * Format function definitions for display
 */
export function formatFunctionDefinitions(functions: any[]): string {
  return functions
    .map(
      (func: any) => `
### ${func.name} ${func.isExported ? '📤' : '🔒'} ${func.isAsync ? '⚡' : ''}
- **Line:** ${func.line}
- **Signature:** \`${func.signature}\`
- **Parameters:** ${func.parameters.length > 0 ? func.parameters.join(', ') : 'None'}
- **Return Type:** ${func.returnType || 'void'}
- **Async:** ${func.isAsync ? 'Yes' : 'No'}
- **Exported:** ${func.isExported ? 'Yes' : 'No'}
- **Is Method:** ${func.isMethod ? 'Yes' : 'No'}
${func.returnedSymbols && func.returnedSymbols.length > 0 ? `- **Returns:** ${func.returnedSymbols.join(', ')}` : ''}
- **Purpose:** ${func.purpose}`
    )
    .join('');
}
