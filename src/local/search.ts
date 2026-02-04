/**
 * @fileOverview: Local search engine for indexed project files with semantic scoring
 * @module: LocalSearch
 * @keyFunctions:
 *   - search(): Search indexed files with semantic scoring and ranking
 *   - indexFile(): Add file to local search index
 *   - calculateScore(): Compute relevance score for search results
 *   - clearIndex(): Remove project index from memory
 * @dependencies:
 *   - ProjectInfo: Project identification and metadata
 *   - CodeChunk/CodeSymbol: AST parsing results from TreeSitterProcessor
 *   - fs/path: File system operations for content access
 * @context: Provides fast local search capabilities for indexed project files with intelligent scoring based on content relevance and symbol matching
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectInfo } from './projectIdentifier';
import { CodeChunk, CodeSymbol } from './treeSitterProcessor';

export interface LocalSearchResult {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  symbolName?: string;
  symbolType?: string;
  language: string;
}

export interface IndexedFile {
  path: string;
  content: string;
  language: string;
  chunks: CodeChunk[];
  symbols: CodeSymbol[];
}

export class LocalSearch {
  private projectIndexes: Map<string, Map<string, IndexedFile>>;

  constructor() {
    this.projectIndexes = new Map();
  }

  async indexFile(project: ProjectInfo, file: IndexedFile): Promise<void> {
    let projectIndex = this.projectIndexes.get(project.id);
    if (!projectIndex) {
      projectIndex = new Map();
      this.projectIndexes.set(project.id, projectIndex);
    }

    projectIndex.set(file.path, file);
  }

  async search(project: ProjectInfo, query: string, k: number = 12): Promise<LocalSearchResult[]> {
    const projectIndex = this.projectIndexes.get(project.id);
    if (!projectIndex) {
      return [];
    }

    const results: LocalSearchResult[] = [];
    const queryLower = query.toLowerCase().trim();
    const queryTerms = queryLower.split(/\s+/).filter(term => term.length > 2);

    // Return empty results for empty queries
    if (queryTerms.length === 0) {
      return [];
    }

    // Search through all indexed files
    for (const [filePath, indexedFile] of projectIndex) {
      // Search in chunks
      for (const chunk of indexedFile.chunks) {
        const score = this.calculateScore(chunk.content, queryTerms, chunk.symbolName);

        if (score > 0) {
          results.push({
            path: filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            content: chunk.content,
            score,
            symbolName: chunk.symbolName,
            symbolType: chunk.symbolType,
            language: indexedFile.language,
          });
        }
      }

      // Search in symbols
      for (const symbol of indexedFile.symbols) {
        const score = this.calculateScore(symbol.source, queryTerms, symbol.name);

        if (score > 0) {
          results.push({
            path: filePath,
            startLine: symbol.startLine,
            endLine: symbol.endLine,
            content: symbol.source,
            score: score + 0.2, // Boost symbol matches
            symbolName: symbol.name,
            symbolType: symbol.kind,
            language: indexedFile.language,
          });
        }
      }
    }

    // Sort by score descending and return top k
    return results.sort((a, b) => b.score - a.score).slice(0, k);
  }

  private calculateScore(content: string, queryTerms: string[], symbolName?: string): number {
    const contentLower = content.toLowerCase();
    let score = 0;

    // Exact phrase match
    const queryPhrase = queryTerms.join(' ');
    if (contentLower.includes(queryPhrase)) {
      score += 1.0;
    }

    // Individual term matches
    for (const term of queryTerms) {
      const termOccurrences = (contentLower.match(new RegExp(term, 'g')) || []).length;
      score += termOccurrences * 0.3;
    }

    // Symbol name match bonus
    if (symbolName) {
      const symbolLower = symbolName.toLowerCase();
      for (const term of queryTerms) {
        if (symbolLower.includes(term)) {
          score += 0.5;
        }
        if (symbolLower === term) {
          score += 1.0;
        }
      }
    }

    // Content length penalty (favor shorter, more focused results)
    const lengthPenalty = Math.min(content.length / 1000, 0.5);
    score = Math.max(0, score - lengthPenalty);

    return score;
  }

  async clearProjectIndex(projectId: string): Promise<void> {
    this.projectIndexes.delete(projectId);
  }

  async getIndexStats(
    projectId: string
  ): Promise<{ fileCount: number; chunkCount: number; symbolCount: number } | null> {
    const projectIndex = this.projectIndexes.get(projectId);
    if (!projectIndex) {
      return null;
    }

    let chunkCount = 0;
    let symbolCount = 0;

    for (const indexedFile of projectIndex.values()) {
      chunkCount += indexedFile.chunks.length;
      symbolCount += indexedFile.symbols.length;
    }

    return {
      fileCount: projectIndex.size,
      chunkCount,
      symbolCount,
    };
  }

  async hasProjectData(project: ProjectInfo): Promise<boolean> {
    const projectIndex = this.projectIndexes.get(project.id);
    return projectIndex !== undefined && projectIndex.size > 0;
  }
}
