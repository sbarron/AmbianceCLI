/**
 * @fileOverview: Risk scoring system for frontend applications
 * @module: RiskAnalyzer
 * @keyFunctions:
 *   - analyzeRisks(): Calculate overall risk score based on weighted issues
 *   - generateRecommendations(): Provide actionable next steps based on findings
 *   - evaluateRiskRules(): Apply specific risk rules with severity weights
 * @context: Evaluates code quality, security, and performance risks with actionable recommendations
 */

import type { PerformanceAnalysis } from './performance';
import type { AccessibilityAnalysis } from './accessibility';
import type { EnvironmentAnalysis } from './environment';
import type { ComponentInfo } from './components';
import { logger } from '../../../../utils/logger';

export interface RiskRule {
  id: string;
  why: string;
  evidence: string[];
  severity: 'high' | 'medium' | 'low';
  weight: number;
  recommendation: string;
}

export interface RiskAnalysis {
  score: number;
  trustedScore: number; // Score excluding non-app contexts
  rules: RiskRule[];
  recommendations: Array<{ title: string; priority: 'high' | 'medium' | 'low'; files?: string[] }>;
  scoreReductionActions: Array<{
    action: string;
    estimatedReduction: number;
    category: string;
    priority: 'high' | 'medium' | 'low';
    files?: string[];
  }>;
}

/**
 * Risk rule definitions with new weighting system:
 * Env/Sec ×5, Perf ×3, A11y ×2, DX ×1
 */
const RISK_RULES = {
  'ENV-002': {
    weight: 25, // 5 × 5 (Env/Sec category)
    severity: 'high' as const,
    why: 'Server-only environment variables referenced in client code',
    recommendation: 'Move sensitive data to server-side only or use NEXT_PUBLIC_ prefix',
    category: 'env',
  },
  'SEC-001': {
    weight: 20, // 4 × 5 (Security in Env/Sec category)
    severity: 'high' as const,
    why: 'External links missing security attributes',
    recommendation: 'Add rel="noopener noreferrer" to external links',
    category: 'env',
  },
  'PERF-001': {
    weight: 15, // 5 × 3 (Perf category)
    severity: 'high' as const,
    why: 'Heavy client imports without dynamic loading',
    recommendation: 'Use next/dynamic with ssr: false for heavy components',
    category: 'perf',
  },
  'PERF-002': {
    weight: 6, // 2 × 3 (Perf category)
    severity: 'medium' as const,
    why: 'Images not using Next.js Image component',
    recommendation: 'Replace <img> with <Image> for automatic optimization',
    category: 'perf',
  },
  'A11Y-001': {
    weight: 10, // 5 × 2 (A11y category)
    severity: 'medium' as const,
    why: 'Images missing alt attributes',
    recommendation: 'Add descriptive alt text to all images for screen reader accessibility',
    category: 'a11y',
  },
  'A11Y-002': {
    weight: 8, // 4 × 2 (A11y category)
    severity: 'medium' as const,
    why: 'Interactive elements missing accessible labels',
    recommendation: 'Add aria-label, aria-labelledby, or associate with label elements',
    category: 'a11y',
  },
  'ROUTER-001': {
    weight: 5, // 5 × 1 (DX category)
    severity: 'medium' as const,
    why: 'Routes with data fetching missing loading/error boundaries',
    recommendation: 'Add loading.tsx and error.tsx to routes with data fetching',
    category: 'dx',
  },
  'STATE-001': {
    weight: 3, // 3 × 1 (DX category)
    severity: 'low' as const,
    why: 'Repeated ad-hoc fetch calls to same endpoints',
    recommendation: 'Consolidate API calls using React Query or custom hooks',
    category: 'dx',
  },
};

/**
 * Check if a file is in a non-app context (tests, etc.)
 */
function isNonAppContext(filePath: string): boolean {
  const path = filePath.toLowerCase();
  return (
    path.includes('/test') ||
    path.includes('/tests') ||
    path.includes('/__tests__') ||
    path.includes('/spec') ||
    path.includes('.test.') ||
    path.includes('.spec.') ||
    path.includes('/jest.') ||
    path.includes('/scripts/') ||
    path.includes('/tooling/') ||
    path.includes('/mocks/') ||
    path.includes('/fixtures/')
  );
}

/**
 * Filter issues to exclude non-app contexts
 */
function filterAppContextIssues<T extends { file: string }>(issues: T[]): T[] {
  return issues.filter(issue => !isNonAppContext(issue.file));
}

/**
 * Evaluate environment variable risks (ENV-002)
 */
function evaluateEnvironmentRisks(envAnalysis: EnvironmentAnalysis): RiskRule[] {
  const rules: RiskRule[] = [];

  // Filter out test files and other non-app contexts
  const appContextLeaks = filterAppContextIssues(envAnalysis.clientLeaks);

  if (appContextLeaks.length > 0) {
    const evidence = appContextLeaks.map(leak => `${leak.key} in ${leak.file}:${leak.line}`);

    rules.push({
      id: 'ENV-002',
      why: RISK_RULES['ENV-002'].why,
      evidence,
      severity: RISK_RULES['ENV-002'].severity,
      weight: RISK_RULES['ENV-002'].weight,
      recommendation: RISK_RULES['ENV-002'].recommendation,
    });
  }

  return rules;
}

/**
 * Evaluate accessibility risks (A11Y-001, A11Y-002, SEC-001)
 */
function evaluateAccessibilityRisks(accessibilityAnalysis: AccessibilityAnalysis): RiskRule[] {
  const rules: RiskRule[] = [];

  // A11Y-001: Missing alt tags (filter non-app contexts)
  const appContextAltTags = filterAppContextIssues(accessibilityAnalysis.missingAltTags);
  if (appContextAltTags.length > 0) {
    const evidence = appContextAltTags.map(issue => `${issue.file}:${issue.line}`);

    rules.push({
      id: 'A11Y-001',
      why: RISK_RULES['A11Y-001'].why,
      evidence,
      severity: RISK_RULES['A11Y-001'].severity,
      weight: RISK_RULES['A11Y-001'].weight,
      recommendation: RISK_RULES['A11Y-001'].recommendation,
    });
  }

  // A11Y-002: Missing accessible labels (filter non-app contexts)
  const appContextAriaLabels = filterAppContextIssues(accessibilityAnalysis.missingAriaLabels);
  if (appContextAriaLabels.length > 0) {
    const evidence = appContextAriaLabels.map(issue => `${issue.file}:${issue.line}`);

    rules.push({
      id: 'A11Y-002',
      why: RISK_RULES['A11Y-002'].why,
      evidence,
      severity: RISK_RULES['A11Y-002'].severity,
      weight: RISK_RULES['A11Y-002'].weight,
      recommendation: RISK_RULES['A11Y-002'].recommendation,
    });
  }

  // SEC-001: Security attributes (filter non-app contexts)
  const appContextSecurityAttrs = filterAppContextIssues(
    accessibilityAnalysis.missingSecurityAttributes
  );
  if (appContextSecurityAttrs.length > 0) {
    const evidence = appContextSecurityAttrs.map(issue => `${issue.file}:${issue.line}`);

    rules.push({
      id: 'SEC-001',
      why: RISK_RULES['SEC-001'].why,
      evidence,
      severity: RISK_RULES['SEC-001'].severity,
      weight: RISK_RULES['SEC-001'].weight,
      recommendation: RISK_RULES['SEC-001'].recommendation,
    });
  }

  return rules;
}

/**
 * Evaluate performance risks (PERF-001, PERF-002)
 */
function evaluatePerformanceRisks(perfAnalysis: PerformanceAnalysis): RiskRule[] {
  const rules: RiskRule[] = [];

  // PERF-001: Heavy imports without dynamic loading
  if (perfAnalysis.noDynamicImportCandidates.length > 0) {
    const evidence = perfAnalysis.noDynamicImportCandidates.map(file => file);

    rules.push({
      id: 'PERF-001',
      why: RISK_RULES['PERF-001'].why,
      evidence,
      severity: RISK_RULES['PERF-001'].severity,
      weight: RISK_RULES['PERF-001'].weight,
      recommendation: RISK_RULES['PERF-001'].recommendation,
    });
  }

  // PERF-002: Non-optimized images - simplified check
  // Since we removed detailed image tracking, we'll use a basic heuristic
  if (perfAnalysis.heavyClientImports.length > 3) {
    rules.push({
      id: 'PERF-002',
      why: RISK_RULES['PERF-002'].why,
      evidence: ['Multiple heavy imports detected - potential for non-optimized assets'],
      severity: RISK_RULES['PERF-002'].severity,
      weight: RISK_RULES['PERF-002'].weight,
      recommendation: RISK_RULES['PERF-002'].recommendation,
    });
  }

  return rules;
}

/**
 * Evaluate routing risks (ROUTER-001)
 */
function evaluateRoutingRisks(
  perfAnalysis: PerformanceAnalysis,
  routePages: Array<{
    path: string;
    page: string;
    layout?: string;
    clientIslands: number;
    hasRouteLoading?: boolean;
    hasRouteError?: boolean;
    hasInlineLoading?: boolean;
    hasInlineError?: boolean;
    hasDataFetch?: boolean;
  }>
): RiskRule[] {
  const rules: RiskRule[] = [];

  // Check for page routes with data fetching patterns (heuristics)
  // Exclude API handlers entirely
  // Only consider pages with explicit data fetching, not just presence of client islands
  const pagesWithDataFetching = routePages.filter(
    page => page.path && !page.path.startsWith('/api') && !!page.hasDataFetch
  );
  // Only flag if data fetching is detected AND neither route nor inline boundaries exist
  // Only flag when BOTH loading and error handling are missing
  const pagesMissingBoundaries = pagesWithDataFetching.filter(
    p => !(p.hasRouteLoading || p.hasInlineLoading) && !(p.hasRouteError || p.hasInlineError)
  );
  if (pagesMissingBoundaries.length > 0) {
    const evidence = pagesMissingBoundaries.map(page => page.path);

    rules.push({
      id: 'ROUTER-001',
      why: RISK_RULES['ROUTER-001'].why,
      evidence,
      severity: RISK_RULES['ROUTER-001'].severity,
      weight: RISK_RULES['ROUTER-001'].weight,
      recommendation: RISK_RULES['ROUTER-001'].recommendation,
    });
  }

  return rules;
}

/**
 * Evaluate state management risks (STATE-001)
 */
function evaluateStateRisks(dataFlowAnalysis: {
  endpoints: Array<{ path: string; usedBy: string[] }>;
}): RiskRule[] {
  const rules: RiskRule[] = [];

  // Find endpoints used by multiple components without a data library
  const repeatedEndpoints = dataFlowAnalysis.endpoints.filter(
    endpoint => endpoint.usedBy.length > 2 // Used by more than 2 components
  );

  if (repeatedEndpoints.length > 0) {
    const evidence = repeatedEndpoints.map(
      endpoint => `${endpoint.path} used by ${endpoint.usedBy.length} components`
    );

    rules.push({
      id: 'STATE-001',
      why: RISK_RULES['STATE-001'].why,
      evidence,
      severity: RISK_RULES['STATE-001'].severity,
      weight: RISK_RULES['STATE-001'].weight,
      recommendation: RISK_RULES['STATE-001'].recommendation,
    });
  }

  return rules;
}

/**
 * Generate actionable recommendations based on risk analysis
 */
function generateRecommendations(
  riskRules: RiskRule[],
  perfAnalysis: PerformanceAnalysis,
  accessibilityAnalysis: AccessibilityAnalysis,
  envAnalysis: EnvironmentAnalysis,
  routePages: Array<{ path: string; page: string; layout?: string; clientIslands: number }>,
  routeHandlers: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
    path: string;
    file: string;
    lines?: string;
  }>
): Array<{ title: string; priority: 'high' | 'medium' | 'low'; files?: string[] }> {
  const recommendations: Array<{
    title: string;
    priority: 'high' | 'medium' | 'low';
    files?: string[];
  }> = [];

  // High priority recommendations
  if (envAnalysis.clientLeaks.length > 0) {
    recommendations.push({
      title: '🔐 Fix environment variable leaks in client code',
      priority: 'high',
      files: envAnalysis.clientLeaks.map(leak => leak.file),
    });
  }

  if (perfAnalysis.noDynamicImportCandidates.length > 0) {
    recommendations.push({
      title: '⚡ Implement dynamic imports for heavy components',
      priority: 'high',
      files: perfAnalysis.noDynamicImportCandidates,
    });
  }

  // Medium priority recommendations
  const pagesWithDataFetching = routePages.filter(
    page => page.path && (page.path.includes('api') || page.path.includes('['))
  );
  const handlersWithDataFetching = routeHandlers.filter(
    handler => handler.path && (handler.path.includes('api') || handler.path.includes('['))
  );

  if (pagesWithDataFetching.length > 0 || handlersWithDataFetching.length > 0) {
    recommendations.push({
      title: '🎯 Add loading and error boundaries to data-fetching routes',
      priority: 'medium',
      files: [
        ...pagesWithDataFetching.map(page => page.path),
        ...handlersWithDataFetching.map(handler => handler.path),
      ],
    });
  }

  if (accessibilityAnalysis.missingAltTags.length > 0) {
    recommendations.push({
      title: '♿ Add alt attributes to images for accessibility',
      priority: 'medium',
      files: accessibilityAnalysis.missingAltTags.map(issue => issue.file),
    });
  }

  if (accessibilityAnalysis.missingSecurityAttributes.length > 0) {
    recommendations.push({
      title: '🔒 Add security attributes to external links',
      priority: 'medium',
      files: accessibilityAnalysis.missingSecurityAttributes.map(issue => issue.file),
    });
  }

  // Low priority recommendations
  if (perfAnalysis.heavyClientImports.length > 0) {
    recommendations.push({
      title: '🖼️ Optimize images and assets for better performance',
      priority: 'low',
      files: perfAnalysis.heavyClientImports.map(imp => imp.file),
    });
  }

  if (accessibilityAnalysis.missingAriaLabels.length > 0) {
    recommendations.push({
      title: '🏷️ Add accessible labels to interactive elements',
      priority: 'low',
      files: accessibilityAnalysis.missingAriaLabels.map(issue => issue.file),
    });
  }

  return recommendations;
}

/**
 * Generate top 5 actions to reduce risk score by ~15+ points
 */
function generateScoreReductionActions(
  riskRules: RiskRule[],
  perfAnalysis: PerformanceAnalysis,
  accessibilityAnalysis: AccessibilityAnalysis,
  envAnalysis: EnvironmentAnalysis,
  routePages: Array<{ path: string; page: string; layout?: string; clientIslands: number }>
): Array<{
  action: string;
  estimatedReduction: number;
  category: string;
  priority: 'high' | 'medium' | 'low';
  files?: string[];
}> {
  const actions: Array<{
    action: string;
    estimatedReduction: number;
    category: string;
    priority: 'high' | 'medium' | 'low';
    files?: string[];
  }> = [];

  // Action 1: Fix environment variable leaks (highest impact)
  if (envAnalysis.clientLeaks.length > 0) {
    const appContextLeaks = filterAppContextIssues(envAnalysis.clientLeaks);
    if (appContextLeaks.length > 0) {
      actions.push({
        action: 'Fix environment variable leaks in client code',
        estimatedReduction: 25,
        category: 'Security',
        priority: 'high',
        files: appContextLeaks.map(leak => leak.file),
      });
    }
  }

  // Action 2: Implement dynamic imports for heavy components
  if (perfAnalysis.noDynamicImportCandidates.length > 0) {
    actions.push({
      action: 'Implement dynamic imports for heavy components',
      estimatedReduction: 15,
      category: 'Performance',
      priority: 'high',
      files: perfAnalysis.noDynamicImportCandidates,
    });
  }

  // Action 3: Add security attributes to external links
  const appContextSecurityAttrs = filterAppContextIssues(
    accessibilityAnalysis.missingSecurityAttributes
  );
  if (appContextSecurityAttrs.length > 0) {
    actions.push({
      action: 'Add security attributes to external links',
      estimatedReduction: 20,
      category: 'Security',
      priority: 'high',
      files: appContextSecurityAttrs.map(issue => issue.file),
    });
  }

  // Action 4: Add alt attributes to images
  const appContextAltTags = filterAppContextIssues(accessibilityAnalysis.missingAltTags);
  if (appContextAltTags.length > 0) {
    actions.push({
      action: 'Add alt attributes to all images',
      estimatedReduction: 10,
      category: 'Accessibility',
      priority: 'medium',
      files: appContextAltTags.map(issue => issue.file),
    });
  }

  // Action 5: Consolidate duplicate API calls
  if (riskRules.some(rule => rule.id === 'STATE-001')) {
    actions.push({
      action: 'Consolidate duplicate API calls with SDK',
      estimatedReduction: 3,
      category: 'Developer Experience',
      priority: 'low',
    });
  }

  // Action 6: Add loading/error boundaries (if not already covered)
  const pagesWithDataFetching = routePages.filter(
    page => page.path && (page.path.includes('api') || page.path.includes('['))
  );
  if (pagesWithDataFetching.length > 0) {
    actions.push({
      action: 'Add loading and error boundaries to data routes',
      estimatedReduction: 5,
      category: 'Developer Experience',
      priority: 'medium',
      files: pagesWithDataFetching.map(page => page.path),
    });
  }

  // Sort by estimated reduction (highest first) and take top 5
  return actions.sort((a, b) => b.estimatedReduction - a.estimatedReduction).slice(0, 5);
}

/**
 * Analyze overall risk score and generate recommendations
 */
export function analyzeRisks(
  perfAnalysis: PerformanceAnalysis,
  accessibilityAnalysis: AccessibilityAnalysis,
  envAnalysis: EnvironmentAnalysis,
  routePages: Array<{ path: string; page: string; layout?: string; clientIslands: number }>,
  routeHandlers: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
    path: string;
    file: string;
    lines?: string;
  }>,
  components: ComponentInfo[],
  dataFlowAnalysis: {
    endpoints: Array<{ path: string; usedBy: string[] }>;
  }
): RiskAnalysis {
  logger.info('🎯 Analyzing risk score and generating recommendations');

  // Evaluate all risk categories (these now filter out non-app contexts)
  const envRisks = evaluateEnvironmentRisks(envAnalysis);
  const accessibilityRisks = evaluateAccessibilityRisks(accessibilityAnalysis);
  const performanceRisks = evaluatePerformanceRisks(perfAnalysis);
  const routingRisks = evaluateRoutingRisks(perfAnalysis, routePages);
  const stateRisks = evaluateStateRisks(dataFlowAnalysis);

  // Combine all risk rules
  const allRiskRules = [
    ...envRisks,
    ...accessibilityRisks,
    ...performanceRisks,
    ...routingRisks,
    ...stateRisks,
  ];

  // Calculate total risk score (this is the old score including test files)
  const totalScore = allRiskRules.reduce((sum, rule) => sum + rule.weight, 0);

  // Calculate trusted score (excluding non-app contexts - this is already filtered in the rules)
  const trustedScore = totalScore; // Since we filter at the rule level, this is already trusted

  // Generate recommendations
  const recommendations = generateRecommendations(
    allRiskRules,
    perfAnalysis,
    accessibilityAnalysis,
    envAnalysis,
    routePages,
    routeHandlers
  );

  // Generate score reduction actions
  const scoreReductionActions = generateScoreReductionActions(
    allRiskRules,
    perfAnalysis,
    accessibilityAnalysis,
    envAnalysis,
    routePages
  );

  const analysis: RiskAnalysis = {
    score: Math.min(totalScore, 100), // Cap at 100 (old score for comparison)
    trustedScore: Math.min(trustedScore, 100), // New trusted score
    rules: allRiskRules,
    recommendations,
    scoreReductionActions,
  };

  logger.info(
    `🎯 Risk analysis complete: trusted score ${analysis.trustedScore}, ${allRiskRules.length} rules triggered, ${scoreReductionActions.length} reduction actions`
  );
  return analysis;
}

/**
 * Get risk level description based on score
 */
export function getRiskLevelDescription(score: number): string {
  if (score >= 70) return '🔴 High Risk - Immediate attention required';
  if (score >= 40) return '🟡 Medium Risk - Address major issues soon';
  if (score >= 20) return '🟢 Low Risk - Minor improvements suggested';
  return '✅ Very Low Risk - Code looks good!';
}
