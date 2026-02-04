// Main semantic compactor exports
export {
  SemanticCompactor,
  type CompactedProject,
  type CompactedFile,
  type CompactedNode,
  type CompactionOptions,
  type ProcessingStats,
} from './semanticCompactor';

// File discovery exports
export { FileDiscovery, type FileInfo, type SupportedLanguage } from './fileDiscovery';

// AST parsing exports
export {
  ASTParser,
  type ParsedFile,
  type Symbol,
  type Parameter,
  type ImportStatement,
  type ExportStatement,
} from './astParser';

// AST pruning exports
export {
  ASTPruner,
  type PrunedFile,
  type PrunedSymbol,
  type Relationship,
  ASTProcessingOptions,
} from './astPruner';

// Semantic summarization exports
export {
  SemanticSummarizer,
  type SymbolSummary,
  type FileSummary,
  type ProjectSummary,
} from './semanticSummarizer';

// Deduplication exports
export {
  Deduplicator,
  type HashedSymbol,
  type DeduplicationResult,
  type DeduplicationOptions,
} from './deduplicator';

// Relevance scoring exports
export {
  RelevanceScorer,
  type RelevanceContext,
  type ScoredSymbol,
  type FilteredResult,
} from './relevanceScorer';

// Benchmark exports
export {
  SemanticCompactorBenchmark,
  type BenchmarkResult,
  type ComparisonResult,
  runBenchmarkCLI,
} from './benchmark';

// Re-export enhanced search handlers
// Enhanced context handlers are now in robustTools.ts
