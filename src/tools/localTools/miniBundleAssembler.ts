/**
 * @fileOverview: Mini-bundle assembly with token budgeting for enhanced local context
 * @module: MiniBundleAssembler
 * @keyFunctions:
 *   - assembleMiniBundle(): Create token-budgeted code snippets
 *   - extractSnippetWithContext(): Extract symbol with surrounding context
 *   - normalizeSnippet(): Strip comments, collapse imports, normalize code
 *   - applyTokenBudgeting(): Greedy packing within token limits
 * @context: Assembles tight, relevant code bundles for AI consumption
 */

import { readFileSync } from 'fs';
import { JumpTarget, BundleSnippet } from './enhancedLocalContext';
import { FileInfo } from '../../core/compactor/fileDiscovery';
import { logger } from '../../utils/logger';
import * as path from 'path';
import { estimateTokens } from '../utils/toolHelpers';

// ===== INTERFACES =====

export interface SnippetExtractionOptions {
  maxTokens: number;
  contextLines: number;
  includeHelpers: boolean;
  normalizeCode: boolean;
}

export interface SnippetCandidate {
  target: JumpTarget;
  rawSnippet: string;
  normalizedSnippet: string;
  tokenCount: number;
  priority: number;
  helpers: HelperFunction[];
}

export interface HelperFunction {
  name: string;
  snippet: string;
  tokenCount: number;
  isInlined: boolean;
}

// ===== SNIPPET PRIORITIES =====

export const SNIPPET_PRIORITIES = {
  init: 1.0,
  'read/write': 0.9,
  provider: 0.8,
  search: 0.7,
  tests: 0.6,
  'env/config': 0.5,
  helper: 0.4,
};

// ===== MAIN ASSEMBLY FUNCTION =====

/**
 * Assemble mini-bundle with token budgeting
 */
export async function assembleMiniBundle(
  jumpTargets: JumpTarget[],
  allFiles: FileInfo[],
  maxTokens: number
): Promise<BundleSnippet[]> {
  logger.info('📦 Assembling mini-bundle', {
    targetCount: jumpTargets.length,
    maxTokens,
  });

  if (jumpTargets.length === 0) {
    return [];
  }

  const options: SnippetExtractionOptions = {
    maxTokens,
    contextLines: 30, // Lines above/below symbol
    includeHelpers: true,
    normalizeCode: true,
  };

  // 1. Extract snippets for each target
  const snippetCandidates: SnippetCandidate[] = [];

  for (const target of jumpTargets) {
    try {
      const candidate = await extractSnippetCandidate(target, options);
      if (candidate) {
        snippetCandidates.push(candidate);
      }
    } catch (error) {
      logger.debug('⚠️ Failed to extract snippet', {
        target: target.symbol,
        file: target.file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 2. Sort by priority and confidence
  snippetCandidates.sort((a, b) => {
    const scoreA = a.priority * a.target.confidence;
    const scoreB = b.priority * b.target.confidence;
    return scoreB - scoreA;
  });

  // 3. Apply token budgeting with greedy packing
  const selectedSnippets = applyTokenBudgeting(snippetCandidates, maxTokens);

  // 4. Convert to final bundle format
  const bundle: BundleSnippet[] = selectedSnippets.map(candidate => ({
    file: getRelativePath(candidate.target.file),
    symbol: candidate.target.symbol,
    snippet: candidate.normalizedSnippet,
    byteLen: Buffer.byteLength(candidate.normalizedSnippet, 'utf8'),
  }));

  logger.info('✅ Mini-bundle assembled', {
    candidatesConsidered: snippetCandidates.length,
    snippetsSelected: bundle.length,
    totalTokens: selectedSnippets.reduce((sum, c) => sum + c.tokenCount, 0),
    totalBytes: bundle.reduce((sum, s) => sum + s.byteLen, 0),
  });

  return bundle;
}

// ===== SNIPPET EXTRACTION =====

/**
 * Extract snippet candidate for a jump target
 */
async function extractSnippetCandidate(
  target: JumpTarget,
  options: SnippetExtractionOptions
): Promise<SnippetCandidate | null> {
  try {
    // Read file content
    const content = readFileSync(target.file, 'utf8');
    const lines = content.split('\n');

    // Extract snippet with context
    const rawSnippet = extractSnippetWithContext(
      lines,
      target.start || 0,
      target.end || 0,
      options.contextLines
    );

    if (!rawSnippet.trim()) {
      return null;
    }

    // Normalize snippet if requested
    const normalizedSnippet = options.normalizeCode ? normalizeSnippet(rawSnippet) : rawSnippet;

    // Count tokens
    const tokenCount = estimateTokens(normalizedSnippet);

    // Determine priority based on role
    const priority = determinePriority(target.role, target.symbol);

    // Find helper functions if enabled
    const helpers = options.includeHelpers
      ? await findHelperFunctions(target, content, options)
      : [];

    return {
      target,
      rawSnippet,
      normalizedSnippet,
      tokenCount,
      priority,
      helpers,
    };
  } catch (error) {
    logger.debug('Failed to extract snippet candidate', {
      file: target.file,
      symbol: target.symbol,
      error,
    });
    return null;
  }
}

/**
 * Extract snippet with surrounding context
 */
function extractSnippetWithContext(
  lines: string[],
  startPos: number,
  endPos: number,
  contextLines: number
): string {
  // Convert byte positions to line numbers (approximate)
  let startLine = Math.max(0, Math.floor(startPos / 80) - contextLines);
  let endLine = Math.min(lines.length - 1, Math.floor(endPos / 80) + contextLines);

  // If positions are 0, try to find symbol by scanning lines
  if (startPos === 0 && endPos === 0) {
    // Fallback: extract reasonable chunk around symbol
    startLine = Math.max(0, startLine - 10);
    endLine = Math.min(lines.length - 1, startLine + 40);
  }

  // Expand to include complete function/class blocks
  startLine = findBlockStart(lines, startLine);
  endLine = findBlockEnd(lines, endLine);

  // Include more surrounding context for copyability
  const contextPadding = 3; // Lines before and after
  startLine = Math.max(0, startLine - contextPadding);
  endLine = Math.min(lines.length - 1, endLine + contextPadding);

  const snippet = lines.slice(startLine, endLine + 1).join('\n');
  return snippet;
}

/**
 * Find the start of a code block (function, class, etc.)
 */
function findBlockStart(lines: string[], startLine: number): number {
  // Look backward for function/class/export declarations
  for (let i = startLine; i >= Math.max(0, startLine - 20); i--) {
    const line = lines[i].trim();
    if (line.match(/^(export\s+)?(function|class|const|let|var|interface|type)\s+/)) {
      return i;
    }
    if (line.match(/^(export\s+)?(default\s+)?{/)) {
      return i;
    }
  }
  return startLine;
}

/**
 * Find the end of a code block
 */
function findBlockEnd(lines: string[], endLine: number): number {
  let braceCount = 0;
  let foundOpenBrace = false;

  // Start from current position and find closing brace
  for (let i = endLine; i < Math.min(lines.length, endLine + 30); i++) {
    const line = lines[i];

    for (const char of line) {
      if (char === '{') {
        braceCount++;
        foundOpenBrace = true;
      } else if (char === '}') {
        braceCount--;
        if (foundOpenBrace && braceCount === 0) {
          return i;
        }
      }
    }
  }

  return Math.min(lines.length - 1, endLine + 15);
}

// ===== SNIPPET NORMALIZATION =====

/**
 * Normalize snippet by removing comments, collapsing imports, etc.
 */
function normalizeSnippet(snippet: string): string {
  const lines = snippet.split('\n');
  const normalized: string[] = [];

  let inMultiLineComment = false;
  let importBlock: string[] = [];
  let inImportBlock = false;

  for (let line of lines) {
    const trimmed = line.trim();

    // Handle multi-line comments
    if (trimmed.includes('/*')) {
      inMultiLineComment = true;
    }
    if (inMultiLineComment) {
      if (trimmed.includes('*/')) {
        inMultiLineComment = false;
      }
      continue; // Skip comment lines
    }

    // Skip single-line comments (but keep JSDoc)
    if (trimmed.startsWith('//') && !trimmed.startsWith('/**')) {
      continue;
    }

    // Trim placeholder literals that reduce copy-paste value
    if (trimmed.includes('...') && trimmed.length < 100) {
      // Skip lines that are mostly placeholders
      if (
        trimmed.trim() === '...' ||
        (trimmed.trim().match(/^.*\.\.\..*$/) && trimmed.split('...').length > 2)
      ) {
        continue;
      }
    }

    // Collect imports for collapsing
    if (
      trimmed.startsWith('import ') ||
      (trimmed.startsWith('const ') && trimmed.includes('require('))
    ) {
      if (!inImportBlock && normalized.length > 0) {
        // Add collapsed imports from previous block
        if (importBlock.length > 0) {
          normalized.push(collapseImports(importBlock));
          importBlock = [];
        }
      }
      inImportBlock = true;
      importBlock.push(line);
      continue;
    } else {
      // End of import block
      if (inImportBlock) {
        inImportBlock = false;
        if (importBlock.length > 0) {
          normalized.push(collapseImports(importBlock));
          importBlock = [];
        }
      }
    }

    // Remove TypeScript type-only nodes (simplified)
    if (trimmed.startsWith('type ') && trimmed.includes('=')) {
      continue; // Skip type aliases
    }

    // Collapse long strings
    line = line.replace(/"[^"]{50,}"/g, '"..." /* string literal */');
    line = line.replace(/'[^']{50,}'/g, "'...' /* string literal */");
    line = line.replace(/`[^`]{50,}`/g, '`...` /* template literal */');

    // Keep the line
    normalized.push(line);
  }

  // Add any remaining imports
  if (importBlock.length > 0) {
    normalized.unshift(collapseImports(importBlock));
  }

  return normalized.join('\n');
}

/**
 * Collapse multiple imports into a summary
 */
function collapseImports(imports: string[]): string {
  if (imports.length <= 2) {
    return imports.join('\n');
  }

  const sources = new Set<string>();
  let hasDefault = false;
  let hasNamed = false;

  for (const imp of imports) {
    const match = imp.match(/from\s+['"]([^'"]+)['"]/);
    if (match) {
      sources.add(match[1]);
    }
    if (imp.includes('import {')) hasNamed = true;
    if (imp.includes('import ') && !imp.includes('import {')) hasDefault = true;
  }

  const summary = `// Imports: ${Array.from(sources).join(', ')} ${hasDefault ? '(default)' : ''} ${hasNamed ? '(named)' : ''}`;
  return summary;
}

// ===== HELPER FUNCTION DETECTION =====

/**
 * Find helper functions that should be inlined
 */
async function findHelperFunctions(
  target: JumpTarget,
  fileContent: string,
  options: SnippetExtractionOptions
): Promise<HelperFunction[]> {
  const helpers: HelperFunction[] = [];

  // Simple implementation - could be enhanced with AST analysis
  // Look for function calls within the target symbol's content
  const symbolContent = extractTargetContent(fileContent, target);
  const functionCalls = extractFunctionCalls(symbolContent);

  // For each function call, try to find its definition in the same file
  for (const callName of functionCalls) {
    const helperDefinition = findFunctionDefinition(fileContent, callName);
    if (helperDefinition) {
      const helperSnippet = normalizeSnippet(helperDefinition);
      helpers.push({
        name: callName,
        snippet: helperSnippet,
        tokenCount: estimateTokens(helperSnippet),
        isInlined: false,
      });
    }
  }

  return helpers.slice(0, 3); // Limit to 3 helpers max
}

/**
 * Extract content around target symbol
 */
function extractTargetContent(fileContent: string, target: JumpTarget): string {
  if (target.start && target.end) {
    return fileContent.substring(target.start, target.end);
  }

  // Fallback: search for symbol name and extract surrounding lines
  const lines = fileContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(target.symbol)) {
      const start = Math.max(0, i - 10);
      const end = Math.min(lines.length, i + 20);
      return lines.slice(start, end).join('\n');
    }
  }

  return '';
}

/**
 * Extract function calls from code
 */
function extractFunctionCalls(code: string): string[] {
  const calls: string[] = [];

  // Simple regex to find function calls (could be enhanced)
  const callRegex = /(\w+)\s*\(/g;
  let match;

  while ((match = callRegex.exec(code)) !== null) {
    const funcName = match[1];
    if (
      funcName &&
      !calls.includes(funcName) &&
      !['if', 'for', 'while', 'switch', 'catch'].includes(funcName)
    ) {
      calls.push(funcName);
    }
  }

  return calls.slice(0, 5); // Limit results
}

/**
 * Find function definition in file content
 */
function findFunctionDefinition(fileContent: string, functionName: string): string | null {
  const lines = fileContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for function declarations
    if (
      line.match(new RegExp(`function\\s+${functionName}\\s*\\(`)) ||
      line.match(new RegExp(`const\\s+${functionName}\\s*=`)) ||
      line.match(new RegExp(`${functionName}\\s*:`))
    ) {
      // Extract function body
      const start = i;
      const end = findFunctionEnd(lines, i);
      return lines.slice(start, end + 1).join('\n');
    }
  }

  return null;
}

/**
 * Find end of function definition
 */
function findFunctionEnd(lines: string[], startLine: number): number {
  let braceCount = 0;
  let foundBrace = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];

    for (const char of line) {
      if (char === '{') {
        braceCount++;
        foundBrace = true;
      } else if (char === '}') {
        braceCount--;
        if (foundBrace && braceCount === 0) {
          return i;
        }
      }
    }
  }

  return Math.min(lines.length - 1, startLine + 20);
}

// ===== TOKEN BUDGETING =====

/**
 * Apply greedy token budgeting
 */
function applyTokenBudgeting(
  candidates: SnippetCandidate[],
  maxTokens: number
): SnippetCandidate[] {
  const selected: SnippetCandidate[] = [];
  let remainingTokens = maxTokens;

  // Reserve some tokens for the highest priority items
  const reservedTokens = Math.min(maxTokens * 0.3, 1000);

  // First pass: select high-priority items
  for (const candidate of candidates) {
    if (candidate.priority >= 0.8) {
      if (candidate.tokenCount <= remainingTokens) {
        selected.push(candidate);
        remainingTokens -= candidate.tokenCount;
      }
    }
  }

  // Second pass: fill remaining space greedily
  for (const candidate of candidates) {
    if (candidate.priority < 0.8 && !selected.includes(candidate)) {
      // Only budget for the candidate snippet itself; helpers are not emitted in the bundle
      const totalTokensNeeded = candidate.tokenCount;

      if (totalTokensNeeded <= remainingTokens) {
        selected.push(candidate);
        remainingTokens -= totalTokensNeeded;
      }
    }
  }

  logger.debug('Token budgeting result', {
    maxTokens,
    selectedCount: selected.length,
    tokensUsed: maxTokens - remainingTokens,
    tokensRemaining: remainingTokens,
  });

  return selected;
}

// ===== UTILITY FUNCTIONS =====

/**
 * Determine snippet priority based on role and symbol name
 */
function determinePriority(role?: string, symbol?: string): number {
  // Priority based on role
  if (role) {
    switch (role.toLowerCase()) {
      case 'db init':
      case 'init':
      case 'initialization':
        return SNIPPET_PRIORITIES.init;
      case 'read/query':
      case 'write':
      case 'operation':
        return SNIPPET_PRIORITIES['read/write'];
      case 'provider init':
      case 'provider':
        return SNIPPET_PRIORITIES.provider;
      case 'search':
        return SNIPPET_PRIORITIES.search;
      case 'test':
        return SNIPPET_PRIORITIES.tests;
      case 'config':
      case 'env':
        return SNIPPET_PRIORITIES['env/config'];
    }
  }

  // Priority based on symbol name patterns
  if (symbol) {
    const symbolLower = symbol.toLowerCase();

    if (symbolLower.match(/^(init|initialize|setup|start)/)) {
      return SNIPPET_PRIORITIES.init;
    }
    if (symbolLower.match(/(read|write|query|search|find|get|set)/)) {
      return SNIPPET_PRIORITIES['read/write'];
    }
    if (symbolLower.includes('provider')) {
      return SNIPPET_PRIORITIES.provider;
    }
    if (symbolLower.includes('test')) {
      return SNIPPET_PRIORITIES.tests;
    }
    if (symbolLower.includes('config') || symbolLower.includes('env')) {
      return SNIPPET_PRIORITIES['env/config'];
    }
  }

  return 0.5; // Default priority
}

/**
 * Estimate tokens from text (rough calculation)
 */
// token estimation imported from shared toolHelpers

/**
 * Get relative path for display
 */
function getRelativePath(absolutePath: string): string {
  const parts = absolutePath.split(/[\/\\]/);
  const srcIndex = parts.findIndex(part => part === 'src');
  if (srcIndex >= 0) {
    return parts.slice(srcIndex).join('/');
  }
  return parts.slice(-3).join('/');
}
