/**
 * @fileOverview: AST (Abstract Syntax Tree) analysis utilities
 * @module: ASTAnalysis
 * @keyFunctions:
 *   - generateQuickFileAnalysis(): Generate quick analysis summary from AST data
 * @context: Provides AST-based code analysis and pattern recognition
 */

import * as path from 'path';

/**
 * Generate quick file analysis summary based on AST analysis
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
