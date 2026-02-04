/**
 * @fileOverview: Shared retrieval system types and interfaces
 * @module: RetrievalTypes
 * @context: Defines the interfaces for the shared embedding-assisted retrieval system
 */

import { QuantizedEmbedding } from '../../local/quantization';

// Index-time record
export interface IndexedChunk {
  id: string;
  text: string;
  embedding: number[] | QuantizedEmbedding; // Support both float32 and quantized int8
  meta: {
    path: string;
    facet_tags: string[];
    signals?: string[]; // e.g., ['verifyAuth','RLS','Authorization']
    symbol_kind?: 'class' | 'func' | 'route' | 'policy' | 'config';
    imports?: string[];
    exports?: string[];
    path_tokens?: string[];
    language?: string;
    startLine?: number;
    endLine?: number;
  };
}

export interface EmbeddingIndex {
  upsert(chunks: IndexedChunk[]): Promise<void>;
  search(qVec: number[], opts: SearchOpts): Promise<ScoredChunk[]>;
}

export interface SearchOpts {
  topK: number; // e.g., 60 coarse → 15 final
  minSim?: number; // e.g., 0.18–0.25
  facets?: string[]; // preferred facets
  mustSignals?: string[]; // anchors that force-include defs
  perFacetCap?: Record<string, number>;
  mmrLambda?: number; // 0.3–0.5
}

export interface ScoredChunk extends IndexedChunk {
  score: number;
}

// Shared retriever
export interface Retriever {
  retrieve(query: string, task: 'understand' | 'overview' | 'troubleshoot'): Promise<ScoredChunk[]>;
}

// Facet configuration
export interface FacetConfig {
  facets: Record<
    string,
    {
      seeds: string[];
      description: string;
    }
  >;
  retrieval: {
    perFacetCap: Record<string, number>;
    mmrLambda: number;
    minSim: number;
    penalties: Record<string, number>;
    maxRetries: number;
    timeoutMs: number;
  };
  anchors: Record<string, string[]>;
}

// Query analysis result
export interface QueryAnalysis {
  facets: string[];
  confidence: number;
  detectedKeywords: string[];
  taskType: 'understand' | 'overview' | 'troubleshoot';
}

// Retrieval result with metadata
export interface RetrievalResult {
  chunks: ScoredChunk[];
  queryAnalysis: QueryAnalysis;
  anchorsHit: string[];
  perFacetCounts: Record<string, number>;
  coveragePct: number;
  processingTimeMs: number;
  timings: {
    embedMs: number;
    searchMs: number;
    expandMs: number;
    rankMs: number;
  };
}
