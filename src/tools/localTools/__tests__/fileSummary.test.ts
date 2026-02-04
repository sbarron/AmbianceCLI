/**
 * @fileOverview: Unit tests for file summary tool (with mocks)
 * @module: fileSummaryUnitTests
 * @description: Tests with mocked dependencies for isolated testing
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as path from 'path';
import { getComprehensiveASTAnalysis, getLanguageFromPath } from '../fileSummary';
import { handleAstGrep } from '../astGrep';
import type { AstGrepResult, AstGrepMatch } from '../astGrep';
import type { ParsedFile } from '../../../core/compactor/astParser';
import { tmpdir } from 'os';
import { ASTParser } from '../../../core/compactor/astParser';
import { execSync } from 'child_process';

// Mock dependencies for unit tests
jest.mock('../astGrep');
jest.mock('../../../core/compactor/astParser');
jest.mock('child_process');

const mockHandleAstGrep = handleAstGrep as jest.MockedFunction<typeof handleAstGrep>;
const mockASTParser = ASTParser as jest.MockedClass<typeof ASTParser>;
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('File Summary Tool (Unit Tests)', () => {
  const testFilePath = path.join(tmpdir(), 'test-file.ts');
  const testProjectPath = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    mockASTParser.prototype.dispose = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ... existing tests (if any) ...

  describe('getComprehensiveASTAnalysis Multi-Lang Fallback', () => {
    const mockParsedFile: Partial<ParsedFile> = {
      symbols: [],
      imports: [],
      exports: [],
      errors: [],
      absPath: '/mock/path.py',
      language: 'python',
    };

    beforeEach(() => {
      mockASTParser.prototype.parseFile.mockResolvedValue(mockParsedFile as ParsedFile);
    });

    it('should use ast-grep fallback for Python and extract symbols', async () => {
      const filePath = path.join(tmpdir(), 'test.py');

      // Mock execSync responses for functions and classes patterns
      mockExecSync
        .mockReturnValueOnce(
          JSON.stringify({
            range: { start: { line: 1 }, end: { line: 1 } },
            text: 'def my_func(param):',
            lines: 'def my_func(param):',
          }) + '\n'
        )
        .mockReturnValueOnce(
          JSON.stringify({
            range: { start: { line: 5 }, end: { line: 5 } },
            text: 'class MyClass():',
            lines: 'class MyClass():',
          }) + '\n'
        )
        .mockReturnValueOnce(''); // methods (none)

      const result = await getComprehensiveASTAnalysis(filePath);

      expect(mockASTParser.prototype.parseFile).toHaveBeenCalled();
      expect(mockExecSync).toHaveBeenCalled(); // execSync is now used instead of handleAstGrep
      expect(result.allFunctions).toHaveLength(1);
      expect(result.allFunctions[0].name).toBe('my_func');
      expect(result.allFunctions[0].signature).toContain('def my_func(param):');
      expect(result.allFunctions[0].type).toBe('function');
      expect(result.allClasses).toHaveLength(1);
      expect(result.allClasses[0].name).toBe('MyClass');
      expect(result.allClasses[0].signature).toContain('class MyClass():');
      expect(result.totalSymbols).toBe(2);
    });

    it('should NOT use ast-grep fallback for TypeScript (uses existing parser)', async () => {
      const filePath = path.join(tmpdir(), 'test.ts');
      const mockTSFile: Partial<ParsedFile> = {
        symbols: [
          {
            name: 'TSFunc',
            type: 'function',
            signature: 'function TSFunc()',
            startLine: 1,
            endLine: 1,
            isExported: false,
          },
        ],
        imports: [],
        exports: [],
        errors: [],
        absPath: filePath,
        language: 'typescript',
      };

      mockASTParser.prototype.parseFile.mockResolvedValue(mockTSFile as ParsedFile);

      const result = await getComprehensiveASTAnalysis(filePath);

      // TypeScript should NOT use execSync fallback since it has 1 symbol
      expect(result.totalSymbols).toBe(1);
      expect(result.allFunctions).toHaveLength(1);
      expect(result.allFunctions[0].name).toBe('TSFunc');
    });

    it('should fallback gracefully if ast-grep fails (0 symbols)', async () => {
      const filePath = path.join(tmpdir(), 'test.go');
      mockExecSync.mockImplementation(() => {
        throw new Error('Ast-grep error');
      });

      const result = await getComprehensiveASTAnalysis(filePath);

      expect(result.totalSymbols).toBe(0);
      expect(result.allFunctions).toHaveLength(0);
      expect(result.allClasses).toHaveLength(0);
      // Logs would show fallback attempt + error, but no crash
    });

    it('should extract methods as functions with isMethod: true for Java', async () => {
      const filePath = path.join(tmpdir(), 'test.java');

      // Mock execSync to return method match for the 'public ' pattern
      mockExecSync.mockImplementation((cmd: any) => {
        const command = typeof cmd === 'string' ? cmd : '';
        // Check if this is a method pattern call (public pattern for Java)
        if (command.includes('public ') && command.includes('java')) {
          return (
            JSON.stringify({
              range: { start: { line: 9 }, end: { line: 9 } },
              text: 'public String sayHello() {',
              lines: 'public String sayHello() {',
            }) + '\n'
          );
        }
        // Return empty for other patterns (functions, classes)
        return '';
      });

      const result = await getComprehensiveASTAnalysis(filePath);

      expect(result.allFunctions).toHaveLength(1);
      expect(result.allFunctions[0].type).toBe('method');
      expect(result.allFunctions[0].name).toBe('sayHello');
      expect(result.allFunctions[0].isMethod).toBe(true);
      expect(result.totalSymbols).toBe(1);
    });
  });

  describe('getLanguageFromPath Updates', () => {
    it('should return grep code for supported langs', () => {
      expect(getLanguageFromPath('test.py')).toEqual({ lang: 'python', grep: 'py' });
      expect(getLanguageFromPath('test.go')).toEqual({ lang: 'go', grep: 'go' });
      expect(getLanguageFromPath('test.rs')).toEqual({ lang: 'rust', grep: 'rs' });
      expect(getLanguageFromPath('test.java')).toEqual({ lang: 'java', grep: 'java' });
      expect(getLanguageFromPath('test.json')).toEqual({ lang: 'json' }); // No grep
      expect(getLanguageFromPath('unknown.txt')).toEqual({ lang: 'unknown' });
    });
  });

  // ... rest of existing tests ...
});
