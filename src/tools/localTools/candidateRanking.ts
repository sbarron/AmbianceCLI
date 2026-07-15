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

import {
  CandidateSymbol,
  ScoringContext,
  DOMAIN_KEYWORDS,
  extractExplicitSymbolTokens,
} from './enhancedLocalContext';
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
  exactSymbolBoost: number;
  pathPrior: number;
  keywordScore: number;
  surfaceBoost: number;
  degreeBoost: number;
  recencyBoost: number;
  contextBoost: number;
  domainBoost: number;
  embeddingScore: number;
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
  attackPlan: string,
  embeddingScores?: Map<string, number>
): Promise<RankedCandidate[]> {
  logger.info('🎯 Ranking candidates', {
    candidateCount: candidates.length,
    query,
    attackPlan,
    hasEmbeddingScores: !!embeddingScores && embeddingScores.size > 0,
  });

  if (candidates.length === 0) {
    return [];
  }

  // Build scoring context
  const scoringContext: ScoringContext = {
    queryTokens: tokenizeQuery(query),
    explicitSymbolTokens: extractExplicitSymbolTokens(query),
    attackPlan,
    domainKeywords: getDomainKeywordsForPlan(attackPlan),
    projectIndices: projectContext,
  };

  // Build call graph for neighborhood scoring
  const callGraph = await buildCallGraphFromCandidates(candidates, projectContext);

  // Score each candidate
  const rankedCandidates: RankedCandidate[] = [];
  const hasEmbeddings = !!embeddingScores && embeddingScores.size > 0;

  for (const candidate of candidates) {
    const scoreBreakdown = calculateScoreBreakdown(
      candidate,
      scoringContext,
      callGraph,
      embeddingScores
    );
    const finalScore = calculateFinalScore(scoreBreakdown, hasEmbeddings);

    rankedCandidates.push({
      ...candidate,
      finalScore,
      ranking: 0, // Will be set after sorting
      scoreBreakdown,
    });
  }

  // Sort exact symbol hits before broader semantic/file-level matches, then by final score.
  rankedCandidates.sort((a, b) => {
    const exactDelta = b.scoreBreakdown.exactSymbolBoost - a.scoreBreakdown.exactSymbolBoost;
    if (Math.abs(exactDelta) > 0.0001) {
      return exactDelta;
    }
    return b.finalScore - a.finalScore;
  });

  // Collapse the same symbol surfaced by multiple candidate generators before
  // it can consume the result budget more than once.
  const deduplicated = deduplicateRankedCandidates(rankedCandidates);

  // Add diversity, then reserve coverage for every explicit symbol named in
  // the query. This prevents one prolific symbol/file from crowding out a
  // second exact symbol that the agent explicitly requested.
  const diversified = applyDiversityFilter(deduplicated);
  const hybridDiversified = hasEmbeddings
    ? applyHybridFrontier(deduplicated, diversified, scoringContext.explicitSymbolTokens.size === 0)
    : diversified;
  const conceptPrioritized = prioritizeRareConceptCoverage(
    deduplicated,
    hybridDiversified,
    scoringContext.queryTokens,
    scoringContext.explicitSymbolTokens
  );
  const coveragePrioritized = prioritizeExplicitSymbolCoverage(
    deduplicated,
    conceptPrioritized,
    scoringContext.explicitSymbolTokens
  ).slice(0, 20);

  coveragePrioritized.forEach((candidate, index) => {
    candidate.ranking = index + 1;
  });

  logger.info('✅ Candidate ranking completed', {
    totalCandidates: candidates.length,
    rankedCandidates: coveragePrioritized.length,
    topScore: coveragePrioritized[0]?.finalScore || 0,
    averageScore:
      coveragePrioritized.length > 0
        ? coveragePrioritized.reduce((sum, c) => sum + c.finalScore, 0) / coveragePrioritized.length
        : 0,
  });

  return coveragePrioritized;
}

// ===== SCORING CALCULATIONS =====

/**
 * Calculate detailed score breakdown for a candidate
 */
function calculateScoreBreakdown(
  candidate: CandidateSymbol,
  context: ScoringContext,
  callGraph: Map<string, string[]>,
  embeddingScores?: Map<string, number>
): ScoreBreakdown {
  // 1. Path Prior - boost based on file path relevance
  const exactSymbolBoost = calculateExactSymbolBoost(candidate, context);

  // 2. Path Prior - boost based on file path relevance
  const pathPrior = calculatePathPrior(candidate, context);

  // 3. Keyword Score - match against query tokens
  const keywordScore = calculateKeywordScore(candidate, context);

  // 4. Surface Boost - prioritize exports, public symbols
  const surfaceBoost = calculateSurfaceBoost(candidate, context.projectIndices);

  // 5. Degree Boost - call graph connectivity
  const degreeBoost = calculateDegreeBoost(candidate, callGraph);

  // 6. Recency Boost - git recency (if available)
  const recencyBoost = calculateRecencyBoost(candidate, context.projectIndices);

  // 7. Context Boost - surrounding context relevance
  const contextBoost = calculateContextBoost(candidate, context);

  // 8. Domain Boost - domain-specific relevance
  const domainBoost = calculateDomainBoost(candidate, context);

  // 9. Embedding Score - semantic similarity from vector embeddings
  const embeddingScore = calculateEmbeddingScore(candidate, embeddingScores);

  return {
    exactSymbolBoost,
    pathPrior,
    keywordScore,
    surfaceBoost,
    degreeBoost,
    recencyBoost,
    contextBoost,
    domainBoost,
    embeddingScore,
  };
}

/**
 * Calculate final weighted score from breakdown.
 * When embeddings are available, they get significant weight and keyword score is reduced,
 * since embeddings capture semantic intent that keyword matching misses.
 */
function calculateFinalScore(breakdown: ScoreBreakdown, hasEmbeddings: boolean): number {
  const weights = hasEmbeddings
    ? {
        exactSymbolBoost: 0.25,
        pathPrior: 0.1,
        keywordScore: 0.12,
        surfaceBoost: 0.12,
        degreeBoost: 0.08,
        recencyBoost: 0.04,
        contextBoost: 0.1,
        domainBoost: 0.08,
        embeddingScore: 0.3,
      }
    : {
        exactSymbolBoost: 0.3,
        pathPrior: 0.15,
        keywordScore: 0.2,
        surfaceBoost: 0.15,
        degreeBoost: 0.1,
        recencyBoost: 0.05,
        contextBoost: 0.15,
        domainBoost: 0.1,
        embeddingScore: 0.0,
      };

  return (
    breakdown.exactSymbolBoost * weights.exactSymbolBoost +
    breakdown.pathPrior * weights.pathPrior +
    breakdown.keywordScore * weights.keywordScore +
    breakdown.surfaceBoost * weights.surfaceBoost +
    breakdown.degreeBoost * weights.degreeBoost +
    breakdown.recencyBoost * weights.recencyBoost +
    breakdown.contextBoost * weights.contextBoost +
    breakdown.domainBoost * weights.domainBoost +
    breakdown.embeddingScore * weights.embeddingScore
  );
}

// ===== INDIVIDUAL SCORING FUNCTIONS =====

/**
 * Strongly prefer explicit symbol matches before semantic/file-level ranking.
 * This keeps symbol-anchored agent queries surgical without dropping broader
 * semantic candidates from the result set.
 */
function calculateExactSymbolBoost(candidate: CandidateSymbol, context: ScoringContext): number {
  const normalizedSymbol = normalizeIdentifier(candidate.symbol);
  const normalizedFileStem = normalizeIdentifier(
    path.basename(candidate.file).replace(/\.[^.]+$/, '')
  );
  const normalizedSymbolParts = getIdentifierParts(candidate.symbol).map(normalizeIdentifier);

  if (!normalizedSymbol) {
    return 0;
  }

  const candidates = context.explicitSymbolTokens;

  for (const token of candidates) {
    if (normalizedSymbol === token) {
      return 1.0;
    }
  }

  for (const token of candidates) {
    if (normalizedSymbolParts.some(part => part === token)) {
      return 0.9;
    }
  }

  for (const token of candidates) {
    if (normalizedFileStem === token) {
      return 0.7;
    }
  }

  return 0;
}

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
 * Score based on keyword matching.
 * Uses both individual tokens and bigram/phrase tokens for better precision.
 * Bigram matches (e.g., "semanticCompact" matching "semantic" + "compact") score higher
 * than individual word matches to reduce false positives.
 */
function calculateKeywordScore(candidate: CandidateSymbol, context: ScoringContext): number {
  const symbolName = candidate.symbol.toLowerCase();
  const fileName = path.basename(candidate.file).toLowerCase();
  const fileStem = fileName.replace(/\.[^.]+$/, ''); // remove extension

  let score = 0;
  let singleMatches = 0;
  let bigramMatches = 0;

  // Separate single-word tokens from bigram tokens
  const singleTokens: string[] = [];
  const bigramTokens: string[] = [];
  for (const token of context.queryTokens) {
    if (token.includes('_') || /[a-z][A-Z]/.test(token) || token.length > 12) {
      bigramTokens.push(token.toLowerCase());
    } else {
      singleTokens.push(token.toLowerCase());
    }
  }

  // Check symbol name against single-word tokens
  for (const token of singleTokens) {
    if (symbolName.includes(token)) {
      score += 0.25;
      singleMatches++;
    }
    if (fileStem.includes(token)) {
      score += 0.15;
      singleMatches++;
    }
  }

  // Bigram/phrase matches are worth more (higher precision)
  for (const bigram of bigramTokens) {
    if (symbolName.includes(bigram)) {
      score += 0.45;
      bigramMatches++;
    }
    if (fileStem.includes(bigram)) {
      score += 0.3;
      bigramMatches++;
    }
  }

  // Check against domain keywords
  for (const keyword of context.domainKeywords) {
    if (symbolName.includes(keyword.toLowerCase())) {
      score += 0.2;
      singleMatches++;
    }
  }

  // Bonus for multi-token coverage (file/symbol matches several query words)
  const totalMatches = singleMatches + bigramMatches;
  if (totalMatches >= 3) {
    score += 0.3; // Strong multi-word match
  } else if (totalMatches >= 2) {
    score += 0.15;
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

/**
 * Score based on embedding vector similarity.
 * Uses pre-computed per-file similarity scores from the embedding store.
 */
function calculateEmbeddingScore(
  candidate: CandidateSymbol,
  embeddingScores?: Map<string, number>
): number {
  if (!embeddingScores || embeddingScores.size === 0) {
    return 0;
  }

  // Try exact file path match first
  let similarity = embeddingScores.get(candidate.file);

  // Try normalized path variants if exact match fails
  if (similarity === undefined) {
    const normalized = candidate.file.replace(/\\/g, '/');
    similarity = embeddingScores.get(normalized);
  }

  if (similarity === undefined) {
    // Try matching by filename suffix (relative vs absolute paths)
    for (const [filePath, score] of embeddingScores) {
      const normalizedKey = filePath.replace(/\\/g, '/');
      const normalizedCandidate = candidate.file.replace(/\\/g, '/');
      if (
        normalizedKey.endsWith(normalizedCandidate) ||
        normalizedCandidate.endsWith(normalizedKey)
      ) {
        similarity = score;
        break;
      }
    }
  }

  if (similarity === undefined) {
    return 0;
  }

  // Similarity is already 0-1 from cosine similarity; scale for scoring
  // Apply a slight curve to emphasize high-similarity results
  return Math.min(similarity * 1.2, 1.0);
}

// ===== UTILITY FUNCTIONS =====

function candidateIdentity(candidate: CandidateSymbol): string {
  return [
    path.normalize(candidate.file).toLowerCase(),
    normalizeIdentifier(candidate.symbol),
    candidate.start || 0,
    candidate.end || candidate.start || 0,
  ].join(':');
}

function deduplicateRankedCandidates(candidates: RankedCandidate[]): RankedCandidate[] {
  const deduplicated: RankedCandidate[] = [];
  const indexByIdentity = new Map<string, number>();

  for (const candidate of candidates) {
    const identity = candidateIdentity(candidate);
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, deduplicated.length);
      deduplicated.push(candidate);
      continue;
    }

    const existing = deduplicated[existingIndex];
    existing.reasons = [...new Set([...(existing.reasons || []), ...(candidate.reasons || [])])];
    existing.score = Math.max(existing.score || 0, candidate.score || 0);
  }

  return deduplicated;
}

function prioritizeExplicitSymbolCoverage(
  allCandidates: RankedCandidate[],
  diversifiedCandidates: RankedCandidate[],
  explicitTokens: Set<string>
): RankedCandidate[] {
  const selected: RankedCandidate[] = [];
  const selectedIdentities = new Set<string>();

  for (const token of explicitTokens) {
    const match = allCandidates.find(
      candidate =>
        candidate.scoreBreakdown.exactSymbolBoost > 0 &&
        normalizeIdentifier(candidate.symbol) === token
    );
    if (!match) continue;

    const identity = candidateIdentity(match);
    if (!selectedIdentities.has(identity)) {
      selected.push(match);
      selectedIdentities.add(identity);
    }
  }

  for (const candidate of diversifiedCandidates) {
    const identity = candidateIdentity(candidate);
    if (!selectedIdentities.has(identity)) {
      selected.push(candidate);
      selectedIdentities.add(identity);
    }
  }

  return selected;
}

function prioritizeRareConceptCoverage(
  allCandidates: RankedCandidate[],
  blendedCandidates: RankedCandidate[],
  queryTokens: string[],
  explicitTokens: Set<string>
): RankedCandidate[] {
  const stopwords = new Set([
    'about',
    'after',
    'before',
    'budget',
    'context',
    'does',
    'from',
    'have',
    'into',
    'missing',
    'output',
    'preserve',
    'repeated',
    'symbols',
    'token',
    'under',
    'what',
    'when',
    'where',
    'which',
    'while',
    'with',
  ]);
  const tokens = [...new Set(queryTokens.map(normalizeIdentifier))].filter(
    token => token.length >= 5 && !stopwords.has(token) && !explicitTokens.has(token)
  );
  const tokenMatches = tokens
    .map(token => ({
      token,
      matches: allCandidates.filter(candidate => {
        const symbol = normalizeIdentifier(candidate.symbol);
        const fileStem = normalizeIdentifier(path.basename(candidate.file).replace(/\.[^.]+$/, ''));
        return symbol.includes(token) || fileStem.includes(token);
      }),
    }))
    .filter(item => item.matches.length > 0 && item.matches.length <= 30)
    .sort((a, b) => a.matches.length - b.matches.length || b.token.length - a.token.length)
    .slice(0, 4);
  const prioritized: RankedCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: RankedCandidate | undefined): void => {
    if (!candidate) return;
    const identity = candidateIdentity(candidate);
    if (seen.has(identity)) return;
    seen.add(identity);
    prioritized.push(candidate);
  };

  for (const item of tokenMatches) {
    push(item.matches[0]);
  }
  for (const candidate of blendedCandidates) {
    push(candidate);
  }

  return prioritized;
}

/**
 * Reserve a cross-module semantic frontier before filling the result set with
 * structurally ranked candidates. This keeps conceptual queries from stopping
 * at the first lexically plausible subsystem while preserving exact-symbol
 * precision when the query already contains code-shaped anchors.
 */
function applyHybridFrontier(
  allCandidates: RankedCandidate[],
  diversifiedCandidates: RankedCandidate[],
  conceptualQuery: boolean
): RankedCandidate[] {
  const semanticQuota = conceptualQuery ? 8 : 4;
  const semanticCandidates = allCandidates
    .filter(candidate => candidate.kind === 'embedding')
    .sort(
      (a, b) =>
        (a.semanticRank ?? Number.MAX_SAFE_INTEGER) - (b.semanticRank ?? Number.MAX_SAFE_INTEGER) ||
        b.finalScore - a.finalScore
    );
  const structuralCandidates = diversifiedCandidates.filter(
    candidate => candidate.kind !== 'embedding'
  );
  const semanticFrontier = selectSemanticFrontier(semanticCandidates, semanticQuota);
  const blended: RankedCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: RankedCandidate | undefined): void => {
    if (!candidate) return;
    const identity = candidateIdentity(candidate);
    if (seen.has(identity)) return;
    seen.add(identity);
    blended.push(candidate);
  };

  const width = Math.max(semanticFrontier.length, structuralCandidates.length);
  for (let index = 0; index < width && blended.length < 20; index++) {
    if (conceptualQuery) {
      push(semanticFrontier[index]);
      push(structuralCandidates[index]);
    } else {
      push(structuralCandidates[index]);
      push(semanticFrontier[index]);
    }
  }

  for (const candidate of diversifiedCandidates) {
    if (blended.length >= 20) break;
    push(candidate);
  }

  return blended;
}

function selectSemanticFrontier(candidates: RankedCandidate[], quota: number): RankedCandidate[] {
  const sourcePattern = /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|rb|php|swift|kt)$/i;
  const sourceCandidates = candidates.filter(candidate => sourcePattern.test(candidate.file));
  const supportingCandidates = candidates.filter(candidate => !sourcePattern.test(candidate.file));
  const selected: RankedCandidate[] = [];
  const seenFiles = new Set<string>();
  const seenModules = new Set<string>();

  const addPass = (pool: RankedCandidate[], requireNewModule: boolean, limit: number): void => {
    for (const candidate of pool) {
      if (selected.length >= limit) return;
      const file = path.normalize(candidate.file).toLowerCase();
      const module = semanticModuleKey(candidate.file);
      if (seenFiles.has(file)) continue;
      if (requireNewModule && seenModules.has(module)) continue;
      selected.push(candidate);
      seenFiles.add(file);
      seenModules.add(module);
    }
  };

  addPass(sourceCandidates, true, Math.max(1, quota - 1));
  addPass(sourceCandidates, false, Math.max(1, quota - 1));
  addPass(supportingCandidates, true, quota);
  addPass(supportingCandidates, false, quota);

  return selected.slice(0, quota);
}

function semanticModuleKey(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
  const srcIndex = parts.lastIndexOf('src');
  if (srcIndex >= 0) {
    return parts.slice(srcIndex, srcIndex + 2).join('/');
  }
  return parts.slice(-3, -1).join('/') || parts.slice(0, 2).join('/');
}

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
      return [];
  }
}

/**
 * Tokenize query into searchable terms.
 * Produces both individual words AND meaningful bigrams/phrases so that
 * queries like "context command" match the compound concept, not just
 * every file containing "context" or "command" individually.
 */
function tokenizeQuery(query: string): string[] {
  const STOPWORDS = new Set([
    'a',
    'an',
    'the',
    'and',
    'or',
    'but',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'from',
    'it',
    'its',
    'this',
    'that',
    'my',
    'your',
  ]);

  // Keep question words as weak signals rather than removing entirely
  const WEAK_WORDS = new Set([
    'how',
    'does',
    'can',
    'will',
    'what',
    'where',
    'when',
    'why',
    'which',
  ]);

  // Split into raw words
  const rawWords = query
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s\-_\.\,\?\!]+/)
    .filter(w => w.length > 1);

  const rawSymbolTokens = query
    .split(/[\s,\?\!]+/)
    .map(token => token.trim())
    .filter(token => token.length > 1);

  // Meaningful words (not stopwords, length > 2)
  const meaningful = rawWords.filter(w => w.length > 2 && !STOPWORDS.has(w) && !WEAK_WORDS.has(w));

  // Build bigrams from consecutive meaningful words for phrase matching
  // e.g., "context command" from "how does the context command build its response"
  const bigrams: string[] = [];
  for (let i = 0; i < rawWords.length - 1; i++) {
    const a = rawWords[i];
    const b = rawWords[i + 1];
    // Only make bigrams from non-stopword pairs
    if (a.length > 2 && b.length > 2 && !STOPWORDS.has(a) && !STOPWORDS.has(b)) {
      bigrams.push(`${a}${b}`); // concatenated: "contextcommand"
      bigrams.push(`${a}_${b}`); // underscore: "context_command"
      bigrams.push(`${a}${b[0].toUpperCase()}${b.slice(1)}`); // camelCase: "contextCommand"
    }
  }

  // Also generate camelCase split tokens from meaningful words
  // e.g., "handleSemanticCompact" should match query "semantic compact"
  const camelTokens: string[] = [];
  for (const word of meaningful) {
    // If the word itself looks like camelCase, split it
    const parts = word
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(' ');
    if (parts.length > 1) {
      camelTokens.push(...parts.filter(p => p.length > 2));
    }
  }

  return [...new Set([...meaningful, ...bigrams, ...camelTokens, ...rawSymbolTokens])];
}

function normalizeIdentifier(value: string): string {
  return value
    .replace(/^import from\s+/i, '')
    .replace(/^new\s+/i, '')
    .replace(/^[A-Z]+\s+/, '')
    .replace(/[^A-Za-z0-9_$]+/g, '')
    .toLowerCase();
}

function getIdentifierParts(value: string): string[] {
  return value
    .replace(/^import from\s+/i, '')
    .replace(/^new\s+/i, '')
    .replace(/^[A-Z]+\s+/, '')
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean);
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
