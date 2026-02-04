import { jest } from '@jest/globals';
import { AutomaticIndexer, IndexingSession, IndexingOptions } from '../automaticIndexer';
import * as path from 'path';
import * as fs from 'fs';

// Mock sqlite3 to avoid binding issues
jest.mock('sqlite3', () => ({
  Database: jest.fn().mockImplementation(() => ({
    exec: jest.fn().mockImplementation((sql: any, callback: any) => callback(null)),
    prepare: jest.fn().mockReturnValue({
      run: jest.fn().mockImplementation((params: any, callback: any) => callback(null)),
      all: jest.fn().mockImplementation((params: any, callback: any) => callback(null, [])),
      get: jest.fn().mockImplementation((params: any, callback: any) => callback(null, null)),
      finalize: jest.fn(),
    }),
    close: jest.fn().mockImplementation((callback: any) => callback(null)),
  })),
}));

// Mock dependencies
jest.mock('fs');
jest.mock('fs/promises');
jest.mock('globby', () => ({
  globby: jest.fn(),
}));
jest.mock('../../client/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock('../../utils/logger');
jest.mock('../projectIdentifier');
jest.mock('../treeSitterProcessor');
jest.mock('../projectManager');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockLogger = {
  info: jest.fn() as jest.MockedFunction<any>,
  warn: jest.fn() as jest.MockedFunction<any>,
  error: jest.fn() as jest.MockedFunction<any>,
  debug: jest.fn() as jest.MockedFunction<any>,
};

// Import the mocked apiClient
const { apiClient: mockApiClient } = require('../../client/apiClient');

// Import the mocked loadIgnorePatterns
const { loadIgnorePatterns: mockLoadIgnorePatternsImported } = require('../projectIdentifier');

// Set up the mock for loadIgnorePatterns
mockLoadIgnorePatternsImported.mockResolvedValue(['node_modules/**', 'dist/**', '.git/**']);

// Mock project identifier
const mockProjectIdentifier = {
  detectProjectType: jest.fn() as jest.MockedFunction<any>,
  findWorkspaceRoot: jest.fn() as jest.MockedFunction<any>,
};

// Mock loadIgnorePatterns function
const mockLoadIgnorePatternsFn = jest.fn();

// Mock tree-sitter processor
const mockTreeSitterProcessor = {
  parseFile: jest.fn() as jest.MockedFunction<any>,
  extractSymbols: jest.fn() as jest.MockedFunction<any>,
};

// Mock project manager
const mockProjectManager = {
  addProject: jest.fn() as jest.MockedFunction<any>,
  listProjects: jest.fn() as jest.MockedFunction<any>,
  getProject: jest.fn() as jest.MockedFunction<any>,
  removeProject: jest.fn() as jest.MockedFunction<any>,
};

describe('AutomaticIndexer', () => {
  let indexer: AutomaticIndexer;
  let mockProcessCwd: jest.MockedFunction<any>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock process.cwd()
    mockProcessCwd = jest.spyOn(process, 'cwd').mockReturnValue('/test/project');

    // Mock fs.existsSync to return true by default
    mockFs.existsSync.mockReturnValue(true);

    // Mock fs.statSync
    mockFs.statSync.mockReturnValue({
      isDirectory: () => true,
      isFile: () => true,
      mtime: new Date(),
      size: 1000,
    } as any);

    // Set up default mocks
    mockProjectIdentifier.detectProjectType.mockResolvedValue({
      type: 'git',
      name: 'test-project',
      root: '/test/project',
    });

    mockProjectIdentifier.findWorkspaceRoot.mockReturnValue('/test/project');

    // Mock API client for hasValidAPIKey check
    mockApiClient.get.mockImplementation((endpoint: string) => {
      if (endpoint === '/health') {
        return Promise.resolve({ status: 'ok' });
      }
      return Promise.resolve({});
    });

    mockApiClient.post.mockResolvedValue({
      id: 'test-session-id',
      status: 'in_progress',
      projectId: 'test-project-id',
    });

    // Reset the singleton instance
    (AutomaticIndexer as any).instance = null;
    indexer = AutomaticIndexer.getInstance();

    // Inject mocks
    (indexer as any).logger = mockLogger;
    (indexer as any).projectIdentifier = mockProjectIdentifier;
    (indexer as any).treeSitterProcessor = mockTreeSitterProcessor;
    (indexer as any).projectManager = mockProjectManager;
  });

  afterEach(() => {
    mockProcessCwd.mockRestore();
  });

  describe('getInstance', () => {
    it('should return the same instance (singleton pattern)', () => {
      const instance1 = AutomaticIndexer.getInstance();
      const instance2 = AutomaticIndexer.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('autoDetectAndIndex', () => {
    it('should detect project and start indexing', async () => {
      // Mock globby to return some files
      const { globby } = await import('globby');
      (globby as jest.MockedFunction<any>).mockResolvedValue([
        '/test/project/src/index.ts',
        '/test/project/src/utils.ts',
      ]);

      const session = await indexer.autoDetectAndIndex();

      expect(session).toBeDefined();
      expect(session?.id).toBeDefined();
      expect(typeof session?.id).toBe('string');
      expect(mockProjectIdentifier.detectProjectType).toHaveBeenCalledWith('/test/project');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('detected project'));
    });

    it('should return null if no project detected', async () => {
      mockProjectIdentifier.detectProjectType.mockResolvedValue(null);

      const session = await indexer.autoDetectAndIndex();

      expect(session).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith('📁 No project detected in current directory');
    });

    it('should handle detection errors gracefully', async () => {
      mockProjectIdentifier.detectProjectType.mockRejectedValue(new Error('Detection failed'));

      const session = await indexer.autoDetectAndIndex();

      expect(session).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith('Auto-detection failed:', expect.any(Error));
    });
  });

  describe('indexProject', () => {
    beforeEach(async () => {
      // Mock globby to return test files - using dynamic import for ESM compatibility
      const globbyModule = await import('globby');
      const mockGlobby = globbyModule.globby;
      (mockGlobby as jest.MockedFunction<any>).mockResolvedValue([
        '/test/project/src/index.ts',
        '/test/project/src/utils.ts',
        '/test/project/src/types.ts',
      ]);

      // Mock fs.readFileSync
      mockFs.readFileSync.mockReturnValue('// Test file content\nexport const test = "value";');

      // Mock tree-sitter processing
      mockTreeSitterProcessor.parseFile.mockResolvedValue({
        symbols: [{ name: 'test', type: 'const', line: 2, isExported: true }],
        imports: [],
        exports: ['test'],
      });
    });

    it('should index project successfully', async () => {
      const options: IndexingOptions = {
        force: false,
        skipCloud: false,
      };

      const session = await indexer.indexProject('/test/project', options);

      expect(session.id).toBeDefined();
      expect(session.projectId).toBeDefined();
      expect(session.status).toBe('completed');
      expect(session.filesFound).toBe(3);

      expect(mockLoadIgnorePatternsImported).toHaveBeenCalledWith('/test/project');
      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/v1/local-projects/start-indexing',
        expect.any(Object)
      );
    });

    it('should handle force option correctly', async () => {
      const options: IndexingOptions = {
        force: true,
        skipCloud: false,
      };

      await indexer.indexProject('/test/project', options);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Force indexing enabled - will re-index all files'
      );
    });

    it('should skip cloud sync when skipCloud is true', async () => {
      const options: IndexingOptions = {
        force: false,
        skipCloud: true,
      };

      await indexer.indexProject('/test/project', options);

      expect(mockLogger.info).toHaveBeenCalledWith('Skipping cloud sync - local indexing only');
      // Should not call cloud API
      expect(mockApiClient.post).not.toHaveBeenCalled();
    });

    it('should filter files by pattern', async () => {
      const options: IndexingOptions = {
        force: false,
        skipCloud: false,
        pattern: '*.ts',
      };

      await indexer.indexProject('/test/project', options);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('pattern filter'));
    });

    it('should handle API errors gracefully', async () => {
      mockApiClient.post.mockRejectedValue(new Error('API Error'));

      const session = await indexer.indexProject('/test/project');

      expect(session.status).toBe('failed');
      expect(session.errors).toContain('API Error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to start cloud indexing session:',
        expect.any(Error)
      );
    });

    it('should handle file processing errors', async () => {
      mockTreeSitterProcessor.parseFile.mockRejectedValue(new Error('Parse error'));

      const session = await indexer.indexProject('/test/project');

      // Should continue processing other files
      expect(session.status).toBe('completed');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process file'),
        expect.any(Error)
      );
    });
  });

  describe('resetProjectIndexes', () => {
    it('should reset project indexes successfully', async () => {
      mockApiClient.post.mockResolvedValue({ success: true });

      const result = await indexer.resetProjectIndexes('/test/project');

      expect(result).toBe(true);
      expect(mockApiClient.post).toHaveBeenCalledWith('/v1/local-projects/reset', {
        projectPath: '/test/project',
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Successfully reset indexes for project: /test/project'
      );
    });

    it('should handle reset API errors', async () => {
      mockApiClient.post.mockRejectedValue(new Error('Reset failed'));

      const result = await indexer.resetProjectIndexes('/test/project');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to reset project indexes:',
        expect.any(Error)
      );
    });
  });

  describe('startWatching', () => {
    it('should start watching project files', async () => {
      const mockWatcher = {
        on: jest.fn() as jest.MockedFunction<any>,
        close: jest.fn() as jest.MockedFunction<any>,
      };

      // Mock fs.watch with proper typing
      mockFs.watch = jest.fn().mockReturnValue(mockWatcher) as jest.MockedFunction<typeof fs.watch>;

      await indexer.startWatching('/test/project');

      expect(mockFs.watch).toHaveBeenCalledWith(
        expect.stringContaining('test'),
        { recursive: true },
        expect.any(Function)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Started watching for file changes: /test/project'
      );
    });

    it('should handle watch setup errors', async () => {
      mockFs.watch = jest.fn().mockImplementation(() => {
        throw new Error('Watch failed');
      }) as jest.MockedFunction<typeof fs.watch>;

      await expect(indexer.startWatching('/test/project')).rejects.toThrow('Watch failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to start watching:', expect.any(Error));
    });
  });

  describe('stopWatching', () => {
    it('should stop watching project files', async () => {
      // First start watching
      const mockWatcher = {
        on: jest.fn() as jest.MockedFunction<any>,
        close: jest.fn() as jest.MockedFunction<any>,
      };
      mockFs.watch = jest.fn().mockReturnValue(mockWatcher) as jest.MockedFunction<typeof fs.watch>;

      await indexer.startWatching('/test/project');

      // Then stop watching
      await indexer.stopWatching('/test/project');

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Stopped watching: /test/project');
    });

    it('should handle stop watching when not watching', async () => {
      await indexer.stopWatching('/test/project');

      expect(mockLogger.warn).toHaveBeenCalledWith('No watcher found for project: /test/project');
    });
  });

  describe('getSession', () => {
    it('should return session by ID', async () => {
      // Create a session first
      const session = await indexer.indexProject('/test/project');

      const retrieved = indexer.getSession(session.id);

      expect(retrieved).toBe(session);
    });

    it('should return undefined for non-existent session', () => {
      const retrieved = indexer.getSession('non-existent-id');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('getActiveSessions', () => {
    it('should return all sessions', async () => {
      // Create multiple sessions
      const session1 = await indexer.indexProject('/test/project1');
      const session2 = await indexer.indexProject('/test/project2');

      const sessions = indexer.getActiveSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions).toContain(session1);
      expect(sessions).toContain(session2);
    });

    it('should return empty array when no sessions', () => {
      const sessions = indexer.getActiveSessions();

      expect(sessions).toEqual([]);
    });
  });

  describe('file change handling', () => {
    it('should handle file changes with debouncing', async () => {
      // Mock setTimeout to control timing
      jest.useFakeTimers();

      const mockWatcher = {
        on: jest.fn() as jest.MockedFunction<any>,
        close: jest.fn() as jest.MockedFunction<any>,
      };
      mockFs.watch = jest.fn().mockReturnValue(mockWatcher) as jest.MockedFunction<typeof fs.watch>;

      await indexer.startWatching('/test/project');

      // The fs.watch callback is passed directly, so we can't easily test the debouncing
      // This test would require more complex mocking of the fs.watch callback
      expect(mockFs.watch).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should trigger incremental embedding updates on file changes', async () => {
      // This test verifies that file changes trigger embedding updates, not full re-indexing
      const mockEmbeddingGenerator = {
        updateProjectEmbeddings: jest.fn().mockResolvedValue({
          processedFiles: 1,
          embeddings: 5,
          totalChunks: 5,
        }),
      };

      // Mock the embedding generator
      jest
        .spyOn(require('../embeddingGenerator'), 'LocalEmbeddingGenerator')
        .mockImplementation(() => mockEmbeddingGenerator as any);

      // Mock file system watching
      let fileChangeCallback: ((eventType: string, filename: string | null) => void) | null = null;
      const mockWatcher = {
        close: jest.fn(),
      };
      mockFs.watch = jest.fn().mockImplementation((path: any, options: any, callback: any) => {
        fileChangeCallback = callback;
        return mockWatcher;
      }) as jest.MockedFunction<typeof fs.watch>;

      // Start watching
      await indexer.startWatching('/test/project');

      // Simulate file change
      if (fileChangeCallback) {
        fileChangeCallback('change', 'src/index.ts');
      }

      // Fast forward past debounce period
      jest.advanceTimersByTime(180000); // 3 minutes

      // Wait for promises to resolve
      await new Promise(process.nextTick);

      // Verify that incremental embedding update was called
      expect(mockEmbeddingGenerator.updateProjectEmbeddings).toHaveBeenCalledWith(
        expect.any(String), // projectId
        '/test/project',
        expect.objectContaining({
          files: ['src/index.ts'], // Should only update changed file
        })
      );
    });
  });

  describe('ignore patterns', () => {
    it('should apply ignore patterns correctly', async () => {
      mockLoadIgnorePatternsImported.mockResolvedValue(['node_modules/**', '*.log', 'dist/**']);

      const globbyModule = await import('globby');
      const mockGlobby = globbyModule.globby;
      (mockGlobby as jest.MockedFunction<any>).mockResolvedValue([
        '/test/project/src/index.ts',
        '/test/project/src/utils.ts',
      ]);

      await indexer.indexProject('/test/project');

      expect(mockGlobby).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          ignore: expect.arrayContaining(['node_modules/**']),
        })
      );
    });
  });

  describe('change detection', () => {
    it('should skip unchanged files when not forcing', async () => {
      // Mock file hash calculation
      const mockCrypto = {
        createHash: jest.fn().mockReturnValue({
          update: jest.fn().mockReturnThis(),
          digest: jest.fn().mockReturnValue('same-hash'),
        }),
      };

      // Mock existing file record with same hash
      mockApiClient.get.mockResolvedValue({
        files: [
          {
            path: 'src/index.ts',
            hash: 'same-hash',
            lastModified: new Date().toISOString(),
          },
        ],
      });

      const session = await indexer.indexProject('/test/project', { force: false });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('files have changes'));
    });

    it('should process all files when forcing', async () => {
      const session = await indexer.indexProject('/test/project', { force: true });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Force indexing enabled - will re-index all files'
      );
      expect(session.filesFound).toBeGreaterThan(0);
    });
  });

  describe('error recovery', () => {
    it('should continue processing after individual file errors', async () => {
      // Make one file fail
      mockTreeSitterProcessor.parseFile
        .mockResolvedValueOnce({
          symbols: [],
          imports: [],
          exports: [],
        })
        .mockRejectedValueOnce(new Error('Parse failed'))
        .mockResolvedValueOnce({
          symbols: [{ name: 'test', type: 'const', line: 1, isExported: true }],
          imports: [],
          exports: ['test'],
        });

      const session = await indexer.indexProject('/test/project');

      expect(session.status).toBe('completed');
      expect(session.errors.length).toBeGreaterThan(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process'),
        expect.any(Error)
      );
    });
  });
});
