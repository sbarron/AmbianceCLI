/**
 * @fileOverview: Shared retrieval system implementation with facet-aware retrieval and MMR re-rank
 * @module: SharedRetriever
 * @context: Implements the 7-step retrieval algorithm with anchors, per-facet quotas, and diversity
 */

import { LocalEmbeddingStorage, EmbeddingChunk } from '../../local/embeddingStorage';
import { LocalEmbeddingGenerator } from '../../local/embeddingGenerator';
import { logger } from '../../utils/logger';
import {
  IndexedChunk,
  ScoredChunk,
  Retriever,
  SearchOpts,
  QueryAnalysis,
  RetrievalResult,
  FacetConfig,
} from './types';
import { logRetrievalTelemetry } from '../telemetry';
import * as fs from 'fs';
import * as path from 'path';
import { isQuantized, dequantizeInt8ToFloat32, QuantizedEmbedding } from '../../local/quantization';

export class SharedRetriever implements Retriever {
  private storage: LocalEmbeddingStorage;
  private embeddingGenerator: LocalEmbeddingGenerator;
  private facetConfig: FacetConfig;
  private indexedChunks: Map<string, IndexedChunk[]> = new Map();

  constructor(storage?: LocalEmbeddingStorage, embeddingGenerator?: LocalEmbeddingGenerator) {
    this.storage = storage || new LocalEmbeddingStorage();
    this.embeddingGenerator = embeddingGenerator || new LocalEmbeddingGenerator();
    this.facetConfig = this.loadFacetConfig();
  }

  /**
   * Load facet configuration from JSON file
   */
  private loadFacetConfig(): FacetConfig {
    try {
      // Try to load from source directory first (for development)
      let configPath = path.join(__dirname, '../../../src/shared/retrieval/facets.config.json');

      // If that doesn't exist, try from dist directory (for production)
      if (!fs.existsSync(configPath)) {
        configPath = path.join(__dirname, 'facets.config.json');
      }

      const configContent = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configContent);
    } catch (error) {
      logger.error('❌ Failed to load facet configuration', {
        error: error instanceof Error ? error.message : String(error),
        triedPaths: [
          path.join(__dirname, '../../../src/shared/retrieval/facets.config.json'),
          path.join(__dirname, 'facets.config.json'),
        ],
      });

      // Return minimal fallback config with basic facets for essential functionality
      logger.warn('⚠️ Using fallback facet configuration - some features may be limited');
      return {
        facets: {
          // Essential fallback facets to maintain basic functionality
          general: {
            seeds: ['function', 'class', 'const', 'let', 'var', 'import', 'export'],
            description: 'General code patterns and structures',
          },
          data: {
            seeds: ['database', 'table', 'query', 'model', 'schema'],
            description: 'Data operations and database interactions',
          },
          auth: {
            seeds: ['auth', 'login', 'token', 'session', 'user'],
            description: 'Authentication and user management',
          },
        },
        retrieval: {
          perFacetCap: { general: 8, data: 4, auth: 3 },
          mmrLambda: 0.3,
          minSim: 0.18,
          penalties: {
            'node_modules/': 0.1,
            'dist/': 0.2,
            'build/': 0.2,
            '*.min.js': 0.3,
            '*.map': 0.3,
          },
          maxRetries: 3,
          timeoutMs: 5000,
        },
        anchors: {
          general: ['function', 'class', 'const'],
          data: ['database', 'query'],
          auth: ['auth', 'login'],
        },
      };
    }
  }

  /**
   * Main retrieval method implementing the 7-step algorithm
   */
  async retrieve(
    query: string,
    task: 'understand' | 'overview' | 'troubleshoot' = 'understand'
  ): Promise<ScoredChunk[]> {
    const startTime = Date.now();

    try {
      // Step 1: Facet detection
      const queryAnalysis = this.detectFacets(query);
      logger.info('🎯 Facet detection complete', {
        query: query.substring(0, 100),
        facets: queryAnalysis.facets,
        confidence: queryAnalysis.confidence,
      });

      // Step 2: Embed query
      const embedStart = Date.now();
      const queryEmbedding = await this.embeddingGenerator.generateQueryEmbedding(query);
      const embedTime = Date.now() - embedStart;
      logger.info('🔢 Query embedding generated', {
        dimensions: queryEmbedding.length,
        timeMs: embedTime,
      });

      // Step 3: Vector search
      const searchStart = Date.now();
      const allChunks = await this.getAllIndexedChunks();
      const searchOpts: SearchOpts = {
        topK: 60,
        minSim: this.facetConfig.retrieval.minSim,
        facets: queryAnalysis.facets,
        perFacetCap: this.facetConfig.retrieval.perFacetCap,
        mmrLambda: this.facetConfig.retrieval.mmrLambda,
      };

      const coarseResults = await this.vectorSearch(queryEmbedding, allChunks, searchOpts);
      const searchTime = Date.now() - searchStart;
      logger.info('🔍 Vector search complete', {
        totalChunks: allChunks.length,
        coarseResults: coarseResults.length,
        timeMs: searchTime,
      });

      // Step 4: Anchor enforcement
      const expandStart = Date.now();
      const anchorResults = await this.enforceAnchors(coarseResults, queryAnalysis.facets);
      const expandTime = Date.now() - expandStart;
      logger.info('⚓ Anchor enforcement complete', {
        anchorsHit: anchorResults.anchorsHit,
        expandedResults: anchorResults.chunks.length,
        timeMs: expandTime,
      });

      // Step 5: One-hop expansion (via import/export graph)
      const expandedResults = await this.oneHopExpansion(anchorResults.chunks);

      // Step 6: MMR re-rank with per-facet quotas
      const rankStart = Date.now();
      const finalResults = this.mmrRerank(
        expandedResults,
        queryEmbedding,
        queryAnalysis.facets,
        this.facetConfig.retrieval.perFacetCap,
        this.facetConfig.retrieval.mmrLambda
      );
      const rankTime = Date.now() - rankStart;

      // Step 7: Final k = 12–15 for composers
      const finalChunks = finalResults.slice(0, 15);
      const totalTime = Date.now() - startTime;

      // Calculate coverage percentage
      const coveragePct = this.calculateCoverage(finalChunks);

      // Calculate per-facet counts for telemetry
      const perFacetCounts: Record<string, number> = {};
      queryAnalysis.facets.forEach(facet => {
        perFacetCounts[facet] = finalChunks.filter(chunk =>
          chunk.meta.facet_tags.includes(facet)
        ).length;
      });

      // Log telemetry
      logRetrievalTelemetry(
        query,
        task,
        queryAnalysis.facets,
        anchorResults.anchorsHit,
        finalChunks.length,
        perFacetCounts,
        coveragePct,
        totalTime,
        {
          embedMs: embedTime,
          searchMs: searchTime,
          expandMs: expandTime,
          rankMs: rankTime,
        }
      );

      logger.info('✅ Retrieval complete', {
        query: query.substring(0, 50) + '...',
        finalCount: finalChunks.length,
        facets: queryAnalysis.facets,
        anchorsHit: anchorResults.anchorsHit,
        totalTimeMs: totalTime,
        timings: {
          embedMs: embedTime,
          searchMs: searchTime,
          expandMs: expandTime,
          rankMs: rankTime,
        },
      });

      return finalChunks;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Log failed retrieval telemetry
      logRetrievalTelemetry(
        query,
        task,
        [],
        [],
        0,
        {},
        0,
        Date.now() - startTime,
        { embedMs: 0, searchMs: 0, expandMs: 0, rankMs: 0 },
        errorMsg
      );

      logger.error('❌ Retrieval failed', {
        error: errorMsg,
        query: query.substring(0, 100),
        task,
      });
      return [];
    }
  }

  /**
   * Step 1: Detect facets from query using bag-of-words matching
   */
  private detectFacets(query: string): QueryAnalysis {
    const queryLower = query.toLowerCase();
    const detectedFacets: string[] = [];
    const detectedKeywords: string[] = [];
    let totalMatches = 0;

    // Check each facet's seeds against the query
    for (const [facetName, facet] of Object.entries(this.facetConfig.facets)) {
      let facetMatches = 0;

      for (const seed of facet.seeds) {
        const seedLower = seed.toLowerCase();
        if (queryLower.includes(seedLower)) {
          facetMatches++;
          detectedKeywords.push(seed);
        }
      }

      if (facetMatches > 0) {
        detectedFacets.push(facetName);
        totalMatches += facetMatches;
      }
    }

    // Auto-detect task type based on query
    const taskType = this.detectTaskType(query);

    // Calculate confidence based on matches and facet diversity
    const confidence = Math.min(1.0, detectedFacets.length * 0.3 + totalMatches * 0.1);

    return {
      facets: detectedFacets,
      confidence,
      detectedKeywords,
      taskType,
    };
  }

  /**
   * Detect task type from query keywords
   */
  private detectTaskType(query: string): 'understand' | 'overview' | 'troubleshoot' {
    const queryLower = query.toLowerCase();

    if (
      queryLower.includes('error') ||
      queryLower.includes('bug') ||
      queryLower.includes('fix') ||
      queryLower.includes('issue') ||
      queryLower.includes('problem') ||
      queryLower.includes('broken')
    ) {
      return 'troubleshoot';
    }

    if (
      queryLower.includes('overview') ||
      queryLower.includes('structure') ||
      queryLower.includes('architecture') ||
      queryLower.includes('summary')
    ) {
      return 'overview';
    }

    return 'understand';
  }

  /**
   * Step 3: Vector search with coarse retrieval
   */
  private async vectorSearch(
    queryEmbedding: number[],
    chunks: IndexedChunk[],
    opts: SearchOpts
  ): Promise<ScoredChunk[]> {
    const results: ScoredChunk[] = [];

    for (const chunk of chunks) {
      const similarity = this.cosineSimilarity(queryEmbedding, chunk.embedding);

      // Apply penalties based on path
      let adjustedSimilarity = similarity;
      for (const [pattern, penalty] of Object.entries(this.facetConfig.retrieval.penalties)) {
        if (chunk.meta.path.includes(pattern)) {
          adjustedSimilarity *= penalty;
        }
      }

      results.push({
        ...chunk,
        score: adjustedSimilarity,
      });
    }

    // Sort by similarity and apply minimum threshold
    results.sort((a, b) => b.score - a.score);

    // Filter by minimum similarity and limit to topK
    return results.filter(chunk => chunk.score >= (opts.minSim || 0.18)).slice(0, opts.topK);
  }

  /**
   * Step 4: Enforce anchors by forcing inclusion of definitions
   */
  private async enforceAnchors(
    chunks: ScoredChunk[],
    facets: string[]
  ): Promise<{ chunks: ScoredChunk[]; anchorsHit: string[] }> {
    const enrichedChunks = [...chunks];
    const anchorsHit: string[] = [];

    // Get all relevant anchors for detected facets
    const relevantAnchors = new Set<string>();
    for (const facet of facets) {
      const facetAnchors = this.facetConfig.anchors[facet] || [];
      facetAnchors.forEach(anchor => relevantAnchors.add(anchor));
    }

    // Check if any anchors appear in imports/exports of existing chunks
    const anchorPromises: Promise<void>[] = [];

    for (const anchor of relevantAnchors) {
      const anchorPromise = (async () => {
        for (const chunk of chunks) {
          const allSymbols = [
            ...(chunk.meta.imports || []),
            ...(chunk.meta.exports || []),
            ...(chunk.meta.signals || []),
          ];

          if (allSymbols.some(symbol => symbol.includes(anchor))) {
            // Found an anchor - try to find its definition chunk
            const definitionChunk = await this.findDefinitionChunk(anchor, chunk.meta.path);
            if (definitionChunk && !enrichedChunks.some(c => c.id === definitionChunk.id)) {
              enrichedChunks.push({
                ...definitionChunk,
                score: Math.max(definitionChunk.score || 0.5, 0.5), // Ensure reasonable score for anchors
              });
              anchorsHit.push(anchor);
            }
            break; // Only need one match per anchor
          }
        }
      })();

      anchorPromises.push(anchorPromise);
    }

    await Promise.all(anchorPromises);

    return { chunks: enrichedChunks, anchorsHit };
  }

  /**
   * Find definition chunk for a given symbol
   */
  private async findDefinitionChunk(
    symbol: string,
    contextPath: string
  ): Promise<ScoredChunk | null> {
    try {
      const allChunks = await this.getAllIndexedChunks();

      // Look for chunks that define the symbol
      for (const chunk of allChunks) {
        const chunkText = chunk.text.toLowerCase();

        // Check for function/class definitions
        if (
          chunkText.includes(`function ${symbol}`) ||
          chunkText.includes(`def ${symbol}`) ||
          chunkText.includes(`class ${symbol}`) ||
          chunkText.includes(`const ${symbol}`) ||
          chunkText.includes(`export.*${symbol}`)
        ) {
          // Prefer chunks from the same directory or related files
          const contextDir = path.dirname(contextPath);
          const chunkDir = path.dirname(chunk.meta.path);

          const score =
            contextDir === chunkDir
              ? 0.9
              : contextDir.includes(chunkDir) || chunkDir.includes(contextDir)
                ? 0.7
                : 0.5;

          return {
            ...chunk,
            score,
          };
        }
      }
    } catch (error) {
      logger.warn('⚠️ Failed to find definition chunk', {
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  }

  /**
   * Step 5: One-hop expansion via import/export graph
   */
  private async oneHopExpansion(chunks: ScoredChunk[]): Promise<ScoredChunk[]> {
    const expandedChunks = new Map<string, ScoredChunk>();
    const visitedSymbols = new Set<string>();

    // Add original chunks
    chunks.forEach(chunk => expandedChunks.set(chunk.id, chunk));

    for (const chunk of chunks) {
      // Get imports and exports from this chunk
      const relatedSymbols = [...(chunk.meta.imports || []), ...(chunk.meta.exports || [])];

      for (const symbol of relatedSymbols) {
        if (visitedSymbols.has(symbol)) continue;
        visitedSymbols.add(symbol);

        try {
          // Find chunks that define this symbol
          const definitionChunk = await this.findDefinitionChunk(symbol, chunk.meta.path);
          if (definitionChunk && !expandedChunks.has(definitionChunk.id)) {
            // Reduce score for expanded chunks to prioritize direct matches
            expandedChunks.set(definitionChunk.id, {
              ...definitionChunk,
              score: definitionChunk.score * 0.8,
            });
          }
        } catch (error) {
          // Continue with other symbols
        }
      }
    }

    return Array.from(expandedChunks.values());
  }

  /**
   * Step 6: MMR re-rank with per-facet quotas
   */
  private mmrRerank(
    chunks: ScoredChunk[],
    queryEmbedding: number[],
    facets: string[],
    perFacetCap: Record<string, number>,
    lambda: number = 0.3
  ): ScoredChunk[] {
    const selectedChunks: ScoredChunk[] = [];
    const facetCounts: Record<string, number> = {};

    // Initialize facet counts
    facets.forEach(facet => {
      facetCounts[facet] = 0;
    });

    while (selectedChunks.length < 15 && chunks.length > 0) {
      let bestChunk: ScoredChunk | null = null;
      let bestScore = -1;

      for (const chunk of chunks) {
        // Skip if we've hit the facet cap
        const chunkFacets = chunk.meta.facet_tags || [];
        const wouldExceedCap = chunkFacets.some(
          facet => facetCounts[facet] >= (perFacetCap[facet] || 3)
        );

        if (wouldExceedCap) continue;

        // Calculate MMR score: balance relevance vs diversity
        const relevance = chunk.score;
        const diversity =
          selectedChunks.length === 0
            ? 1
            : Math.max(
                ...selectedChunks.map(
                  selected => 1 - this.cosineSimilarity(chunk.embedding, selected.embedding)
                )
              );

        const mmrScore = lambda * relevance + (1 - lambda) * diversity;

        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestChunk = chunk;
        }
      }

      if (!bestChunk) break;

      selectedChunks.push(bestChunk);
      chunks = chunks.filter(c => c.id !== bestChunk!.id);

      // Update facet counts
      const chunkFacets = bestChunk.meta.facet_tags || [];
      chunkFacets.forEach(facet => {
        if (facetCounts[facet] !== undefined) {
          facetCounts[facet]++;
        }
      });
    }

    return selectedChunks;
  }

  /**
   * Get all indexed chunks from storage
   */
  private async getAllIndexedChunks(): Promise<IndexedChunk[]> {
    try {
      // Convert project ID to a hash for the cache key
      const projectId = this.getCurrentProjectId();
      const cacheKey = `chunks_${projectId}`;

      if (this.indexedChunks.has(cacheKey)) {
        return this.indexedChunks.get(cacheKey)!;
      }

      await this.storage.initializeDatabase();
      const embeddingChunks = await this.storage.getProjectEmbeddings(projectId);

      const indexedChunks: IndexedChunk[] = embeddingChunks.map(chunk => ({
        id: chunk.id,
        text: chunk.content,
        embedding: chunk.embedding,
        meta: {
          path: chunk.filePath,
          facet_tags: [], // Will be populated by facet detection
          signals: chunk.metadata.symbols,
          symbol_kind: this.inferSymbolKind(chunk.metadata.type),
          imports: [], // Could be extracted from content
          exports: [], // Could be extracted from content
          path_tokens: chunk.filePath.split(/[/\\]/),
          language: chunk.metadata.language,
          startLine: chunk.metadata.startLine,
          endLine: chunk.metadata.endLine,
        },
      }));

      // Populate facet tags based on content analysis
      indexedChunks.forEach(chunk => {
        chunk.meta.facet_tags = this.detectChunkFacets(chunk);
      });

      this.indexedChunks.set(cacheKey, indexedChunks);
      return indexedChunks;
    } catch (error) {
      logger.error('❌ Failed to get indexed chunks', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Detect facets for a chunk based on its content
   */
  private detectChunkFacets(chunk: IndexedChunk): string[] {
    const facets: string[] = [];
    const content = chunk.text.toLowerCase();

    for (const [facetName, facet] of Object.entries(this.facetConfig.facets)) {
      const matches = facet.seeds.filter(seed => content.includes(seed.toLowerCase()));

      if (matches.length > 0) {
        facets.push(facetName);
      }
    }

    return facets;
  }

  /**
   * Infer symbol kind from metadata type
   */
  private inferSymbolKind(
    type: string
  ): 'class' | 'func' | 'route' | 'policy' | 'config' | undefined {
    if (type.includes('function') || type.includes('method')) return 'func';
    if (type.includes('class')) return 'class';
    if (type.includes('route') || type.includes('handler')) return 'route';
    if (type.includes('policy')) return 'policy';
    if (type.includes('config')) return 'config';
    return undefined;
  }

  /**
   * Get current project ID based on working directory
   */
  private getCurrentProjectId(): string {
    const cwd = process.cwd();
    return require('crypto').createHash('md5').update(cwd).digest('hex');
  }

  /**
   * Calculate coverage percentage
   */
  private calculateCoverage(chunks: ScoredChunk[]): number {
    if (chunks.length === 0) return 0;

    const uniqueFiles = new Set(chunks.map(c => c.meta.path));
    const totalFiles = chunks.length;

    return Math.min(1.0, uniqueFiles.size / Math.max(totalFiles, 1));
  }

  /**
   * Calculate cosine similarity between two vectors (handles both quantized and float32)
   */
  private cosineSimilarity(
    a: number[] | QuantizedEmbedding,
    b: number[] | QuantizedEmbedding
  ): number {
    // Normalize both embeddings to float32 arrays
    const aFloat32 = isQuantized(a) ? dequantizeInt8ToFloat32(a) : a;
    const bFloat32 = isQuantized(b) ? dequantizeInt8ToFloat32(b) : b;

    if (aFloat32.length !== bFloat32.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < aFloat32.length; i++) {
      dotProduct += aFloat32[i] * bFloat32[i];
      normA += aFloat32[i] * aFloat32[i];
      normB += bFloat32[i] * bFloat32[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Clear cached indexed chunks
   */
  clearCache(): void {
    this.indexedChunks.clear();
    logger.info('🧹 Shared retriever cache cleared');
  }
}

// Export a singleton instance
export const sharedRetriever = new SharedRetriever();
