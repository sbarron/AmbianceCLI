/**
 * @fileOverview: Candidate ranking and scoring system for enhanced local context
 * @module: CandidateRanking
 * @keyFunctions:
 *   - rankCandidatesWithScoring(): Score and rank symbol candidates
 *   - calculateRelevanceScore(): Multi-factor relevance scoring
 *   - buildCallGraphNeighborhood(): Add call-graph context
 *   - applyDomainBoosts(): Domain-specific ranking adjustments
 * @context: Provides intelligent ranking of code symbols based on query relevance and structural importance
 */

import { CandidateSymbol, ScoringContext, DOMAIN_KEYWORDS } from './enhancedLocalContext';
import { FileInfo } from '../../core/compactor/fileDiscovery';
import { logger } from '../../utils/logger';
import * as path from 'path';

// ===== SCORING INTERFACES =====

export interface RankedCandidate extends CandidateSymbol {
  finalScore: number;
  ranking: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  pathPrior: number;
  keywordScore: number;
  surfaceBoost: number;
  degreeBoost: number;
  recencyBoost: number;
  contextBoost: number;
  domainBoost: number;
}

export interface ProjectContext {
  files: FileInfo[];
  exports: any[];
  imports: any[];
  routes: any[];
  env: any[];
  systems: any;
  callGraph?: Map<string, string[]>;
}

// ===== MAIN RANKING FUNCTION =====

/**
 * Rank candidates using multi-factor scoring
 */
export async function rankCandidatesWithScoring(
  candidates: CandidateSymbol[],
  projectContext: ProjectContext,
  query: string,
  attackPlan: string
): Promise<RankedCandidate[]> {
  logger.info('🎯 Ranking candidates', {
    candidateCount: candidates.length,
    query,
    attackPlan,
  });

  if (candidates.length === 0) {
    return [];
  }

  // Build scoring context
  const scoringContext: ScoringContext = {
    queryTokens: tokenizeQuery(query),
    attackPlan,
    domainKeywords: getDomainKeywordsForPlan(attackPlan),
    projectIndices: projectContext,
  };

  // Build call graph for neighborhood scoring
  const callGraph = await buildCallGraphFromCandidates(candidates, projectContext);

  // Score each candidate
  const rankedCandidates: RankedCandidate[] = [];

  for (const candidate of candidates) {
    const scoreBreakdown = calculateScoreBreakdown(candidate, scoringContext, callGraph);
    const finalScore = calculateFinalScore(scoreBreakdown);

    rankedCandidates.push({
      ...candidate,
      finalScore,
      ranking: 0, // Will be set after sorting
      scoreBreakdown,
    });
  }

  // Sort by final score (descending)
  rankedCandidates.sort((a, b) => b.finalScore - a.finalScore);

  // Assign rankings
  rankedCandidates.forEach((candidate, index) => {
    candidate.ranking = index + 1;
  });

  // Add diversity - ensure we don't have too many from the same file
  const diversified = applyDiversityFilter(rankedCandidates);

  logger.info('✅ Candidate ranking completed', {
    totalCandidates: candidates.length,
    rankedCandidates: diversified.length,
    topScore: diversified[0]?.finalScore || 0,
    averageScore:
      diversified.length > 0
        ? diversified.reduce((sum, c) => sum + c.finalScore, 0) / diversified.length
        : 0,
  });

  return diversified;
}

// ===== SCORING CALCULATIONS =====

/**
 * Calculate detailed score breakdown for a candidate
 */
function calculateScoreBreakdown(
  candidate: CandidateSymbol,
  context: ScoringContext,
  callGraph: Map<string, string[]>
): ScoreBreakdown {
  // 1. Path Prior - boost based on file path relevance
  const pathPrior = calculatePathPrior(candidate, context);

  // 2. Keyword Score - match against query tokens
  const keywordScore = calculateKeywordScore(candidate, context);

  // 3. Surface Boost - prioritize exports, public symbols
  const surfaceBoost = calculateSurfaceBoost(candidate, context.projectIndices);

  // 4. Degree Boost - call graph connectivity
  const degreeBoost = calculateDegreeBoost(candidate, callGraph);

  // 5. Recency Boost - git recency (if available)
  const recencyBoost = calculateRecencyBoost(candidate, context.projectIndices);

  // 6. Context Boost - surrounding context relevance
  const contextBoost = calculateContextBoost(candidate, context);

  // 7. Domain Boost - domain-specific relevance
  const domainBoost = calculateDomainBoost(candidate, context);

  return {
    pathPrior,
    keywordScore,
    surfaceBoost,
    degreeBoost,
    recencyBoost,
    contextBoost,
    domainBoost,
  };
}

/**
 * Calculate final weighted score from breakdown
 */
function calculateFinalScore(breakdown: ScoreBreakdown): number {
  const weights = {
    pathPrior: 0.15,
    keywordScore: 0.25,
    surfaceBoost: 0.2,
    degreeBoost: 0.1,
    recencyBoost: 0.05,
    contextBoost: 0.15,
    domainBoost: 0.1,
  };

  return (
    breakdown.pathPrior * weights.pathPrior +
    breakdown.keywordScore * weights.keywordScore +
    breakdown.surfaceBoost * weights.surfaceBoost +
    breakdown.degreeBoost * weights.degreeBoost +
    breakdown.recencyBoost * weights.recencyBoost +
    breakdown.contextBoost * weights.contextBoost +
    breakdown.domainBoost * weights.domainBoost
  );
}

// ===== INDIVIDUAL SCORING FUNCTIONS =====

/**
 * Score based on file path relevance
 */
function calculatePathPrior(candidate: CandidateSymbol, context: ScoringContext): number {
  const relPath = getRelativePath(candidate.file);
  const pathLower = relPath.toLowerCase();

  let score = 0.5; // Base score

  // Boost for domain-relevant paths
  for (const keyword of context.domainKeywords) {
    if (pathLower.includes(keyword.toLowerCase())) {
      score += 0.1;
    }
  }

  // Boost for certain path patterns
  if (pathLower.includes('/local/') || pathLower.includes('\\local\\')) score += 0.15;
  if (pathLower.includes('/core/') || pathLower.includes('\\core\\')) score += 0.1;
  if (pathLower.includes('/api/') || pathLower.includes('\\api\\')) score += 0.12;
  if (pathLower.includes('/db/') || pathLower.includes('\\db\\')) score += 0.12;
  if (pathLower.includes('/auth/') || pathLower.includes('\\auth\\')) score += 0.12;

  // Penalize test files (unless debugging)
  if (pathLower.includes('test') || pathLower.includes('spec')) {
    score *= context.attackPlan === 'debug' ? 1.1 : 0.7;
  }

  // Strong negative priors for known noise paths
  // Demote scripts, benchmarks, fixtures, examples, and projection_matrix-like files
  if (pathLower.includes('/scripts/') || pathLower.includes('\\scripts\\')) {
    score -= 0.6; // strong demotion
  }
  if (pathLower.includes('projection_matrix')) {
    score -= 0.9; // kill this nearly entirely
  }
  if (/(benchmarks|fixtures|examples)/.test(pathLower)) {
    score -= 0.3; // mild demotion
  }
  // Demote telemetry/metrics/worker/job directories which are often orthogonal
  if (/(metrics|telemetry|observability|worker|jobs?|queue)/.test(pathLower)) {
    score -= 0.4;
  }

  // Floor at 0 and cap at 1
  score = Math.max(0, Math.min(score, 1.0));
  return score;
}

/**
 * Score based on keyword matching
 */
function calculateKeywordScore(candidate: CandidateSymbol, context: ScoringContext): number {
  const symbolName = candidate.symbol.toLowerCase();
  const fileName = path.basename(candidate.file).toLowerCase();

  let score = 0;
  let matches = 0;

  // Check symbol name against query tokens
  for (const token of context.queryTokens) {
    const tokenLower = token.toLowerCase();
    if (symbolName.includes(tokenLower)) {
      score += 0.3;
      matches++;
    }
    if (fileName.includes(tokenLower)) {
      score += 0.15;
      matches++;
    }
  }

  // Check against domain keywords
  for (const keyword of context.domainKeywords) {
    if (symbolName.includes(keyword.toLowerCase())) {
      score += 0.2;
      matches++;
    }
  }

  // Bonus for exact or close matches
  if (matches > 0) {
    const queryText = context.queryTokens.join(' ').toLowerCase();
    if (symbolName.includes(queryText)) {
      score += 0.4;
    }
  }

  // Topic-aware boosts: API and Components
  if (context.attackPlan === 'api-route') {
    if (
      /app\/.*\/route\.(ts|js)$/.test(candidate.file.replace(/\\/g, '/')) ||
      /pages\/api\//.test(candidate.file.replace(/\\/g, '/'))
    ) {
      score += 0.3;
    }
  }
  if (context.attackPlan === 'understand' || context.attackPlan === 'auto') {
    // If query mentions components/UI, lightly boost component files
    const qt = context.queryTokens.join(' ');
    if (/(component|components|ui|page|jsx|sfc)/i.test(qt)) {
      if (/\.(tsx|jsx)$/i.test(candidate.file) || /\/components\//i.test(candidate.file)) {
        score += 0.2;
      }
    }
  }

  return Math.min(score, 1.0);
}

/**
 * Boost for exported/public symbols
 */
function calculateSurfaceBoost(candidate: CandidateSymbol, projectContext: any): number {
  let score = 0.3; // Base score

  // Boost for different symbol types
  switch (candidate.kind) {
    case 'export':
      score += 0.4;
      // Extra boost for React components detected via returnsJsx
      if (candidate.reasons && candidate.reasons.some(r => r.includes('export:returnsJsx'))) {
        score += 0.25;
      }
      break;
    case 'function':
      score += 0.2;
      break;
    case 'class':
      score += 0.25;
      break;
    case 'interface':
      score += 0.15;
      break;
    case 'call':
      score += 0.1;
      break;
    default:
      score += 0.05;
  }

  // Check if this symbol is in the exports index
  if (
    projectContext.exports &&
    projectContext.exports.some(
      (exp: any) => exp.name === candidate.symbol || exp.file === candidate.file
    )
  ) {
    score += 0.3;
  }

  // Boost for MCP tool handlers
  if (candidate.symbol.includes('handle') || candidate.symbol.includes('tool')) {
    score += 0.2;
  }

  // Boost for initializers
  if (candidate.symbol.match(/^(init|initialize|setup|start|create)/i)) {
    score += 0.25;
  }

  return Math.min(score, 1.0);
}

/**
 * Score based on call graph degree
 */
function calculateDegreeBoost(
  candidate: CandidateSymbol,
  callGraph: Map<string, string[]>
): number {
  const symbolKey = `${candidate.file}:${candidate.symbol}`;
  const connections = callGraph.get(symbolKey) || [];

  // Normalize degree to 0-1 range
  const maxDegree = 20; // Reasonable upper bound
  const normalizedDegree = Math.min(connections.length / maxDegree, 1.0);

  // Apply curve - high connectivity is good, but not everything
  return 0.3 + normalizedDegree * 0.4;
}

/**
 * Score based on file modification recency (fallback when git is not available)
 */
function calculateRecencyBoost(candidate: CandidateSymbol, projectContext: any): number {
  try {
    const fs = require('fs');
    const path = require('path');

    // Use file modification time as a proxy for recency
    const filePath = path.join(projectContext?.projectPath || '', candidate.file || '');
    const stats = fs.statSync(filePath);
    const daysSinceModified = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

    // Files modified within 1 day: high boost (1.0)
    // Files modified within 7 days: medium boost (0.7)
    // Files modified within 30 days: low boost (0.5)
    // Older files: neutral score (0.3)
    if (daysSinceModified <= 1) return 1.0;
    if (daysSinceModified <= 7) return 0.7;
    if (daysSinceModified <= 30) return 0.5;
    return 0.3;
  } catch (error) {
    // If file doesn't exist or can't be accessed, return neutral score
    return 0.5;
  }
}

/**
 * Score based on surrounding context
 */
function calculateContextBoost(candidate: CandidateSymbol, context: ScoringContext): number {
  let score = 0.4; // Base score

  // Check if candidate has helpful reasons/context
  if (candidate.reasons && candidate.reasons.length > 0) {
    score += 0.2;

    // Boost if reasons mention query terms
    for (const reason of candidate.reasons) {
      for (const token of context.queryTokens) {
        if (reason.toLowerCase().includes(token.toLowerCase())) {
          score += 0.1;
        }
      }
    }
  }

  // Boost based on role assignment
  if (candidate.role) {
    switch (candidate.role) {
      case 'interface':
      case 'entry':
        score += 0.25;
        break;
      case 'core':
      case 'init':
        score += 0.2;
        break;
      case 'operation':
        score += 0.15;
        break;
      case 'config':
        score += 0.1;
        break;
    }
  }

  return Math.min(score, 1.0);
}

/**
 * Domain-specific scoring boost
 */
function calculateDomainBoost(candidate: CandidateSymbol, context: ScoringContext): number {
  let score = 0.4; // Base score

  const symbolLower = candidate.symbol.toLowerCase();
  const fileLower = candidate.file.toLowerCase();

  // Domain-specific patterns based on attack plan
  switch (context.attackPlan) {
    case 'init-read-write':
      if (symbolLower.match(/(init|initialize|connect|open|create|setup)/)) score += 0.3;
      if (symbolLower.match(/(read|write|query|search|find|insert|update|delete)/)) score += 0.25;
      if (fileLower.includes('storage') || fileLower.includes('database')) score += 0.2;
      break;

    case 'api-route':
      if (symbolLower.match(/(get|post|put|delete|patch|route|handler)/)) score += 0.3;
      if (fileLower.includes('api') || fileLower.includes('route')) score += 0.25;
      if (symbolLower.includes('app.') || symbolLower.includes('router.')) score += 0.2;
      break;

    case 'auth':
      if (symbolLower.match(/(auth|login|verify|token|session|password)/)) score += 0.3;
      if (fileLower.includes('auth') || fileLower.includes('session')) score += 0.25;
      if (symbolLower.match(/(middleware|guard|protect)/)) score += 0.2;
      break;

    case 'error-driven':
      if (symbolLower.match(/(error|exception|catch|throw|fail)/)) score += 0.3;
      if (candidate.kind === 'call' && symbolLower.includes('catch')) score += 0.25;
      break;
  }

  return Math.min(score, 1.0);
}

// ===== UTILITY FUNCTIONS =====

/**
 * Build call graph from candidates
 */
async function buildCallGraphFromCandidates(
  candidates: CandidateSymbol[],
  projectContext: ProjectContext
): Promise<Map<string, string[]>> {
  const callGraph = new Map<string, string[]>();

  // Simple implementation - could be enhanced with actual AST analysis
  for (const candidate of candidates) {
    const key = `${candidate.file}:${candidate.symbol}`;

    // Find related symbols (same file, similar names, etc.)
    const related = candidates
      .filter(
        c =>
          c.file === candidate.file ||
          c.symbol.includes(candidate.symbol) ||
          candidate.symbol.includes(c.symbol)
      )
      .map(c => `${c.file}:${c.symbol}`)
      .filter(k => k !== key);

    callGraph.set(key, related);
  }

  return callGraph;
}

/**
 * Apply diversity filter to avoid too many results from same file
 */
function applyDiversityFilter(
  candidates: RankedCandidate[],
  maxPerFile: number = 3
): RankedCandidate[] {
  const fileCount = new Map<string, number>();
  const filtered: RankedCandidate[] = [];

  for (const candidate of candidates) {
    const currentCount = fileCount.get(candidate.file) || 0;

    if (currentCount < maxPerFile) {
      filtered.push(candidate);
      fileCount.set(candidate.file, currentCount + 1);
    }

    // Stop if we have enough diverse results
    if (filtered.length >= 20) break;
  }

  return filtered;
}

/**
 * Get domain keywords for attack plan
 */
function getDomainKeywordsForPlan(plan: string): string[] {
  switch (plan) {
    case 'init-read-write':
      return [...DOMAIN_KEYWORDS.database, ...DOMAIN_KEYWORDS.init];
    case 'api-route':
      return DOMAIN_KEYWORDS.api;
    case 'auth':
      return DOMAIN_KEYWORDS.auth;
    case 'error-driven':
      return ['error', 'exception', 'fail', 'catch', 'throw'];
    default:
      return Object.values(DOMAIN_KEYWORDS).flat();
  }
}

/**
 * Tokenize query into searchable terms
 */
function tokenizeQuery(query: string): string[] {
  // Split on common delimiters and filter meaningful words
  const tokens = query
    .toLowerCase()
    .split(/[\s\-_\.\,\?\!]+/)
    .filter(token => token.length > 2)
    .filter(
      token =>
        !['and', 'the', 'how', 'does', 'can', 'will', 'what', 'where', 'when'].includes(token)
    );

  return [...new Set(tokens)]; // Remove duplicates
}

/**
 * Get relative path for display
 */
function getRelativePath(absolutePath: string): string {
  // Simple implementation - could use proper path resolution
  const parts = absolutePath.split(/[\/\\]/);
  const srcIndex = parts.findIndex(part => part === 'src');
  if (srcIndex >= 0) {
    return parts.slice(srcIndex).join('/');
  }
  return parts.slice(-3).join('/'); // Last 3 parts
}
