import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock dependencies
jest.mock('fs');
jest.mock('fs/promises');

const mockFs = fs as jest.Mocked<typeof fs>;

// Import the functions we want to test
// Since these are likely internal to projectIdentifier, we'll test them through that module
import { loadIgnorePatterns, shouldIgnoreFile, parseIgnoreFile } from '../projectIdentifier';

describe('Ignore Pattern Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock: files don't exist
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('');
  });

  describe('loadIgnorePatterns', () => {
    it('should load patterns from .gitignore', async () => {
      mockFs.existsSync.mockImplementation((filePath: any) => {
        return filePath.toString().includes('.gitignore');
      });

      (mockFs.readFileSync as any).mockImplementation((filePath: any, options?: any) => {
        if (filePath.toString().includes('.gitignore')) {
          return `
# Comments should be ignored
node_modules/
*.log
dist/

# Blank lines should be ignored

.env
.env.local
          `.trim();
        }
        return '';
      });

      const patterns = await loadIgnorePatterns('/test/project');

      expect(patterns).toContain('node_modules/');
      expect(patterns).toContain('*.log');
      expect(patterns).toContain('dist/');
      expect(patterns).toContain('.env');
      expect(patterns).toContain('.env.local');

      // Comments and blank lines should not be included
      expect(patterns).not.toContain('# Comments should be ignored');
      expect(patterns).not.toContain('');
    });

    it('should load patterns from .cursorignore', async () => {
      mockFs.existsSync.mockImplementation((filePath: any) => {
        return filePath.toString().includes('.cursorignore');
      });

      (mockFs.readFileSync as any).mockImplementation((filePath: any, options?: any) => {
        if (filePath.toString().includes('.cursorignore')) {
          return `
.cursor/
*.cursor-*
cursor-logs/
          `.trim();
        }
        return '';
      });

      const patterns = await loadIgnorePatterns('/test/project');

      expect(patterns).toContain('.cursor/');
      expect(patterns).toContain('*.cursor-*');
      expect(patterns).toContain('cursor-logs/');
    });

    it('should load patterns from .vscodeignore', async () => {
      mockFs.existsSync.mockImplementation((filePath: any) => {
        return filePath.toString().includes('.vscodeignore');
      });

      (mockFs.readFileSync as any).mockImplementation((filePath: any, options?: any) => {
        if (filePath.toString().includes('.vscodeignore')) {
          return `
.vscode/settings.json
.vscode/launch.json
*.code-workspace
          `.trim();
        }
        return '';
      });

      const patterns = await loadIgnorePatterns('/test/project');

      expect(patterns).toContain('.vscode/settings.json');
      expect(patterns).toContain('.vscode/launch.json');
      expect(patterns).toContain('*.code-workspace');
    });

    it('should load patterns from .ambianceignore', async () => {
      mockFs.existsSync.mockImplementation((filePath: any) => {
        return filePath.toString().includes('.ambianceignore');
      });

      (mockFs.readFileSync as any).mockImplementation((filePath: any, options?: any) => {
        if (filePath.toString().includes('.ambianceignore')) {
          return `
# Ambiance-specific ignores
coverage/
*.tmp
*.swp
docs/_build/
          `.trim();
        }
        return '';
      });

      const patterns = await loadIgnorePatterns('/test/project');

      expect(patterns).toContain('coverage/');
      expect(patterns).toContain('*.tmp');
      expect(patterns).toContain('*.swp');
      expect(patterns).toContain('docs/_build/');
    });

    it('should combine patterns from multiple ignore files', async () => {
      mockFs.existsSync.mockReturnValue(true);

      (mockFs.readFileSync as any).mockImplementation((filePath: any, options?: any) => {
        if (filePath.toString().includes('.gitignore')) {
          return 'node_modules/\n.env'.trim();
        }
        if (filePath.toString().includes('.cursorignore')) {
          return '.cursor/\n*.cursor-*'.trim();
        }
        if (filePath.toString().includes('.ambianceignore')) {
          return 'coverage/\n*.tmp'.trim();
        }
        return '';
      });

      const patterns = await loadIgnorePatterns('/test/project');

      // Should contain patterns from all files
      expect(patterns).toContain('node_modules/');
      expect(patterns).toContain('.env');
      expect(patterns).toContain('.cursor/');
      expect(patterns).toContain('*.cursor-*');
      expect(patterns).toContain('coverage/');
      expect(patterns).toContain('*.tmp');
    });

    it('should include default ignore patterns', async () => {
      // No ignore files exist
      mockFs.existsSync.mockReturnValue(false);

      const patterns = await loadIgnorePatterns('/test/project');

      // Should include built-in defaults
      expect(patterns).toContain('node_modules/**');
      expect(patterns).toContain('.git/**');
      expect(patterns).toContain('dist/**');
      expect(patterns).toContain('build/**');
      expect(patterns).toContain('*.log');
      expect(patterns).toContain('.DS_Store');
      expect(patterns).toContain('Thumbs.db');
    });

    it('should handle file read errors gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const patterns = await loadIgnorePatterns('/test/project');

      // Should still return default patterns even if files can't be read
      expect(patterns).toContain('node_modules/**');
      expect(patterns.length).toBeGreaterThan(0);
    });
  });

  describe('parseIgnoreFile', () => {
    it('should parse ignore file content correctly', () => {
      const content = `
# This is a comment
node_modules/
*.log

# Another comment
dist/
build/

# Empty lines above should be ignored
.env
.env.local
      `;

      const patterns = parseIgnoreFile(content);

      expect(patterns).toEqual(['node_modules/', '*.log', 'dist/', 'build/', '.env', '.env.local']);
    });

    it('should handle Windows line endings', () => {
      const content = 'node_modules/\r\n*.log\r\ndist/\r\n';

      const patterns = parseIgnoreFile(content);

      expect(patterns).toEqual(['node_modules/', '*.log', 'dist/']);
    });

    it('should trim whitespace from patterns', () => {
      const content = '  node_modules/  \n  *.log  \n  dist/  ';

      const patterns = parseIgnoreFile(content);

      expect(patterns).toEqual(['node_modules/', '*.log', 'dist/']);
    });

    it('should handle empty content', () => {
      const patterns = parseIgnoreFile('');

      expect(patterns).toEqual([]);
    });

    it('should ignore lines starting with #', () => {
      const content = `
# This is a comment
node_modules/
# Another comment
*.log
      `;

      const patterns = parseIgnoreFile(content);

      expect(patterns).toEqual(['node_modules/', '*.log']);
    });
  });

  describe('shouldIgnoreFile', () => {
    it('should match simple patterns', () => {
      const patterns = ['*.log', 'node_modules/', 'dist/'];

      expect(shouldIgnoreFile('app.log', patterns)).toBe(true);
      expect(shouldIgnoreFile('error.log', patterns)).toBe(true);
      expect(shouldIgnoreFile('node_modules/', patterns)).toBe(true);
      expect(shouldIgnoreFile('dist/', patterns)).toBe(true);

      expect(shouldIgnoreFile('app.js', patterns)).toBe(false);
      expect(shouldIgnoreFile('src/index.ts', patterns)).toBe(false);
    });

    it('should match wildcard patterns', () => {
      const patterns = ['*.min.js', '*.map', 'test*.tmp'];

      expect(shouldIgnoreFile('bundle.min.js', patterns)).toBe(true);
      expect(shouldIgnoreFile('app.js.map', patterns)).toBe(true);
      expect(shouldIgnoreFile('test123.tmp', patterns)).toBe(true);

      expect(shouldIgnoreFile('bundle.js', patterns)).toBe(false);
      expect(shouldIgnoreFile('app.js', patterns)).toBe(false);
    });

    it('should match directory patterns', () => {
      const patterns = ['node_modules/**', 'dist/**', '.git/**'];

      expect(shouldIgnoreFile('node_modules/express/index.js', patterns)).toBe(true);
      expect(shouldIgnoreFile('dist/bundle.js', patterns)).toBe(true);
      expect(shouldIgnoreFile('.git/config', patterns)).toBe(true);

      expect(shouldIgnoreFile('src/index.js', patterns)).toBe(false);
      expect(shouldIgnoreFile('README.md', patterns)).toBe(false);
    });

    it('should handle relative paths correctly', () => {
      const patterns = ['src/test/**', 'docs/*.md'];

      expect(shouldIgnoreFile('src/test/unit.test.ts', patterns)).toBe(true);
      expect(shouldIgnoreFile('docs/readme.md', patterns)).toBe(true);

      expect(shouldIgnoreFile('src/index.ts', patterns)).toBe(false);
      expect(shouldIgnoreFile('test/unit.test.ts', patterns)).toBe(false);
    });

    it('should be case-sensitive by default', () => {
      const patterns = ['*.LOG', 'Node_Modules/'];

      expect(shouldIgnoreFile('app.LOG', patterns)).toBe(true);
      expect(shouldIgnoreFile('Node_Modules/', patterns)).toBe(true);

      expect(shouldIgnoreFile('app.log', patterns)).toBe(false);
      expect(shouldIgnoreFile('node_modules/', patterns)).toBe(false);
    });

    it('should handle negation patterns', () => {
      const patterns = ['*.log', '!important.log'];

      expect(shouldIgnoreFile('app.log', patterns)).toBe(true);
      expect(shouldIgnoreFile('error.log', patterns)).toBe(true);

      // Negation pattern should override ignore
      expect(shouldIgnoreFile('important.log', patterns)).toBe(false);
    });

    it('should handle complex glob patterns', () => {
      const patterns = ['src/**/*.{test,spec}.{js,ts}', '**/node_modules/**', '**/*.min.{js,css}'];

      expect(shouldIgnoreFile('src/utils/helper.test.js', patterns)).toBe(true);
      expect(shouldIgnoreFile('src/components/Button.spec.ts', patterns)).toBe(true);
      expect(shouldIgnoreFile('packages/core/node_modules/express/index.js', patterns)).toBe(true);
      expect(shouldIgnoreFile('dist/app.min.js', patterns)).toBe(true);
      expect(shouldIgnoreFile('dist/styles.min.css', patterns)).toBe(true);

      expect(shouldIgnoreFile('src/utils/helper.js', patterns)).toBe(false);
      expect(shouldIgnoreFile('dist/app.js', patterns)).toBe(false);
    });

    it('should handle empty patterns array', () => {
      const patterns: string[] = [];

      expect(shouldIgnoreFile('any-file.js', patterns)).toBe(false);
      expect(shouldIgnoreFile('node_modules/package.json', patterns)).toBe(false);
    });
  });

  describe('Pattern Priority and Ordering', () => {
    it('should respect pattern order for negation', () => {
      // Later patterns should override earlier ones
      const patterns1 = ['*.log', '!important.log'];
      const patterns2 = ['!important.log', '*.log'];

      // In patterns1, negation comes after ignore, so important.log should NOT be ignored
      expect(shouldIgnoreFile('important.log', patterns1)).toBe(false);

      // In patterns2, ignore comes after negation, so important.log SHOULD be ignored
      expect(shouldIgnoreFile('important.log', patterns2)).toBe(true);
    });

    it('should handle multiple negations', () => {
      const patterns = ['*.tmp', '!important.tmp', 'very-important.tmp', '!critical.tmp'];

      expect(shouldIgnoreFile('temp.tmp', patterns)).toBe(true);
      expect(shouldIgnoreFile('important.tmp', patterns)).toBe(false);
      expect(shouldIgnoreFile('very-important.tmp', patterns)).toBe(true); // Specific match overrides negation
      expect(shouldIgnoreFile('critical.tmp', patterns)).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should handle large numbers of patterns efficiently', () => {
      // Generate many patterns
      const patterns = [];
      for (let i = 0; i < 1000; i++) {
        patterns.push(`pattern${i}/**`);
        patterns.push(`*.ext${i}`);
      }

      const startTime = Date.now();

      // Test multiple files
      for (let i = 0; i < 100; i++) {
        shouldIgnoreFile(`test${i}.js`, patterns);
        shouldIgnoreFile(`pattern${i}/file.txt`, patterns);
      }

      const endTime = Date.now();

      // Should complete in reasonable time (less than 10 seconds for pattern matching)
      expect(endTime - startTime).toBeLessThan(10000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle files with special characters', () => {
      // Use exact string matching for files with special characters
      const patterns = ['file\\[special\\].js', 'test\\(temp\\).txt'];

      expect(shouldIgnoreFile('file[special].js', patterns)).toBe(true);
      expect(shouldIgnoreFile('test(temp).txt', patterns)).toBe(true);
    });

    it('should handle unicode file names', () => {
      const patterns = ['*.测试', 'файл*'];

      expect(shouldIgnoreFile('test.测试', patterns)).toBe(true);
      expect(shouldIgnoreFile('файл123', patterns)).toBe(true);
    });

    it('should handle very long file paths', () => {
      const longPath = 'very/'.repeat(100) + 'deep/file.js';
      const patterns = ['**/file.js'];

      expect(shouldIgnoreFile(longPath, patterns)).toBe(true);
    });

    it('should handle malformed patterns gracefully', () => {
      const patterns = ['[unclosed', '**/[', '**/*[a-'];

      // Should not throw errors, even with malformed patterns
      expect(() => shouldIgnoreFile('test.js', patterns)).not.toThrow();
    });
  });
});
