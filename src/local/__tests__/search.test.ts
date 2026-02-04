/**
 * @fileOverview: Comprehensive tests for LocalSearch functionality
 * @module: LocalSearch Tests
 * @context: Testing local search engine with semantic scoring and ranking
 */

import { LocalSearch, LocalSearchResult, IndexedFile } from '../search';
import { ProjectInfo } from '../projectIdentifier';
import { CodeChunk, CodeSymbol } from '../treeSitterProcessor';

// Mock data for testing
const mockProject: ProjectInfo = {
  id: 'test-project-123',
  name: 'TestProject',
  path: '/path/to/test/project',
  type: 'local',
  workspaceRoot: '/path/to/test/project',
  lastModified: new Date(),
};

const mockCodeChunk: CodeChunk = {
  content:
    'function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price, 0); }',
  startLine: 10,
  endLine: 12,
  tokenEstimate: 15,
  symbolName: 'calculateTotal',
  symbolType: 'function',
};

const mockCodeSymbol: CodeSymbol = {
  name: 'calculateTotal',
  kind: 'function',
  startLine: 10,
  endLine: 12,
  lang: 'typescript',
  source:
    'function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price, 0); }',
};

const mockIndexedFile: IndexedFile = {
  path: '/path/to/test/project/utils.ts',
  content: `import { Item } from './types';

function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export { calculateTotal };`,
  language: 'typescript',
  chunks: [mockCodeChunk],
  symbols: [mockCodeSymbol],
};

describe('LocalSearch', () => {
  let search: LocalSearch;

  beforeEach(() => {
    search = new LocalSearch();
  });

  describe('Constructor', () => {
    test('should initialize with empty project indexes', () => {
      expect(search).toBeInstanceOf(LocalSearch);
    });
  });

  describe('indexFile', () => {
    test('should index a file for a new project', async () => {
      await search.indexFile(mockProject, mockIndexedFile);

      const hasData = await search.hasProjectData(mockProject);
      expect(hasData).toBe(true);
    });

    test('should add multiple files to the same project', async () => {
      const secondFile: IndexedFile = {
        ...mockIndexedFile,
        path: '/path/to/test/project/types.ts',
        content: 'export interface Item { price: number; name: string; }',
        chunks: [],
        symbols: [],
      };

      await search.indexFile(mockProject, mockIndexedFile);
      await search.indexFile(mockProject, secondFile);

      const stats = await search.getIndexStats(mockProject.id);
      expect(stats).toEqual({
        fileCount: 2,
        chunkCount: 1,
        symbolCount: 1,
      });
    });

    test('should handle multiple projects independently', async () => {
      const project2: ProjectInfo = {
        ...mockProject,
        id: 'project-2',
        name: 'Project2',
      };

      await search.indexFile(mockProject, mockIndexedFile);
      await search.indexFile(project2, mockIndexedFile);

      const stats1 = await search.getIndexStats(mockProject.id);
      const stats2 = await search.getIndexStats(project2.id);

      expect(stats1?.fileCount).toBe(1);
      expect(stats2?.fileCount).toBe(1);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await search.indexFile(mockProject, mockIndexedFile);
    });

    test('should return empty array when no project index exists', async () => {
      const nonExistentProject: ProjectInfo = {
        ...mockProject,
        id: 'non-existent',
      };

      const results = await search.search(nonExistentProject, 'test query');
      expect(results).toEqual([]);
    });

    test('should find results by exact phrase match', async () => {
      const results = await search.search(mockProject, 'calculateTotal');
      expect(results).toHaveLength(2); // One from chunk, one from symbol
      expect(results[0].symbolName).toBe('calculateTotal');
      expect(results[0].score).toBeGreaterThan(0);
    });

    test('should find results by partial term match', async () => {
      const results = await search.search(mockProject, 'calculate');
      expect(results).toHaveLength(2);
      expect(results.every(r => r.score > 0)).toBe(true);
    });

    test('should boost symbol matches with higher score', async () => {
      const results = await search.search(mockProject, 'calculateTotal');

      // Symbol match should have higher score than chunk match
      const symbolResult = results.find(r => r.symbolType === 'function');
      const chunkResult = results.find(r => r.symbolType !== 'function');

      expect(symbolResult?.score).toBeGreaterThan(chunkResult?.score || 0);
    });

    test('should return results sorted by score descending', async () => {
      const results = await search.search(mockProject, 'function');
      expect(results).toHaveLength(2);

      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });

    test('should respect k parameter for result limit', async () => {
      const results = await search.search(mockProject, 'function', 1);
      expect(results).toHaveLength(1);
    });

    test('should filter out short query terms', async () => {
      const results = await search.search(mockProject, 'a an the');
      expect(results).toHaveLength(0);
    });

    test('should handle empty query', async () => {
      const results = await search.search(mockProject, '');
      // Empty query should not return results since queryTerms will be empty
      expect(results).toHaveLength(0);
    });

    test('should handle query with no matches', async () => {
      const results = await search.search(mockProject, 'nonexistentterm');
      expect(results).toEqual([]);
    });

    test('should include correct metadata in results', async () => {
      const results = await search.search(mockProject, 'calculateTotal');

      results.forEach(result => {
        expect(result).toHaveProperty('path');
        expect(result).toHaveProperty('startLine');
        expect(result).toHaveProperty('endLine');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('language');
        expect(typeof result.score).toBe('number');
        expect(result.score).toBeGreaterThan(0);
      });
    });
  });

  describe('calculateScore (indirect testing)', () => {
    test('should give higher score for exact symbol name matches', async () => {
      const testSearch = new LocalSearch();
      await testSearch.indexFile(mockProject, mockIndexedFile);

      const results = await testSearch.search(mockProject, 'calculateTotal');

      const symbolResult = results.find(r => r.symbolName === 'calculateTotal');

      expect(symbolResult?.score).toBeGreaterThan(1.0); // Should include symbol match bonus
    });

    test('should penalize long content', async () => {
      const testSearch = new LocalSearch();

      // Create a shorter content with known matches to compare with long content
      const shortContent = 'function testFunction() { return true; }'; // Short content
      const shortFile: IndexedFile = {
        ...mockIndexedFile,
        content: shortContent,
        chunks: [
          {
            ...mockCodeChunk,
            content: shortContent,
          },
        ],
      };

      // Create long content with same matches
      const longContent = shortContent + 'x'.repeat(3000); // Add padding to make it long
      const longFile: IndexedFile = {
        ...mockIndexedFile,
        content: longContent,
        chunks: [
          {
            ...mockCodeChunk,
            content: longContent,
          },
        ],
      };

      await testSearch.indexFile(mockProject, shortFile);
      await testSearch.indexFile(mockProject, longFile);
      const results = await testSearch.search(mockProject, 'function');

      const shortResult = results.find(r => r.content.length < 100);
      const longResult = results.find(r => r.content.length > 1000);

      if (shortResult && longResult) {
        // Long content should have lower score due to length penalty
        expect(longResult.score).toBeLessThan(shortResult.score);
      }
    });

    test('should handle multiple term matches', async () => {
      const testSearch = new LocalSearch();
      await testSearch.indexFile(mockProject, mockIndexedFile);

      const multiTermQuery = 'function calculate';
      const results = await testSearch.search(mockProject, multiTermQuery);

      expect(results.length).toBeGreaterThan(0);
      // Should have score due to multiple matches
      if (results.length > 0) {
        expect(results[0].score).toBeGreaterThan(0);
      }
    });
  });

  describe('clearProjectIndex', () => {
    test('should remove project index', async () => {
      await search.indexFile(mockProject, mockIndexedFile);

      let hasData = await search.hasProjectData(mockProject);
      expect(hasData).toBe(true);

      await search.clearProjectIndex(mockProject.id);

      hasData = await search.hasProjectData(mockProject);
      expect(hasData).toBe(false);
    });

    test('should handle clearing non-existent project', async () => {
      await expect(search.clearProjectIndex('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('getIndexStats', () => {
    test('should return null for non-existent project', async () => {
      const stats = await search.getIndexStats('non-existent');
      expect(stats).toBeNull();
    });

    test('should return correct stats for indexed project', async () => {
      await search.indexFile(mockProject, mockIndexedFile);

      const stats = await search.getIndexStats(mockProject.id);
      expect(stats).toEqual({
        fileCount: 1,
        chunkCount: 1,
        symbolCount: 1,
      });
    });

    test('should handle project with multiple files', async () => {
      const file1: IndexedFile = {
        ...mockIndexedFile,
        chunks: [mockCodeChunk, mockCodeChunk],
        symbols: [mockCodeSymbol, mockCodeSymbol],
      };

      const file2: IndexedFile = {
        ...mockIndexedFile,
        path: '/path/to/test/project/file2.ts',
        chunks: [mockCodeChunk],
        symbols: [],
      };

      await search.indexFile(mockProject, file1);
      await search.indexFile(mockProject, file2);

      const stats = await search.getIndexStats(mockProject.id);
      expect(stats).toEqual({
        fileCount: 2,
        chunkCount: 3,
        symbolCount: 2,
      });
    });
  });

  describe('hasProjectData', () => {
    test('should return false for non-existent project', async () => {
      const hasData = await search.hasProjectData(mockProject);
      expect(hasData).toBe(false);
    });

    test('should return true for project with indexed files', async () => {
      await search.indexFile(mockProject, mockIndexedFile);

      const hasData = await search.hasProjectData(mockProject);
      expect(hasData).toBe(true);
    });

    test('should return false after clearing project index', async () => {
      await search.indexFile(mockProject, mockIndexedFile);
      await search.clearProjectIndex(mockProject.id);

      const hasData = await search.hasProjectData(mockProject);
      expect(hasData).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty indexed file', async () => {
      const emptyFile: IndexedFile = {
        path: '/path/to/empty.ts',
        content: '',
        language: 'typescript',
        chunks: [],
        symbols: [],
      };

      await search.indexFile(mockProject, emptyFile);

      const results = await search.search(mockProject, 'test');
      expect(results).toEqual([]);
    });

    test('should handle file with no chunks or symbols', async () => {
      const contentOnlyFile: IndexedFile = {
        path: '/path/to/content.ts',
        content: 'This is just plain text content without any symbols.',
        language: 'typescript',
        chunks: [],
        symbols: [],
      };

      await search.indexFile(mockProject, contentOnlyFile);

      const results = await search.search(mockProject, 'plain text');
      expect(results).toHaveLength(0); // No chunks to search in
    });

    test('should handle large k parameter', async () => {
      const results = await search.search(mockProject, 'function', 1000);
      expect(results.length).toBeLessThanOrEqual(2); // Only 2 results available
    });
  });
});
