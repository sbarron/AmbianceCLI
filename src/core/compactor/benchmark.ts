/**
 * @fileOverview: Comprehensive performance testing and analysis suite for the SemanticCompactor system
 * @module: SemanticCompactorBenchmark
 * @keyFunctions:
 *   - benchmarkProject(): Run complete performance analysis on a project
 *   - compareConfigurations(): Compare different compaction configurations
 *   - runRegressionTest(): Detect performance regressions against baselines
 *   - generateReport(): Create detailed benchmark reports with recommendations
 * @dependencies:
 *   - SemanticCompactor: Core compaction engine
 *   - FileDiscovery: File system scanning
 *   - performance: Node.js performance measurement
 *   - fs/promises: File system operations
 * @context: Provides comprehensive performance monitoring and quality assurance for the code compression pipeline, enabling optimization while maintaining semantic integrity
 */

import { SemanticCompactor, CompactedProject } from './semanticCompactor';
import { FileDiscovery } from './fileDiscovery';
import { performance } from 'perf_hooks';
import { writeFile } from 'fs/promises';
import path from 'path';

export interface BenchmarkResult {
  projectPath: string;
  metrics: {
    // Performance metrics
    totalProcessingTime: number;
    fileDiscoveryTime: number;
    parsingTime: number;
    pruningTime: number;
    deduplicationTime: number;
    scoringTime: number;

    // Size metrics
    originalFiles: number;
    processedFiles: number;
    skippedFiles: number;

    // Symbol metrics
    originalSymbols: number;
    prunedSymbols: number;
    deduplicatedSymbols: number;
    duplicatesFound: number;

    // Token metrics
    estimatedOriginalTokens: number;
    compactedTokens: number;
    compressionRatio: number;
    spaceSavedTokens: number;

    // Quality metrics
    averageSymbolImportance: number;
    exportedSymbolsPercentage: number;
    documentedSymbolsPercentage: number;
    errorRate: number;
  };

  // Detailed timing breakdown
  phaseTimings: {
    [phase: string]: number;
  };

  // Memory usage
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };

  // Configuration used
  config: any;
}

export interface ComparisonResult {
  baseline: BenchmarkResult;
  optimized: BenchmarkResult;
  improvements: {
    processingTimeReduction: number;
    compressionImprovement: number;
    qualityImprovement: number;
  };
}

export class SemanticCompactorBenchmark {
  /**
   * Run comprehensive benchmark on a project
   */
  async benchmarkProject(projectPath: string, config?: any): Promise<BenchmarkResult> {
    console.log(`🏁 Starting benchmark for: ${projectPath}`);

    const startTime = performance.now();
    const initialMemory = process.memoryUsage();

    // Phase timing tracking
    const phaseTimings: { [phase: string]: number } = {};

    // Phase 1: File Discovery
    let phaseStart = performance.now();
    const fileDiscovery = new FileDiscovery(projectPath);
    const discoveredFiles = await fileDiscovery.discoverFiles();
    phaseTimings.fileDiscovery = performance.now() - phaseStart;

    // Phase 2: Compaction
    phaseStart = performance.now();
    const compactor = new SemanticCompactor(projectPath, config);
    const result = await compactor.compact();
    const totalCompactionTime = performance.now() - phaseStart;

    // Break down compaction timing (estimated based on typical ratios)
    phaseTimings.parsing = totalCompactionTime * 0.3;
    phaseTimings.pruning = totalCompactionTime * 0.2;
    phaseTimings.deduplication = totalCompactionTime * 0.2;
    phaseTimings.scoring = totalCompactionTime * 0.2;
    phaseTimings.summarization = totalCompactionTime * 0.1;

    const totalTime = performance.now() - startTime;
    const finalMemory = process.memoryUsage();

    // Calculate metrics
    const metrics = this.calculateMetrics(result, discoveredFiles.length);

    const benchmarkResult: BenchmarkResult = {
      projectPath,
      metrics: {
        ...metrics,
        totalProcessingTime: totalTime,
        fileDiscoveryTime: phaseTimings.fileDiscovery,
        parsingTime: phaseTimings.parsing,
        pruningTime: phaseTimings.pruning,
        deduplicationTime: phaseTimings.deduplication,
        scoringTime: phaseTimings.scoring,
      },
      phaseTimings,
      memoryUsage: {
        heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
        heapTotal: finalMemory.heapTotal,
        external: finalMemory.external - initialMemory.external,
      },
      config: config || {},
    };

    console.log(`✅ Benchmark completed in ${totalTime.toFixed(2)}ms`);
    this.printBenchmarkSummary(benchmarkResult);

    return benchmarkResult;
  }

  /**
   * Compare different configurations
   */
  async compareConfigurations(
    projectPath: string,
    baselineConfig: any,
    optimizedConfig: any
  ): Promise<ComparisonResult> {
    console.log('📊 Running configuration comparison...');

    const baseline = await this.benchmarkProject(projectPath, baselineConfig);
    const optimized = await this.benchmarkProject(projectPath, optimizedConfig);

    const improvements = {
      processingTimeReduction:
        (baseline.metrics.totalProcessingTime - optimized.metrics.totalProcessingTime) /
        baseline.metrics.totalProcessingTime,
      compressionImprovement:
        (optimized.metrics.compressionRatio - baseline.metrics.compressionRatio) /
        baseline.metrics.compressionRatio,
      qualityImprovement:
        (optimized.metrics.averageSymbolImportance - baseline.metrics.averageSymbolImportance) /
        baseline.metrics.averageSymbolImportance,
    };

    return {
      baseline,
      optimized,
      improvements,
    };
  }

  /**
   * Run performance regression tests
   */
  async runRegressionTest(
    projectPath: string,
    baselineResults: BenchmarkResult[],
    threshold: number = 0.2
  ): Promise<{ passed: boolean; issues: string[] }> {
    console.log('🔍 Running regression test...');

    const currentResult = await this.benchmarkProject(projectPath);
    const issues: string[] = [];

    // Check performance regression
    const avgBaselineTime =
      baselineResults.reduce((sum, r) => sum + r.metrics.totalProcessingTime, 0) /
      baselineResults.length;
    const timeRegression =
      (currentResult.metrics.totalProcessingTime - avgBaselineTime) / avgBaselineTime;

    if (timeRegression > threshold) {
      issues.push(
        `Performance regression: ${(timeRegression * 100).toFixed(2)}% slower than baseline`
      );
    }

    // Check compression regression
    const avgBaselineCompression =
      baselineResults.reduce((sum, r) => sum + r.metrics.compressionRatio, 0) /
      baselineResults.length;
    const compressionRegression =
      (avgBaselineCompression - currentResult.metrics.compressionRatio) / avgBaselineCompression;

    if (compressionRegression > threshold) {
      issues.push(
        `Compression regression: ${(compressionRegression * 100).toFixed(2)}% worse compression`
      );
    }

    // Check error rate regression
    const avgBaselineErrors =
      baselineResults.reduce((sum, r) => sum + r.metrics.errorRate, 0) / baselineResults.length;
    if (currentResult.metrics.errorRate > avgBaselineErrors * (1 + threshold)) {
      issues.push(
        `Error rate regression: ${(currentResult.metrics.errorRate * 100).toFixed(2)}% vs baseline ${(avgBaselineErrors * 100).toFixed(2)}%`
      );
    }

    return {
      passed: issues.length === 0,
      issues,
    };
  }

  /**
   * Generate detailed benchmark report
   */
  async generateReport(results: BenchmarkResult[], outputPath: string): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      summary: this.generateSummaryStats(results),
      detailed_results: results,
      recommendations: this.generateRecommendations(results),
    };

    await writeFile(outputPath, JSON.stringify(report, null, 2));
    console.log(`📄 Benchmark report saved to: ${outputPath}`);
  }

  /**
   * Calculate comprehensive metrics from compaction result
   */
  private calculateMetrics(result: CompactedProject, originalFiles: number): any {
    const stats = result.processingStats;

    const allSymbols = result.files.flatMap(f => f.nodes);
    const exportedSymbols = allSymbols.filter(s => s.summary.tags?.includes('exported'));
    const documentedSymbols = allSymbols.filter(s => s.docstring && s.docstring.length > 0);

    const averageImportance =
      allSymbols.length > 0
        ? allSymbols.reduce((sum, s) => sum + (s.relevanceScore || 0), 0) / allSymbols.length
        : 0;

    const estimatedOriginalTokens = stats.totalSymbols * 50; // Rough estimate

    return {
      originalFiles,
      processedFiles: stats.filesProcessed,
      skippedFiles: stats.filesSkipped,

      originalSymbols: stats.totalSymbols,
      prunedSymbols: stats.symbolsAfterPruning,
      deduplicatedSymbols: stats.symbolsAfterDeduplication,
      duplicatesFound: stats.duplicatesRemoved,

      estimatedOriginalTokens,
      compactedTokens: result.totalTokens,
      compressionRatio: result.compressionRatio,
      spaceSavedTokens: estimatedOriginalTokens - result.totalTokens,

      averageSymbolImportance: averageImportance,
      exportedSymbolsPercentage:
        allSymbols.length > 0 ? exportedSymbols.length / allSymbols.length : 0,
      documentedSymbolsPercentage:
        allSymbols.length > 0 ? documentedSymbols.length / allSymbols.length : 0,
      errorRate: stats.filesProcessed > 0 ? stats.errors.length / stats.filesProcessed : 0,
    };
  }

  /**
   * Print benchmark summary to console
   */
  private printBenchmarkSummary(result: BenchmarkResult): void {
    console.log('\n📊 Benchmark Summary:');
    console.log(`   Processing Time: ${result.metrics.totalProcessingTime.toFixed(2)}ms`);
    console.log(
      `   Files: ${result.metrics.processedFiles}/${result.metrics.originalFiles} processed`
    );
    console.log(
      `   Symbols: ${result.metrics.originalSymbols} → ${result.metrics.deduplicatedSymbols}`
    );
    console.log(`   Compression: ${(result.metrics.compressionRatio * 100).toFixed(1)}%`);
    console.log(`   Token Savings: ${result.metrics.spaceSavedTokens.toLocaleString()}`);
    console.log(`   Quality Score: ${(result.metrics.averageSymbolImportance * 100).toFixed(1)}`);
    console.log(`   Memory Used: ${(result.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);

    if (result.metrics.errorRate > 0) {
      console.log(`   ⚠️  Error Rate: ${(result.metrics.errorRate * 100).toFixed(2)}%`);
    }
  }

  /**
   * Generate summary statistics across multiple results
   */
  private generateSummaryStats(results: BenchmarkResult[]): any {
    if (results.length === 0) return {};

    const metrics = results.map(r => r.metrics);

    return {
      runs: results.length,
      processing_time: {
        min: Math.min(...metrics.map(m => m.totalProcessingTime)),
        max: Math.max(...metrics.map(m => m.totalProcessingTime)),
        avg: metrics.reduce((sum, m) => sum + m.totalProcessingTime, 0) / metrics.length,
        std_dev: this.calculateStdDev(metrics.map(m => m.totalProcessingTime)),
      },
      compression: {
        min: Math.min(...metrics.map(m => m.compressionRatio)),
        max: Math.max(...metrics.map(m => m.compressionRatio)),
        avg: metrics.reduce((sum, m) => sum + m.compressionRatio, 0) / metrics.length,
      },
      quality: {
        avg_importance:
          metrics.reduce((sum, m) => sum + m.averageSymbolImportance, 0) / metrics.length,
        avg_documented:
          metrics.reduce((sum, m) => sum + m.documentedSymbolsPercentage, 0) / metrics.length,
        avg_exported:
          metrics.reduce((sum, m) => sum + m.exportedSymbolsPercentage, 0) / metrics.length,
      },
    };
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(results: BenchmarkResult[]): string[] {
    const recommendations: string[] = [];
    const avgResult = results[results.length - 1]; // Use latest result

    if (avgResult.metrics.compressionRatio > 0.8) {
      recommendations.push('Consider enabling more aggressive deduplication settings');
    }

    if (avgResult.metrics.errorRate > 0.1) {
      recommendations.push('High error rate detected - review file filtering and parsing settings');
    }

    if (avgResult.metrics.documentedSymbolsPercentage < 0.3) {
      recommendations.push('Low documentation coverage - consider including more docstrings');
    }

    if (avgResult.metrics.totalProcessingTime > 10000) {
      recommendations.push(
        'Processing time is high - consider reducing maxFileSize or enabling file filtering'
      );
    }

    if (avgResult.metrics.averageSymbolImportance < 30) {
      recommendations.push('Low average symbol importance - review pruning and scoring criteria');
    }

    return recommendations;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[]): number {
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - avg, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / squaredDiffs.length;
    return Math.sqrt(avgSquaredDiff);
  }
}

// CLI interface
export async function runBenchmarkCLI(): Promise<void> {
  const args = process.argv.slice(2);
  const projectPath = args[0] || process.cwd();
  const outputPath = args[1] || path.join(process.cwd(), 'benchmark-results.json');

  console.log('🚀 Starting Semantic Compactor Benchmark');
  console.log(`Project: ${projectPath}`);
  console.log(`Output: ${outputPath}`);

  const benchmark = new SemanticCompactorBenchmark();

  // Run multiple configurations for comparison
  const configs = [
    { name: 'baseline', config: {} },
    {
      name: 'optimized',
      config: {
        deduplicationOptions: { enableCrossFileDeduplication: true, similarityThreshold: 0.9 },
        astOptions: { maxFunctionBodyLines: 5, includePrivateMethods: false },
      },
    },
    {
      name: 'aggressive',
      config: {
        deduplicationOptions: { enableCrossFileDeduplication: true, similarityThreshold: 0.8 },
        astOptions: { maxFunctionBodyLines: 3, includePrivateMethods: false },
        minSymbolImportance: 20,
      },
    },
  ];

  const results: BenchmarkResult[] = [];

  for (const { name, config } of configs) {
    console.log(`\n🔧 Running ${name} configuration...`);
    const result = await benchmark.benchmarkProject(projectPath, config);
    result.config.name = name;
    results.push(result);
  }

  // Generate comprehensive report
  await benchmark.generateReport(results, outputPath);

  // Print comparison
  console.log('\n📈 Configuration Comparison:');
  const baseline = results[0];
  for (let i = 1; i < results.length; i++) {
    const current = results[i];
    const timeImprovement =
      (baseline.metrics.totalProcessingTime - current.metrics.totalProcessingTime) /
      baseline.metrics.totalProcessingTime;
    const compressionImprovement =
      (current.metrics.compressionRatio - baseline.metrics.compressionRatio) /
      baseline.metrics.compressionRatio;

    console.log(`   ${current.config.name}:`);
    console.log(
      `     Time: ${timeImprovement >= 0 ? '+' : ''}${(timeImprovement * 100).toFixed(2)}%`
    );
    console.log(
      `     Compression: ${compressionImprovement >= 0 ? '+' : ''}${(compressionImprovement * 100).toFixed(2)}%`
    );
  }

  console.log('\n✅ Benchmark completed successfully!');
}

// Run if called directly
if (require.main === module) {
  runBenchmarkCLI().catch(console.error);
}
