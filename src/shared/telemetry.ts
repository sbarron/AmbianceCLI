/**
 * @fileOverview: Telemetry system for embedding-assisted tools
 * @module: Telemetry
 * @context: Logs query performance, coverage metrics, and retrieval statistics
 */

import { logger } from '../utils/logger';

export interface QueryTelemetry {
  queryId: string;
  query: string;
  taskType: 'understand' | 'overview' | 'troubleshoot';
  facets: string[];
  anchorsHit: string[];
  chunkCount: number;
  perFacetCounts: Record<string, number>;
  coveragePct: number;
  processingTimeMs: number;
  timings: {
    embedMs: number;
    searchMs: number;
    expandMs: number;
    rankMs: number;
  };
  error?: string;
}

export interface ComposerTelemetry {
  composerType: 'project_hints' | 'system_map' | 'local_context';
  queryId: string;
  coveragePct: number;
  confidence: number;
  sectionCounts: Record<string, number>;
  evidenceCardsGenerated?: number;
  processingTimeMs: number;
  error?: string;
}

export interface PerformanceBudget {
  maxRetrievalTimeMs: number;
  maxComposerTimeMs: number;
  minCoveragePct: number;
  maxAnchorsMissed: number;
}

export class TelemetryCollector {
  private static instance: TelemetryCollector;
  private queryCounter = 0;

  private constructor() {}

  static getInstance(): TelemetryCollector {
    if (!TelemetryCollector.instance) {
      TelemetryCollector.instance = new TelemetryCollector();
    }
    return TelemetryCollector.instance;
  }

  /**
   * Generate unique query ID
   */
  private generateQueryId(): string {
    return `q_${Date.now()}_${++this.queryCounter}`;
  }

  /**
   * Log retrieval telemetry
   */
  logRetrieval(queryTelemetry: Omit<QueryTelemetry, 'queryId'>): void {
    const telemetry: QueryTelemetry = {
      ...queryTelemetry,
      queryId: this.generateQueryId(),
    };

    logger.info('📊 Retrieval Telemetry', {
      queryId: telemetry.queryId,
      query: telemetry.query.substring(0, 50) + (telemetry.query.length > 50 ? '...' : ''),
      taskType: telemetry.taskType,
      facets: telemetry.facets.join(','),
      anchorsHit: telemetry.anchorsHit.length,
      chunkCount: telemetry.chunkCount,
      coveragePct: Math.round(telemetry.coveragePct * 100),
      processingTimeMs: telemetry.processingTimeMs,
      timings: telemetry.timings,
      perFacetCounts: telemetry.perFacetCounts,
      error: telemetry.error,
    });

    // Check performance budget
    this.checkPerformanceBudget(telemetry);

    // Store for potential later analysis
    this.storeTelemetry(telemetry);
  }

  /**
   * Log composer telemetry
   */
  logComposer(composerTelemetry: ComposerTelemetry): void {
    logger.info('🎨 Composer Telemetry', {
      composerType: composerTelemetry.composerType,
      queryId: composerTelemetry.queryId,
      coveragePct: Math.round(composerTelemetry.coveragePct * 100),
      confidence: Math.round(composerTelemetry.confidence * 100),
      sectionCounts: composerTelemetry.sectionCounts,
      evidenceCardsGenerated: composerTelemetry.evidenceCardsGenerated,
      processingTimeMs: composerTelemetry.processingTimeMs,
      error: composerTelemetry.error,
    });

    // Check composer performance
    this.checkComposerBudget(composerTelemetry);
  }

  /**
   * Check if retrieval meets performance budget
   */
  private checkPerformanceBudget(telemetry: QueryTelemetry): void {
    const budget: PerformanceBudget = {
      maxRetrievalTimeMs: 500, // 500ms budget
      maxComposerTimeMs: 200,
      minCoveragePct: 0.1, // 10% minimum coverage
      maxAnchorsMissed: 5,
    };

    const issues: string[] = [];

    if (telemetry.processingTimeMs > budget.maxRetrievalTimeMs) {
      issues.push(
        `Retrieval time ${telemetry.processingTimeMs}ms exceeds budget ${budget.maxRetrievalTimeMs}ms`
      );
    }

    if (telemetry.coveragePct < budget.minCoveragePct) {
      issues.push(
        `Coverage ${Math.round(telemetry.coveragePct * 100)}% below minimum ${Math.round(budget.minCoveragePct * 100)}%`
      );
    }

    // Check for anchor misses (anchors that should have been hit but weren't)
    const expectedAnchors = this.getExpectedAnchorsForFacets(telemetry.facets);
    const missedAnchors = expectedAnchors.filter(anchor => !telemetry.anchorsHit.includes(anchor));

    if (missedAnchors.length > budget.maxAnchorsMissed) {
      issues.push(
        `${missedAnchors.length} expected anchors missed: ${missedAnchors.slice(0, 3).join(', ')}`
      );
    }

    if (issues.length > 0) {
      logger.warn('⚠️ Performance budget violations', {
        queryId: telemetry.queryId,
        issues,
        telemetry: {
          time: telemetry.processingTimeMs,
          coverage: telemetry.coveragePct,
          anchorsHit: telemetry.anchorsHit.length,
          expectedAnchors: expectedAnchors.length,
        },
      });
    }
  }

  /**
   * Check if composer meets performance budget
   */
  private checkComposerBudget(telemetry: ComposerTelemetry): void {
    const budget: PerformanceBudget = {
      maxRetrievalTimeMs: 500,
      maxComposerTimeMs: 200,
      minCoveragePct: 0.1,
      maxAnchorsMissed: 5,
    };

    if (telemetry.processingTimeMs > budget.maxComposerTimeMs) {
      logger.warn('⚠️ Composer performance budget exceeded', {
        composerType: telemetry.composerType,
        queryId: telemetry.queryId,
        time: telemetry.processingTimeMs,
        budget: budget.maxComposerTimeMs,
      });
    }

    if (telemetry.confidence < 0.5) {
      logger.info('📊 Low confidence composer result', {
        composerType: telemetry.composerType,
        queryId: telemetry.queryId,
        confidence: telemetry.confidence,
      });
    }
  }

  /**
   * Get expected anchors for given facets
   */
  private getExpectedAnchorsForFacets(facets: string[]): string[] {
    const facetAnchors: Record<string, string[]> = {
      auth: ['verifyAuth', 'verifyToken', 'authenticate', 'authorize'],
      routing: ['middleware', 'handler', 'route'],
      data: ['auth.uid', 'RLS', 'policy'],
      build_runtime: ['process.env', 'config'],
      security: ['rateLimit', 'helmet', 'CSP'],
    };

    const expectedAnchors: string[] = [];
    facets.forEach(facet => {
      if (facetAnchors[facet]) {
        expectedAnchors.push(...facetAnchors[facet]);
      }
    });

    return expectedAnchors;
  }

  /**
   * Store telemetry for potential later analysis
   */
  private storeTelemetry(telemetry: QueryTelemetry): void {
    // In a production system, this could write to a database or send to monitoring service
    // For now, we'll just keep it in memory with a simple cache
    // This is a placeholder for future enhancement
    // Could be extended to write to a telemetry database or send to monitoring service
  }

  /**
   * Get telemetry statistics
   */
  getStats(): {
    totalQueries: number;
    averageRetrievalTime: number;
    averageCoverage: number;
    facetUsage: Record<string, number>;
  } {
    // Placeholder - would need to implement actual storage to track this
    return {
      totalQueries: this.queryCounter,
      averageRetrievalTime: 0,
      averageCoverage: 0,
      facetUsage: {},
    };
  }
}

// Export singleton instance
export const telemetry = TelemetryCollector.getInstance();

// Helper functions for easy telemetry logging
export function logRetrievalTelemetry(
  query: string,
  taskType: 'understand' | 'overview' | 'troubleshoot',
  facets: string[],
  anchorsHit: string[],
  chunkCount: number,
  perFacetCounts: Record<string, number>,
  coveragePct: number,
  processingTimeMs: number,
  timings: QueryTelemetry['timings'],
  error?: string
): void {
  telemetry.logRetrieval({
    query,
    taskType,
    facets,
    anchorsHit,
    chunkCount,
    perFacetCounts,
    coveragePct,
    processingTimeMs,
    timings,
    error,
  });
}

export function logComposerTelemetry(
  composerType: 'project_hints' | 'system_map' | 'local_context',
  queryId: string,
  coveragePct: number,
  confidence: number,
  sectionCounts: Record<string, number>,
  processingTimeMs: number,
  evidenceCardsGenerated?: number,
  error?: string
): void {
  telemetry.logComposer({
    composerType,
    queryId,
    coveragePct,
    confidence,
    sectionCounts,
    processingTimeMs,
    evidenceCardsGenerated,
    error,
  });
}
