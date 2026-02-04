#!/usr/bin/env ts-node

import { SemanticCompactorBenchmark } from '../src/core/compactor/benchmark';
import path from 'path';

async function main() {
  const projectPath = process.argv[2] || process.cwd();
  const benchmark = new SemanticCompactorBenchmark();

  console.log('🚀 Semantic Compactor Benchmark');
  console.log(`📁 Project: ${projectPath}`);

  try {
    // Basic benchmark
    console.log('\n1️⃣ Running basic benchmark...');
    const basicResult = await benchmark.benchmarkProject(projectPath);

    // Performance-optimized benchmark
    console.log('\n2️⃣ Running performance-optimized benchmark...');
    const optimizedResult = await benchmark.benchmarkProject(projectPath, {
      maxConcurrentFiles: 20,
      astOptions: {
        maxFunctionBodyLines: 3,
        includePrivateMethods: false,
        includeComments: false,
      },
      deduplicationOptions: {
        enableCrossFileDeduplication: true,
        similarityThreshold: 0.9,
      },
    });

    // Quality-focused benchmark
    console.log('\n3️⃣ Running quality-focused benchmark...');
    const qualityResult = await benchmark.benchmarkProject(projectPath, {
      astOptions: {
        includeComments: true,
        includePrivateMethods: true,
        maxFunctionBodyLines: 10,
      },
      includeDocstrings: true,
      minSymbolImportance: 5,
    });

    // Comparison
    console.log('\n📊 COMPARISON RESULTS:');
    console.log('='.repeat(60));

    const results = [
      { name: 'Basic', result: basicResult },
      { name: 'Performance', result: optimizedResult },
      { name: 'Quality', result: qualityResult },
    ];

    // Print comparison table
    console.log('Configuration    | Time(ms) | Compression | Quality | Memory(MB)');
    console.log('-'.repeat(65));

    results.forEach(({ name, result }) => {
      const time = result.metrics.totalProcessingTime.toFixed(0);
      const compression = (result.metrics.compressionRatio * 100).toFixed(1) + '%';
      const quality = result.metrics.averageSymbolImportance.toFixed(1);
      const memory = (result.memoryUsage.heapUsed / 1024 / 1024).toFixed(1);

      console.log(
        `${name.padEnd(15)} | ${time.padStart(8)} | ${compression.padStart(11)} | ${quality.padStart(7)} | ${memory.padStart(9)}`
      );
    });

    // Recommendations
    console.log('\n💡 RECOMMENDATIONS:');
    console.log('='.repeat(60));

    const fastest = results.reduce((min, curr) =>
      curr.result.metrics.totalProcessingTime < min.result.metrics.totalProcessingTime ? curr : min
    );

    const bestCompression = results.reduce((min, curr) =>
      curr.result.metrics.compressionRatio < min.result.metrics.compressionRatio ? curr : min
    );

    const bestQuality = results.reduce((max, curr) =>
      curr.result.metrics.averageSymbolImportance > max.result.metrics.averageSymbolImportance
        ? curr
        : max
    );

    console.log(
      `🚀 Fastest: ${fastest.name} (${fastest.result.metrics.totalProcessingTime.toFixed(0)}ms)`
    );
    console.log(
      `🗜️  Best Compression: ${bestCompression.name} (${(bestCompression.result.metrics.compressionRatio * 100).toFixed(1)}%)`
    );
    console.log(
      `⭐ Best Quality: ${bestQuality.name} (${bestQuality.result.metrics.averageSymbolImportance.toFixed(1)} avg importance)`
    );

    // Token savings
    console.log('\n💰 TOKEN SAVINGS:');
    console.log('='.repeat(60));
    results.forEach(({ name, result }) => {
      const savings = result.metrics.spaceSavedTokens;
      const percentage =
        ((result.metrics.estimatedOriginalTokens - result.metrics.compactedTokens) /
          result.metrics.estimatedOriginalTokens) *
        100;
      console.log(
        `${name}: ${savings.toLocaleString()} tokens saved (${percentage.toFixed(1)}% reduction)`
      );
    });

    // Performance insights
    console.log('\n⚡ PERFORMANCE INSIGHTS:');
    console.log('='.repeat(60));

    const avgProcessingTime =
      results.reduce((sum, r) => sum + r.result.metrics.totalProcessingTime, 0) / results.length;
    const avgFilesPerSecond =
      results.reduce(
        (sum, r) =>
          sum + r.result.metrics.processedFiles / (r.result.metrics.totalProcessingTime / 1000),
        0
      ) / results.length;

    console.log(`📈 Average processing time: ${avgProcessingTime.toFixed(0)}ms`);
    console.log(`📁 Average files per second: ${avgFilesPerSecond.toFixed(1)}`);
    console.log(
      `🧠 Average memory usage: ${(results.reduce((sum, r) => sum + r.result.memoryUsage.heapUsed, 0) / results.length / 1024 / 1024).toFixed(1)}MB`
    );

    // Save detailed results
    const outputPath = path.join(
      process.cwd(),
      `benchmark-${new Date().toISOString().slice(0, 10)}.json`
    );
    await benchmark.generateReport(
      results.map(r => r.result),
      outputPath
    );

    console.log(`\n📄 Detailed results saved to: ${outputPath}`);
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
