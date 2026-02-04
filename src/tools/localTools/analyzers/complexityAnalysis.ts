/**
 * @fileOverview: Cyclomatic complexity analysis for code files
 * @module: ComplexityAnalysis
 * @keyFunctions:
 *   - calculateCyclomaticComplexity(): Calculate cyclomatic complexity metrics
 * @context: Provides code complexity analysis for quality assessment
 */

/**
 * Calculate cyclomatic complexity for source code
 */
export function calculateCyclomaticComplexity(code: string): {
  totalComplexity: number;
  decisionPoints: number;
  rating: string;
  description: string;
  breakdown: Record<string, number>;
} {
  // Remove comments and strings to avoid false positives
  const cleanCode = code
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, '') // Remove line comments
    .replace(/['`](?:[^'`\\]|\\.)*['`]/g, '') // Remove template literals and strings
    .replace(/"(?:[^"\\]|\\.)*"/g, ''); // Remove double-quoted strings

  // Count decision points that add to cyclomatic complexity
  const patterns = [
    { name: 'if', pattern: /\bif\s*\(/g },
    { name: 'else-if', pattern: /\belse\s+if\s*\(/g },
    { name: 'while', pattern: /\bwhile\s*\(/g },
    { name: 'for', pattern: /\bfor\s*\(/g },
    { name: 'do-while', pattern: /\bdo\s*\{/g },
    { name: 'switch-case', pattern: /\bcase\s+/g },
    { name: 'catch', pattern: /\bcatch\s*\(/g },
    { name: 'logical-and', pattern: /&&/g },
    { name: 'logical-or', pattern: /\|\|/g },
    { name: 'ternary', pattern: /\?\s*[^.\s]/g },
    { name: 'optional-chain', pattern: /\?\./g },
    { name: 'nullish-coalescing', pattern: /\?\?/g },
  ];

  let totalDecisionPoints = 0;
  const breakdown: Record<string, number> = {};

  patterns.forEach(({ name, pattern }) => {
    const matches = cleanCode.match(pattern) || [];
    breakdown[name] = matches.length;
    totalDecisionPoints += matches.length;
  });

  // Base complexity is 1, plus decision points
  const totalComplexity = 1 + totalDecisionPoints;

  // Determine rating and description
  let rating = 'low';
  let description = '';
  if (totalComplexity <= 10) {
    rating = 'low';
    description = 'Simple, easy to test and maintain';
  } else if (totalComplexity <= 20) {
    rating = 'moderate';
    description = 'More complex, moderate risk';
  } else if (totalComplexity <= 50) {
    rating = 'high';
    description = 'Complex, high risk for defects';
  } else {
    rating = 'very high';
    description = 'Very complex, difficult to test and maintain';
  }

  return {
    totalComplexity,
    decisionPoints: totalDecisionPoints,
    rating,
    description,
    breakdown,
  };
}
