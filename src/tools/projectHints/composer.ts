/**
 * @fileOverview: Project hints composer with evidence cards using shared retrieval
 * @module: ProjectHintsComposer
 * @context: Enhances existing project hints with evidence cards from retrieval system
 */

import { ProjectHints } from '../projectHints';
import { sharedRetriever } from '../../shared/retrieval/retriever';
import { ScoredChunk } from '../../shared/retrieval/types';
import { logComposerTelemetry } from '../../shared/telemetry';
import { logger } from '../../utils/logger';
import { LocalEmbeddingStorage } from '../../local/embeddingStorage';
import { LocalEmbeddingGenerator } from '../../local/embeddingGenerator';
import * as path from 'path';

export interface EvidenceCard {
  path: string;
  lineRange?: string;
  excerpt: string;
  score: number;
  signals: string[];
  facet_tags: string[];
}

export interface ProjectHintsWithEvidence extends ProjectHints {
  evidenceCards: Record<string, EvidenceCard[]>;
  retrievalMetadata: {
    coveragePct: number;
    anchorsHit: string[];
    perFacetCounts: Record<string, number>;
    processingTimeMs: number;
  };
}

export class ProjectHintsComposer {
  private useEmbeddingAssisted: boolean;

  constructor() {
    // Check for embedding-assisted mode with smart defaults
    this.useEmbeddingAssisted = this.shouldUseEmbeddingAssistedHints();
  }

  /**
   * Check if embedding-assisted hints should be used by default
   * Returns true if USE_LOCAL_EMBEDDINGS is enabled and embeddings are available
   * Can be overridden by explicit EMBEDDING_ASSISTED_HINTS setting
   */
  private shouldUseEmbeddingAssistedHints(): boolean {
    // Check explicit override first
    const explicitSetting = process.env.EMBEDDING_ASSISTED_HINTS;
    if (explicitSetting !== undefined) {
      return explicitSetting === '1' || explicitSetting === 'true';
    }

    // Default to true if local embeddings are enabled and embeddings are available
    const useLocalEmbeddings = process.env.USE_LOCAL_EMBEDDINGS === 'true';
    const embeddingsAvailable =
      LocalEmbeddingStorage.isEnabled() && LocalEmbeddingGenerator.isAvailable();

    return useLocalEmbeddings && embeddingsAvailable;
  }

  /**
   * Enhance project hints with evidence cards
   */
  async enhanceWithEvidence(
    hints: ProjectHints,
    query?: string
  ): Promise<ProjectHintsWithEvidence> {
    const startTime = Date.now();

    try {
      if (!this.useEmbeddingAssisted) {
        logger.info('📋 Using traditional project hints (embedding-assisted mode disabled)');
        return {
          ...hints,
          evidenceCards: {},
          retrievalMetadata: {
            coveragePct: 0,
            anchorsHit: [],
            perFacetCounts: {},
            processingTimeMs: Date.now() - startTime,
          },
        };
      }

      // Generate a comprehensive query for evidence retrieval
      const evidenceQuery = query || this.generateEvidenceQuery(hints);

      logger.info('🔍 Retrieving evidence for project hints', {
        query: evidenceQuery.substring(0, 100) + '...',
        totalFiles: hints.totalFiles,
        architectureKeywords: hints.architectureKeywords.slice(0, 3),
      });

      // Use shared retriever to get relevant chunks
      const relevantChunks = await sharedRetriever.retrieve(evidenceQuery, 'overview');

      // Generate evidence cards organized by section
      const evidenceCards = this.generateEvidenceCards(hints, relevantChunks);

      // Calculate coverage and metadata
      const coveragePct = this.calculateCoverage(hints, relevantChunks);
      const anchorsHit = this.extractAnchorsHit(relevantChunks);
      const perFacetCounts = this.countPerFacet(relevantChunks);

      const processingTimeMs = Date.now() - startTime;

      // Calculate section counts for telemetry
      const sectionCounts: Record<string, number> = {};
      Object.keys(evidenceCards).forEach(section => {
        sectionCounts[section] = evidenceCards[section].length;
      });

      // Log composer telemetry
      logComposerTelemetry(
        'project_hints',
        `hints_${Date.now()}`,
        coveragePct,
        Math.max(0.5, coveragePct), // Use coverage as confidence proxy
        sectionCounts,
        processingTimeMs,
        Object.values(evidenceCards).reduce((sum, cards) => sum + cards.length, 0)
      );

      logger.info('✅ Project hints enhanced with evidence', {
        evidenceCards: Object.keys(evidenceCards).length,
        totalEvidenceCards: Object.values(evidenceCards).reduce(
          (sum, cards) => sum + cards.length,
          0
        ),
        coveragePct: Math.round(coveragePct * 100) + '%',
        anchorsHit: anchorsHit.length,
        processingTimeMs,
      });

      return {
        ...hints,
        evidenceCards,
        retrievalMetadata: {
          coveragePct,
          anchorsHit,
          perFacetCounts,
          processingTimeMs,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Log failed composer telemetry
      logComposerTelemetry(
        'project_hints',
        `hints_${Date.now()}`,
        0,
        0,
        {},
        Date.now() - startTime,
        0,
        errorMsg
      );

      logger.warn('⚠️ Failed to enhance project hints with evidence', {
        error: errorMsg,
      });

      // Return original hints on failure
      return {
        ...hints,
        evidenceCards: {},
        retrievalMetadata: {
          coveragePct: 0,
          anchorsHit: [],
          perFacetCounts: {},
          processingTimeMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Generate a comprehensive query for evidence retrieval
   */
  private generateEvidenceQuery(hints: ProjectHints): string {
    const components = [];

    // Add architecture keywords
    if (hints.architectureKeywords.length > 0) {
      components.push(`architecture: ${hints.architectureKeywords.slice(0, 5).join(', ')}`);
    }

    // Add domain keywords
    if (hints.domainKeywords.length > 0) {
      components.push(`domain: ${hints.domainKeywords.slice(0, 5).join(', ')}`);
    }

    // Add primary languages
    if (hints.primaryLanguages.length > 0) {
      components.push(`languages: ${hints.primaryLanguages.join(', ')}`);
    }

    // Add key folder purposes
    const folderPurposes = Object.values(hints.folderHints)
      .map(hint => hint.purpose)
      .slice(0, 3);
    if (folderPurposes.length > 0) {
      components.push(`structure: ${folderPurposes.join(', ')}`);
    }

    // Combine into a comprehensive query
    const query =
      components.length > 0
        ? `Project overview with ${components.join(', ')}`
        : 'General project structure and architecture';

    return query;
  }

  /**
   * Generate evidence cards organized by sections
   */
  private generateEvidenceCards(
    hints: ProjectHints,
    chunks: ScoredChunk[]
  ): Record<string, EvidenceCard[]> {
    const evidenceCards: Record<string, EvidenceCard[]> = {};

    // Initialize sections
    const sections = [
      'architecture',
      'languages',
      'folders',
      'entry_points',
      'config_files',
      'documentation',
      'functions',
      'classes',
      'imports',
    ];

    sections.forEach(section => {
      evidenceCards[section] = [];
    });

    // Process each chunk and assign to appropriate sections
    chunks.forEach(chunk => {
      const card = this.createEvidenceCard(chunk);

      // Assign to architecture section
      if (
        chunk.meta.facet_tags.includes('routing') ||
        chunk.meta.facet_tags.includes('data') ||
        chunk.meta.facet_tags.includes('auth')
      ) {
        evidenceCards.architecture.push(card);
      }

      // Assign to languages section
      if (chunk.meta.language) {
        evidenceCards.languages.push(card);
      }

      // Assign to folders section
      if (hints.folderHints[chunk.meta.path] || hints.folderHints[path.dirname(chunk.meta.path)]) {
        evidenceCards.folders.push(card);
      }

      // Assign to entry points section
      const isEntryPoint = hints.entryPoints.some(
        ep => chunk.meta.path.includes(ep) || ep.includes(path.basename(chunk.meta.path))
      );
      if (isEntryPoint) {
        evidenceCards.entry_points.push(card);
      }

      // Assign to config files section
      const isConfig = hints.configFiles.some(
        cf => chunk.meta.path.includes(cf) || cf.includes(path.basename(chunk.meta.path))
      );
      if (isConfig) {
        evidenceCards.config_files.push(card);
      }

      // Assign to documentation section
      const isDoc = hints.documentationFiles.some(
        df => chunk.meta.path.includes(df) || df.includes(path.basename(chunk.meta.path))
      );
      if (isDoc) {
        evidenceCards.documentation.push(card);
      }

      // Assign to symbol sections
      if (chunk.meta.symbol_kind === 'func') {
        evidenceCards.functions.push(card);
      } else if (chunk.meta.symbol_kind === 'class') {
        evidenceCards.classes.push(card);
      }

      // Assign to imports section if it has imports
      if (chunk.meta.imports && chunk.meta.imports.length > 0) {
        evidenceCards.imports.push(card);
      }
    });

    // Limit cards per section and sort by score
    Object.keys(evidenceCards).forEach(section => {
      evidenceCards[section] = evidenceCards[section].sort((a, b) => b.score - a.score).slice(0, 8); // Max 8 cards per section
    });

    return evidenceCards;
  }

  /**
   * Create an evidence card from a scored chunk
   */
  private createEvidenceCard(chunk: ScoredChunk): EvidenceCard {
    // Extract a short excerpt (first 180 characters or first line)
    const excerpt = this.extractExcerpt(chunk.text);

    // Build line range if available
    let lineRange: string | undefined;
    if (chunk.meta.startLine && chunk.meta.endLine) {
      lineRange =
        chunk.meta.startLine === chunk.meta.endLine
          ? `${chunk.meta.startLine}`
          : `${chunk.meta.startLine}-${chunk.meta.endLine}`;
    }

    return {
      path: chunk.meta.path,
      lineRange,
      excerpt,
      score: chunk.score,
      signals: chunk.meta.signals || [],
      facet_tags: chunk.meta.facet_tags,
    };
  }

  /**
   * Extract a meaningful excerpt from chunk text
   */
  private extractExcerpt(text: string): string {
    // Take first line or first 180 characters
    const firstLine = text.split('\n')[0].trim();
    if (firstLine.length <= 180) {
      return firstLine;
    }

    // If first line is too long, take first 180 characters and add ellipsis
    return text.substring(0, 180) + '...';
  }

  /**
   * Calculate coverage percentage
   */
  private calculateCoverage(hints: ProjectHints, chunks: ScoredChunk[]): number {
    if (chunks.length === 0) return 0;

    // Count unique files covered by chunks
    const uniqueFiles = new Set(chunks.map(c => c.meta.path));
    const totalFiles = hints.totalFiles;

    return Math.min(1.0, uniqueFiles.size / Math.max(totalFiles, 1));
  }

  /**
   * Extract anchors that were hit
   */
  private extractAnchorsHit(chunks: ScoredChunk[]): string[] {
    const anchorsHit = new Set<string>();

    chunks.forEach(chunk => {
      if (chunk.meta.signals) {
        chunk.meta.signals.forEach(signal => {
          // Check if this signal is a known anchor
          // This would be expanded based on the facet config
          if (
            signal.includes('verifyAuth') ||
            signal.includes('RLS') ||
            signal.includes('Authorization')
          ) {
            anchorsHit.add(signal);
          }
        });
      }
    });

    return Array.from(anchorsHit);
  }

  /**
   * Count chunks per facet
   */
  private countPerFacet(chunks: ScoredChunk[]): Record<string, number> {
    const counts: Record<string, number> = {};

    chunks.forEach(chunk => {
      chunk.meta.facet_tags.forEach(facet => {
        counts[facet] = (counts[facet] || 0) + 1;
      });
    });

    return counts;
  }
}

// Export singleton instance
export const projectHintsComposer = new ProjectHintsComposer();

// Helper function to format evidence cards for display
export function formatEvidenceCards(evidenceCards: Record<string, EvidenceCard[]>): string {
  const sections: string[] = [];

  for (const [section, cards] of Object.entries(evidenceCards)) {
    if (cards.length === 0) continue;

    sections.push(`### ${section.replace('_', ' ').toUpperCase()}\n`);

    cards.forEach(card => {
      const location = card.lineRange ? `${card.path}:${card.lineRange}` : card.path;

      sections.push(`• **${location}** — ${card.excerpt}`);
      sections.push(`  Score: ${card.score.toFixed(3)}, Facets: [${card.facet_tags.join(', ')}]`);
      if (card.signals.length > 0) {
        sections.push(`  Signals: [${card.signals.join(', ')}]`);
      }
      sections.push('');
    });
  }

  return sections.join('\n');
}
