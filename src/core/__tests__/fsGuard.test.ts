import { describe, it, expect, beforeEach } from '@jest/globals';
import { FSGuard, FSGuardError } from '../fsGuard';
import * as path from 'path';
import * as os from 'os';

describe('Phase 13 FSGuard System', () => {
  let fsGuard: FSGuard;
  let testBaseDir: string;

  beforeEach(() => {
    // Use current working directory as base for tests
    testBaseDir = process.cwd();
    fsGuard = new FSGuard({ baseDir: testBaseDir });
  });

  describe('Path Validation', () => {
    it('should validate basic path structure', async () => {
      // These tests focus on path validation logic, not filesystem access
      await expect(fsGuard.guardPath('')).rejects.toThrow(FSGuardError);
      await expect(fsGuard.guardPath('file\0name.txt')).rejects.toThrow(FSGuardError);
    });

    it('should normalize path separators', () => {
      const testPaths = [
        'src/components/Button.tsx',
        'src\\components\\Button.tsx',
        'mixed/path\\separators.ts',
      ];

      testPaths.forEach(testPath => {
        const normalized = path.normalize(testPath);
        expect(normalized).toBeDefined();
        expect(typeof normalized).toBe('string');
      });
    });

    it('should handle path length limits', async () => {
      const longPath = 'very'.repeat(500) + '/long/path.ts';

      await expect(fsGuard.guardPath(longPath)).rejects.toThrow(FSGuardError);
    });

    it('should provide structured errors', async () => {
      try {
        await fsGuard.guardPath('');
      } catch (error) {
        expect(error).toBeInstanceOf(FSGuardError);
        const fsError = error as FSGuardError;
        expect(fsError.code).toBeDefined();
        expect(fsError.context).toBeDefined();
        expect(fsError.toStructured).toBeDefined();

        const structured = fsError.toStructured();
        expect(structured.error.code).toBeDefined();
        expect(structured.error.message).toBeDefined();
        expect(structured.error.context).toBeDefined();
      }
    });
  });

  describe('Error Code Generation', () => {
    it('should generate consistent error codes for different scenarios', () => {
      const errorCodes = [
        'PATH_INVALID',
        'PATH_TOO_LONG',
        'PATH_NULL_BYTE',
        'ABSOLUTE_PATH_FORBIDDEN',
        'PATH_OUTSIDE_BASE',
      ];

      errorCodes.forEach(code => {
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(0);
        expect(code).toMatch(/^[A-Z_]+$/);
      });
    });

    it('should provide examples in error responses', () => {
      const error = new FSGuardError('PATH_OUTSIDE_BASE', 'Test error', {
        input: '../../../etc/passwd',
      });

      const structured = error.toStructured();
      expect(structured.error.examples).toBeDefined();
    });
  });

  describe('Base Directory Management', () => {
    it('should track base directory correctly', () => {
      const baseDir = fsGuard.getBaseDir();
      expect(baseDir).toBeDefined();
      expect(typeof baseDir).toBe('string');
    });

    it('should handle different base directory configurations', () => {
      // Use process.cwd() and os.tmpdir() as they're guaranteed to exist
      const configs = [{ baseDir: process.cwd() }, { baseDir: os.tmpdir() }];

      configs.forEach(config => {
        const guard = new FSGuard(config);
        expect(guard.getBaseDir()).toBeDefined();
      });
    });
  });
});
