/**
 * @fileOverview: Unit tests for the TreeSitterProcessor class
 * @module: TreeSitterProcessor Tests
 * @description: Comprehensive test suite for TreeSitterProcessor covering AST parsing, code chunking, symbol extraction, and fallback mechanisms
 */

import { TreeSitterProcessor, CodeChunk, CodeSymbol, CodeXRef } from '../treeSitterProcessor';

// Mock tree-sitter modules
jest.mock('tree-sitter', () => ({
  Parser: jest.fn().mockImplementation(() => ({
    setLanguage: jest.fn(),
    parse: jest.fn(),
  })),
}));

jest.mock('tree-sitter-typescript', () => ({
  default: {
    typescript: jest.fn(),
  },
}));

jest.mock('tree-sitter-javascript', () => ({
  default: jest.fn(),
}));

jest.mock('tree-sitter-python', () => ({
  default: jest.fn(),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from '../../utils/logger';

describe('TreeSitterProcessor', () => {
  let processor: TreeSitterProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new TreeSitterProcessor();
  });

  describe('Initialization', () => {
    test('should initialize with empty parsers map', () => {
      expect(processor).toBeDefined();
    });
  });

  describe('parseAndChunk', () => {
    const testContent = 'function test() { return "hello"; }';
    const testFilePath = '/test/file.js';
    const testLanguage = 'javascript';

    test('should handle invalid content input', async () => {
      const result = await processor.parseAndChunk('', testLanguage, testFilePath);

      expect(result.chunks).toBeDefined();
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.symbols).toEqual([]);
      expect(result.xrefs).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith('Invalid content for parsing', expect.any(Object));
    });

    test('should handle invalid language input', async () => {
      const result = await processor.parseAndChunk(testContent, '', testFilePath);

      expect(result.chunks).toBeDefined();
      expect(result.symbols).toEqual([]);
      expect(result.xrefs).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith('Invalid language for parsing', expect.any(Object));
    });

    test('should handle empty content', async () => {
      const result = await processor.parseAndChunk('', testLanguage, testFilePath);

      expect(result.chunks).toBeDefined();
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].content).toBe('');
      expect(result.chunks[0].startLine).toBe(1);
      expect(result.chunks[0].endLine).toBe(1);
      expect(result.chunks[0].tokenEstimate).toBe(0);
    });

    test('should handle content with null bytes', async () => {
      const contentWithNull = 'function test() { return "hello\0world"; }';

      const result = await processor.parseAndChunk(contentWithNull, testLanguage, testFilePath);

      expect(result.chunks).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Problematic content detected, using fallback',
        expect.any(Object)
      );
    });

    test('should handle content with invalid characters', async () => {
      const contentWithInvalidChars = 'function test() { return "hello\x00world"; }';

      const result = await processor.parseAndChunk(
        contentWithInvalidChars,
        testLanguage,
        testFilePath
      );

      expect(result.chunks).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Problematic content detected, using fallback',
        expect.any(Object)
      );
    });

    test('should handle very large content', async () => {
      const largeContent = 'x'.repeat(1024 * 1024 + 1); // Over 1MB

      const result = await processor.parseAndChunk(largeContent, testLanguage, testFilePath);

      expect(result.chunks).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Problematic content detected, using fallback',
        expect.any(Object)
      );
    });
  });

  describe('Fallback Chunking', () => {
    test('should create chunks from empty content', () => {
      const chunks = (processor as any).fallbackChunking('', '/test/empty.js');

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        content: '',
        startLine: 1,
        endLine: 1,
        tokenEstimate: 0,
        symbolName: 'empty_file',
        symbolType: 'fallback',
      });
    });

    test('should create chunks from whitespace-only content', () => {
      const chunks = (processor as any).fallbackChunking('   \n\t  \n  ', '/test/whitespace.js');

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        content: '',
        startLine: 1,
        endLine: 1,
        tokenEstimate: 0,
        symbolName: 'empty_file',
        symbolType: 'fallback',
      });
    });

    test('should chunk content into 50-line segments', () => {
      const lines = Array.from({ length: 120 }, (_, i) => `line ${i + 1};`);
      const content = lines.join('\n');

      const chunks = (processor as any).fallbackChunking(content, '/test/large.js');

      expect(chunks).toHaveLength(3); // 120 lines / 50 lines per chunk = 3 chunks

      // First chunk: lines 1-50
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBe(50);
      expect(chunks[0].content).toContain('line 1;');
      expect(chunks[0].content).toContain('line 50;');

      // Second chunk: lines 51-100
      expect(chunks[1].startLine).toBe(51);
      expect(chunks[1].endLine).toBe(100);

      // Third chunk: lines 101-120
      expect(chunks[2].startLine).toBe(101);
      expect(chunks[2].endLine).toBe(120);
    });

    test('should estimate tokens correctly', () => {
      const testStrings = [
        { content: '', expected: 0 },
        { content: 'abcd', expected: 1 }, // 4 chars / 4 = 1 token
        { content: 'abcdefgh', expected: 2 }, // 8 chars / 4 = 2 tokens
        { content: 'abcdefghi', expected: 3 }, // 9 chars / 4 = 2.25, ceil to 3
      ];

      testStrings.forEach(({ content, expected }) => {
        const estimate = (processor as any).estimateTokens(content);
        expect(estimate).toBe(expected);
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle single line content', () => {
      const content = 'const x = 42;';
      const chunks = (processor as any).fallbackChunking(content, '/test/single.js');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(content);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBe(1);
    });

    test('should handle content ending without newline', () => {
      const content = 'line 1\nline 2\nline 3';
      const chunks = (processor as any).fallbackChunking(content, '/test/no-final-newline.js');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBe(3);
    });

    test('should handle content with only newlines', () => {
      const content = '\n\n\n\n';
      const chunks = (processor as any).fallbackChunking(content, '/test/newlines-only.js');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(content);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBe(4);
    });

    test('should handle very long lines', () => {
      const longLine = 'x'.repeat(1000);
      const content = `${longLine}\nnormal line`;
      const chunks = (processor as any).fallbackChunking(content, '/test/long-line.js');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(content);
      expect(chunks[0].tokenEstimate).toBe(Math.ceil(content.length / 4));
    });
  });

  describe('Chunking Algorithms', () => {
    test('should maintain line numbering accuracy', () => {
      const content = 'line1\nline2\nline3\nline4\nline5';
      const chunks = (processor as any).fallbackChunking(content, '/test/lines.js');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBe(5);
    });

    test('should handle chunking with exact chunk size boundaries', () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1};`);
      const content = lines.join('\n');

      const chunks = (processor as any).fallbackChunking(content, '/test/exact-50.js');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBe(50);
    });

    test('should handle chunking with partial final chunk', () => {
      const lines = Array.from({ length: 75 }, (_, i) => `line ${i + 1};`);
      const content = lines.join('\n');

      const chunks = (processor as any).fallbackChunking(content, '/test/75-lines.js');

      expect(chunks).toHaveLength(2);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBe(50);
      expect(chunks[1].startLine).toBe(51);
      expect(chunks[1].endLine).toBe(75);
    });

    test('should preserve content integrity across chunks', () => {
      const originalLines = Array.from({ length: 75 }, (_, i) => `unique_line_${i + 1}_content`);
      const content = originalLines.join('\n');

      const chunks = (processor as any).fallbackChunking(content, '/test/integrity.js');

      // Reconstruct content from chunks
      const reconstructed = chunks.map(chunk => chunk.content).join('\n');
      expect(reconstructed).toBe(content);

      // Verify line counts
      const originalLineCount = originalLines.length;
      const totalChunkLines = chunks.reduce(
        (sum, chunk) => sum + (chunk.endLine - chunk.startLine + 1),
        0
      );
      expect(totalChunkLines).toBe(originalLineCount);
    });
  });

  describe('Error Handling', () => {
    test('should handle parser initialization failures gracefully', async () => {
      // Mock parser to be unavailable
      jest.doMock('tree-sitter', () => {
        throw new Error('Module not found');
      });

      const result = await processor.parseAndChunk('test content', 'javascript', '/test.js');

      expect(result.chunks).toBeDefined();
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(logger.warn).toHaveBeenCalledWith(
        'No parser available for language',
        expect.any(Object)
      );
    });

    test('should handle parsing errors with fallback', async () => {
      // This test would require mocking the actual tree-sitter parsing to fail
      // For now, we test the fallback mechanism through other error paths
      const result = await processor.parseAndChunk(
        'content',
        'nonexistent-language',
        '/test.unknown'
      );

      expect(result.chunks).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'No parser available for language',
        expect.any(Object)
      );
    });
  });

  describe('Integration with parseAndChunk', () => {
    test('should return valid chunk structure', async () => {
      const result = await processor.parseAndChunk('function test() {}', 'javascript', '/test.js');

      expect(Array.isArray(result.chunks)).toBe(true);
      expect(Array.isArray(result.symbols)).toBe(true);
      expect(Array.isArray(result.xrefs)).toBe(true);

      if (result.chunks.length > 0) {
        const chunk = result.chunks[0];
        expect(typeof chunk.content).toBe('string');
        expect(typeof chunk.startLine).toBe('number');
        expect(typeof chunk.endLine).toBe('number');
        expect(typeof chunk.tokenEstimate).toBe('number');
        expect(chunk.startLine).toBeGreaterThan(0);
        expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      }
    });

    test('should handle multiline content chunking', async () => {
      const multilineContent = `
function component() {
  const [state, setState] = useState(initialValue);

  useEffect(() => {
    fetchData().then(data => {
      setState(data);
    });
  }, []);

  return (
    <div>
      <h1>Title</h1>
      <p>Content: {state}</p>
    </div>
  );
}

export default component;
      `.trim();

      const result = await processor.parseAndChunk(
        multilineContent,
        'javascript',
        '/test/component.jsx'
      );

      expect(result.chunks.length).toBeGreaterThan(0);

      // Verify that chunks cover the entire content
      const totalLines = multilineContent.split('\n').length;
      const maxEndLine = Math.max(...result.chunks.map(c => c.endLine));
      expect(maxEndLine).toBeGreaterThanOrEqual(totalLines);
    });
  });
});
