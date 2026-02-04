/**
 * @fileOverview: Intelligent symbol deduplication to eliminate redundant code patterns across files
 * @module: Deduplicator
 * @keyFunctions:
 *   - deduplicateFiles(): Remove duplicate symbols across multiple files with configurable strategies
 *   - hashFileSymbols(): Generate content and signature hashes for symbol comparison
 *   - findCrossFileDuplicates(): Identify duplicates across different files
 *   - findIntraFileDuplicates(): Find duplicates within single files
 *   - removeDuplicates(): Eliminate redundant symbols while preserving references
 * @dependencies:
 *   - crypto: SHA-256 hash generation for symbol content comparison
 *   - ASTPruner: PrunedSymbol and PrunedFile data structures
 *   - HashedSymbol: Extended symbol interface with hash information
 * @context: Eliminates redundant code patterns by identifying and removing duplicate symbols, significantly reducing token usage while maintaining semantic integrity
 */

import { createHash } from 'crypto';
import { PrunedSymbol, PrunedFile } from './astPruner';
import { logger } from '../../utils/logger';

export interface HashedSymbol extends PrunedSymbol {
  contentHash: string;
  signatureHash: string;
  duplicateOf?: string;
  duplicateCount: number;
}

export interface DeduplicationResult {
  originalCount: number;
  deduplicatedCount: number;
  duplicatesFound: number;
  spacesSaved: number;
  hashMap: Map<string, HashedSymbol[]>;
}

export interface DeduplicationOptions {
  enableSignatureDeduplication: boolean;
  enableBodyDeduplication: boolean;
  enableCrossFileDeduplication: boolean;
  similarityThreshold: number; // 0-1, how similar symbols need to be to deduplicate
  preserveFirstOccurrence: boolean;
  maxDuplicateReferences: number;
  prioritizeExports?: boolean; // Prioritize exported symbols over internal ones during deduplication
}

export class Deduplicator {
  private options: DeduplicationOptions;
  private symbolHashMap = new Map<string, HashedSymbol[]>();
  private signatureHashMap = new Map<string, HashedSymbol[]>();

  constructor(options: Partial<DeduplicationOptions> = {}) {
    this.options = {
      enableSignatureDeduplication: true,
      enableBodyDeduplication: true,
      enableCrossFileDeduplication: true,
      similarityThreshold: 0.8,
      preserveFirstOccurrence: true,
      maxDuplicateReferences: 10,
      prioritizeExports: false,
      ...options,
    };
  }

  /**
   * Deduplicate symbols across one or more files
   */
  deduplicateFiles(files: PrunedFile[]): { files: PrunedFile[]; result: DeduplicationResult } {
    const allSymbols = files.flatMap(file => file.symbols);
    logger.info('Starting deduplication process', { symbolCount: allSymbols.length });

    this.symbolHashMap.clear();
    this.signatureHashMap.clear();

    const originalCount = files.reduce((sum, file) => sum + file.symbols.length, 0);
    let duplicatesFound = 0;
    let spacesSaved = 0;

    // Phase 1: Hash all symbols
    const hashedFiles = files.map(file => this.hashFileSymbols(file));

    // Phase 2: Find duplicates
    if (this.options.enableCrossFileDeduplication) {
      duplicatesFound += this.findCrossFileDuplicates(hashedFiles);
    } else {
      hashedFiles.forEach(file => {
        duplicatesFound += this.findIntraFileDuplicates(file);
      });
    }

    // Phase 3: Remove or merge duplicates
    const deduplicatedFiles = hashedFiles.map(file => this.removeDuplicates(file));

    const deduplicatedCount = deduplicatedFiles.reduce((sum, file) => sum + file.symbols.length, 0);
    spacesSaved = this.calculateSpacesSaved(files, deduplicatedFiles);

    const result: DeduplicationResult = {
      originalCount,
      deduplicatedCount,
      duplicatesFound,
      spacesSaved,
      hashMap: this.symbolHashMap,
    };

    logger.info('Deduplication completed', {
      originalCount,
      deduplicatedCount,
      duplicatesRemoved: duplicatesFound,
      compressionRatio: parseFloat((deduplicatedCount / originalCount).toFixed(3)),
    });

    return { files: deduplicatedFiles, result };
  }

  /**
   * Hash all symbols in a file
   */
  private hashFileSymbols(file: PrunedFile): PrunedFile & { symbols: HashedSymbol[] } {
    const hashedSymbols: HashedSymbol[] = file.symbols.map(symbol => {
      const contentHash = this.generateContentHash(symbol);
      const signatureHash = this.generateSignatureHash(symbol);

      const hashedSymbol: HashedSymbol = {
        ...symbol,
        contentHash,
        signatureHash,
        duplicateCount: 1,
      };

      // Store in hash maps for duplicate detection
      this.addToHashMap(this.symbolHashMap, contentHash, hashedSymbol);
      if (this.options.enableSignatureDeduplication) {
        this.addToHashMap(this.signatureHashMap, signatureHash, hashedSymbol);
      }

      return hashedSymbol;
    });

    return {
      ...file,
      symbols: hashedSymbols,
    };
  }

  /**
   * Generate content hash for a symbol (includes body)
   */
  private generateContentHash(symbol: PrunedSymbol): string {
    const content = [
      symbol.type,
      symbol.signature,
      symbol.compactedBody || '',
      symbol.docstring || '',
      symbol.relationships
        .map(r => `${r.type}:${r.target}`)
        .sort()
        .join(','),
    ].join('|');

    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Generate signature hash for a symbol (signature only)
   */
  private generateSignatureHash(symbol: PrunedSymbol): string {
    const signature = this.normalizeSignature(symbol.signature);
    return createHash('sha256').update(signature).digest('hex').substring(0, 16);
  }

  /**
   * Normalize signature for better matching
   */
  private normalizeSignature(signature: string): string {
    return signature
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[a-zA-Z_$][a-zA-Z0-9_$]*/g, match => {
        // Replace variable names with placeholders, but keep keywords
        const keywords = [
          'function',
          'class',
          'interface',
          'type',
          'const',
          'let',
          'var',
          'async',
          'export',
        ];
        return keywords.includes(match) ? match : 'VAR';
      })
      .trim();
  }

  /**
   * Add symbol to hash map
   */
  private addToHashMap(
    hashMap: Map<string, HashedSymbol[]>,
    hash: string,
    symbol: HashedSymbol
  ): void {
    if (!hashMap.has(hash)) {
      hashMap.set(hash, []);
    }
    hashMap.get(hash)!.push(symbol);
  }

  /**
   * Find duplicates across all files
   */
  private findCrossFileDuplicates(files: (PrunedFile & { symbols: HashedSymbol[] })[]): number {
    let duplicatesFound = 0;

    // Check content hash duplicates
    for (const [hash, symbols] of this.symbolHashMap.entries()) {
      if (symbols.length > 1) {
        duplicatesFound += this.markDuplicates(symbols, 'content');
      }
    }

    // Check signature hash duplicates (if enabled)
    if (this.options.enableSignatureDeduplication) {
      for (const [hash, symbols] of this.signatureHashMap.entries()) {
        if (symbols.length > 1 && symbols.every(s => !s.duplicateOf)) {
          duplicatesFound += this.markDuplicates(symbols, 'signature');
        }
      }
    }

    return duplicatesFound;
  }

  /**
   * Find duplicates within a single file
   */
  private findIntraFileDuplicates(file: PrunedFile & { symbols: HashedSymbol[] }): number {
    const fileSymbols = file.symbols;
    const localContentHashes = new Map<string, HashedSymbol[]>();
    const localSignatureHashes = new Map<string, HashedSymbol[]>();

    // Build local hash maps
    fileSymbols.forEach((symbol: HashedSymbol) => {
      this.addToHashMap(localContentHashes, symbol.contentHash, symbol);
      if (this.options.enableSignatureDeduplication) {
        this.addToHashMap(localSignatureHashes, symbol.signatureHash, symbol);
      }
    });

    let duplicatesFound = 0;

    // Find content duplicates
    for (const symbols of localContentHashes.values()) {
      if (symbols.length > 1) {
        duplicatesFound += this.markDuplicates(symbols, 'content');
      }
    }

    // Find signature duplicates
    if (this.options.enableSignatureDeduplication) {
      for (const symbols of localSignatureHashes.values()) {
        if (symbols.length > 1 && symbols.every(s => !s.duplicateOf)) {
          duplicatesFound += this.markDuplicates(symbols, 'signature');
        }
      }
    }

    return duplicatesFound;
  }

  /**
   * Mark symbols as duplicates
   */
  private markDuplicates(symbols: HashedSymbol[], type: 'content' | 'signature'): number {
    if (symbols.length <= 1) return 0;

    // Sort by importance and whether they're exported (keep most important)
    const sortedSymbols = [...symbols].sort((a, b) => {
      // If prioritizeExports is enabled, exported symbols get higher priority
      if (this.options.prioritizeExports && a.isExported !== b.isExported) {
        return a.isExported ? -1 : 1; // Keep exported symbols
      }

      // Otherwise, use the original logic
      if (a.isExported !== b.isExported) return b.isExported ? 1 : -1;
      return b.importance - a.importance;
    });

    const original = sortedSymbols[0];
    const duplicates = sortedSymbols.slice(1);

    // Mark duplicates
    duplicates.forEach(duplicate => {
      duplicate.duplicateOf = original.id;
      original.duplicateCount++;
    });

    logger.debug('Found duplicates', {
      originalSymbol: original.name,
      duplicateType: type,
      duplicateCount: duplicates.length,
    });

    return duplicates.length;
  }

  /**
   * Remove duplicates from file, keeping references
   */
  private removeDuplicates(file: PrunedFile & { symbols: HashedSymbol[] }): PrunedFile {
    const keptSymbols: HashedSymbol[] = [];
    const duplicateReferences: { [key: string]: string[] } = {};

    file.symbols.forEach((symbol: HashedSymbol) => {
      if (!symbol.duplicateOf) {
        // Keep original symbol
        keptSymbols.push(symbol);

        // Add duplicate references if any
        if (symbol.duplicateCount > 1) {
          const duplicates = this.findDuplicatesOf(symbol.id);
          duplicateReferences[symbol.id] = duplicates
            .slice(0, this.options.maxDuplicateReferences)
            .map(dup => `${dup.location.file}:${dup.location.startLine}`);
        }
      }
    });

    // Add duplicate reference information to kept symbols
    keptSymbols.forEach(symbol => {
      if (duplicateReferences[symbol.id]) {
        symbol.compactedBody =
          (symbol.compactedBody || '') +
          `\n// Also found in: ${duplicateReferences[symbol.id].join(', ')}`;
      }
    });

    return {
      ...file,
      symbols: keptSymbols,
    };
  }

  /**
   * Find all duplicates of a given symbol
   */
  private findDuplicatesOf(symbolId: string): HashedSymbol[] {
    const duplicates: HashedSymbol[] = [];

    for (const symbols of this.symbolHashMap.values()) {
      duplicates.push(...symbols.filter(s => s.duplicateOf === symbolId));
    }

    return duplicates;
  }

  /**
   * Calculate space saved by deduplication
   */
  private calculateSpacesSaved(original: PrunedFile[], deduplicated: PrunedFile[]): number {
    const originalTokens = original.reduce((sum, file) => sum + file.tokenCount, 0);
    const deduplicatedTokens = deduplicated.reduce((sum, file) => sum + file.tokenCount, 0);

    return originalTokens - deduplicatedTokens;
  }

  /**
   * Generate deduplication statistics
   */
  generateStats(result: DeduplicationResult): string {
    const compressionRatio =
      result.originalCount > 0
        ? ((result.deduplicatedCount / result.originalCount) * 100).toFixed(1)
        : '0';

    const duplicateRatio =
      result.originalCount > 0
        ? ((result.duplicatesFound / result.originalCount) * 100).toFixed(1)
        : '0';

    return [
      `📊 Deduplication Statistics:`,
      `   Original symbols: ${result.originalCount}`,
      `   After deduplication: ${result.deduplicatedCount}`,
      `   Duplicates removed: ${result.duplicatesFound} (${duplicateRatio}%)`,
      `   Compression ratio: ${compressionRatio}%`,
      `   Space saved: ${result.spacesSaved} tokens`,
    ].join('\n');
  }

  /**
   * Find similar symbols that might be candidates for deduplication
   */
  findSimilarSymbols(symbol: HashedSymbol, allSymbols: HashedSymbol[]): HashedSymbol[] {
    const similar: HashedSymbol[] = [];

    allSymbols.forEach(other => {
      if (other.id === symbol.id) return;

      const similarity = this.calculateSimilarity(symbol, other);
      if (similarity >= this.options.similarityThreshold) {
        similar.push(other);
      }
    });

    return similar;
  }

  /**
   * Calculate similarity between two symbols (0-1 scale)
   */
  private calculateSimilarity(symbol1: HashedSymbol, symbol2: HashedSymbol): number {
    // Exact hash match
    if (symbol1.contentHash === symbol2.contentHash) return 1.0;
    if (symbol1.signatureHash === symbol2.signatureHash) return 0.9;

    // Type and name similarity
    let similarity = 0;

    if (symbol1.type === symbol2.type) similarity += 0.3;
    if (symbol1.name === symbol2.name) similarity += 0.3;

    // Signature similarity (simplified)
    const sig1Words = symbol1.signature.split(/\W+/);
    const sig2Words = symbol2.signature.split(/\W+/);
    const commonWords = sig1Words.filter(word => sig2Words.includes(word));
    const sigSimilarity = commonWords.length / Math.max(sig1Words.length, sig2Words.length);
    similarity += sigSimilarity * 0.4;

    return Math.min(similarity, 1.0);
  }

  /**
   * Clean up hash maps (for memory management)
   */
  cleanup(): void {
    this.symbolHashMap.clear();
    this.signatureHashMap.clear();
  }
}
