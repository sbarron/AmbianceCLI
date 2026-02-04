import { jest } from '@jest/globals';
import {
  ambianceTools,
  ambianceHandlers,
  handleAutoDetectIndex,
  handleIndexProject,
  handleResetIndexes,
  handleStartWatching,
  handleStopWatching,
  handleGetIndexingStatus,
} from '../ambianceTools';
import { AutomaticIndexer } from '../../local/automaticIndexer';

// Mock dependencies
jest.mock('../../local/automaticIndexer');
jest.mock('../../utils/logger');
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
  Statement: jest.fn(),
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe('Indexing Tools Integration', () => {
  let mockIndexer: jest.Mocked<AutomaticIndexer>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock indexer instance
    mockIndexer = {
      autoDetectAndIndex: jest.fn(),
      indexProject: jest.fn(),
      resetProjectIndexes: jest.fn(),
      startWatching: jest.fn(),
      stopWatching: jest.fn(),
      getSession: jest.fn(),
      getActiveSessions: jest.fn(),
    } as any;

    // Mock AutomaticIndexer.getInstance
    (
      AutomaticIndexer.getInstance as jest.MockedFunction<typeof AutomaticIndexer.getInstance>
    ).mockReturnValue(mockIndexer);
  });

  describe('Tool Definitions', () => {
    it('should export correct number of tools', () => {
      const indexingTools = ambianceTools.filter(
        tool =>
          tool.name.includes('auto_detect_index') ||
          tool.name.includes('index_project') ||
          tool.name.includes('reset_indexes') ||
          tool.name.includes('watching') ||
          tool.name.includes('indexing_status')
      );
      expect(indexingTools).toHaveLength(6);
    });

    it('should have all required tool properties', () => {
      const indexingTools = ambianceTools.filter(
        tool =>
          tool.name.includes('auto_detect_index') ||
          tool.name.includes('index_project') ||
          tool.name.includes('reset_indexes') ||
          tool.name.includes('watching') ||
          tool.name.includes('indexing_status')
      );
      indexingTools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
      });
    });

    it('should have correct tool names', () => {
      const expectedNames = [
        'ambiance_auto_detect_index',
        'ambiance_index_project',
        'ambiance_reset_indexes',
        'ambiance_start_watching',
        'ambiance_stop_watching',
        'ambiance_get_indexing_status',
      ];

      const actualNames = ambianceTools
        .filter(
          tool =>
            tool.name.includes('auto_detect_index') ||
            tool.name.includes('index_project') ||
            tool.name.includes('reset_indexes') ||
            tool.name.includes('watching') ||
            tool.name.includes('indexing_status')
        )
        .map(tool => tool.name);
      expect(actualNames).toEqual(expectedNames);
    });
  });

  describe('Tool Handler Mappings', () => {
    it('should have handlers for all tools', () => {
      const indexingToolNames = ambianceTools
        .filter(
          tool =>
            tool.name.includes('auto_detect_index') ||
            tool.name.includes('index_project') ||
            tool.name.includes('reset_indexes') ||
            tool.name.includes('watching') ||
            tool.name.includes('indexing_status')
        )
        .map(tool => tool.name);
      const indexingHandlerNames = Object.keys(ambianceHandlers).filter(
        name =>
          name.includes('auto_detect_index') ||
          name.includes('index_project') ||
          name.includes('reset_indexes') ||
          name.includes('watching') ||
          name.includes('indexing_status')
      );

      indexingToolNames.forEach(name => {
        expect(indexingHandlerNames).toContain(name);
      });
    });
  });

  describe('handleAutoDetectIndex', () => {
    it('should handle successful auto-detection', async () => {
      const mockSession = {
        id: 'session-123',
        projectId: 'project-123',
        status: 'processing' as const,
        filesFound: 10,
        filesProcessed: 0,
        chunksCreated: 0,
        symbolsExtracted: 0,
        embeddings: 0,
        startTime: new Date(),
        errors: [],
      };

      mockIndexer.autoDetectAndIndex.mockResolvedValue(mockSession);

      const result = await handleAutoDetectIndex();

      expect(result).toEqual({
        success: true,
        message: 'Started automatic indexing',
        session: {
          id: mockSession.id,
          projectId: mockSession.projectId,
          status: mockSession.status,
          filesFound: mockSession.filesFound,
          startTime: mockSession.startTime,
        },
      });

      expect(mockIndexer.autoDetectAndIndex).toHaveBeenCalledTimes(1);
    });

    it('should handle no project detected', async () => {
      mockIndexer.autoDetectAndIndex.mockResolvedValue(null);

      const result = await handleAutoDetectIndex();

      expect(result).toEqual({
        success: false,
        message: 'No project detected or no API key configured',
        suggestion: 'Make sure you have a valid API key and are in a project directory',
      });
    });

    it('should handle auto-detection errors', async () => {
      const error = new Error('Detection failed');
      mockIndexer.autoDetectAndIndex.mockRejectedValue(error);

      await expect(handleAutoDetectIndex()).rejects.toThrow('Detection failed');
    });
  });

  describe('handleIndexProject', () => {
    it('should handle project indexing with all options', async () => {
      const mockSession = {
        id: 'session-456',
        projectId: 'project-456',
        status: 'processing' as const,

        filesFound: 25,
        filesProcessed: 0,
        chunksCreated: 0,
        symbolsExtracted: 0,
        embeddings: 0,
        startTime: new Date(),
        errors: [],
      };

      mockIndexer.indexProject.mockResolvedValue(mockSession);

      const args = {
        path: '/custom/project',
        force: true,
        skipCloud: false,
        pattern: '*.ts',
      };

      const result = await handleIndexProject(args);

      expect(result).toEqual({
        success: true,
        message: 'Project indexing started successfully',
        session: expect.objectContaining({
          id: mockSession.id,
          projectId: mockSession.projectId,
          status: mockSession.status,
          filesFound: mockSession.filesFound,
          filesProcessed: mockSession.filesProcessed,
          chunksCreated: mockSession.chunksCreated,
          symbolsExtracted: mockSession.symbolsExtracted,
          errors: mockSession.errors,
          startTime: mockSession.startTime,
        }),
      });

      expect(mockIndexer.indexProject).toHaveBeenCalledWith('/custom/project', {
        force: true,
        skipCloud: false,
        pattern: '*.ts',
      });
    });

    it('should use default path when not provided', async () => {
      const mockSession = {
        id: 'session-default',
        projectId: 'project-default',
        status: 'processing' as const,

        filesFound: 15,
        filesProcessed: 0,
        chunksCreated: 0,
        symbolsExtracted: 0,
        embeddings: 0,
        startTime: new Date(),
        errors: [],
      };

      mockIndexer.indexProject.mockResolvedValue(mockSession);

      const result = await handleIndexProject({ path: process.cwd() });

      expect(mockIndexer.indexProject).toHaveBeenCalledWith(process.cwd(), {
        force: undefined,
        skipCloud: undefined,
        pattern: undefined,
      });
    });

    it('should handle indexing errors', async () => {
      const error = new Error('Indexing failed');
      mockIndexer.indexProject.mockRejectedValue(error);

      const result = await handleIndexProject({ path: '/test/project' });

      expect(result).toEqual({
        success: false,
        error: 'Indexing failed',
        suggestion: 'Check the project path exists and you have necessary permissions',
      });
    });
  });

  describe('handleResetIndexes', () => {
    it('should handle successful reset', async () => {
      mockIndexer.resetProjectIndexes.mockResolvedValue(true);

      const result = await handleResetIndexes({ path: '/test/project' });

      expect(result).toEqual({
        success: true,
        message: 'Project indexes reset successfully',
        details: 'All local and cloud indexes have been deleted for this project',
      });

      expect(mockIndexer.resetProjectIndexes).toHaveBeenCalledWith('/test/project');
    });

    it('should use current directory as default', async () => {
      mockIndexer.resetProjectIndexes.mockResolvedValue(true);

      const result = await handleResetIndexes({ path: process.cwd() });

      expect(mockIndexer.resetProjectIndexes).toHaveBeenCalledWith(process.cwd());
    });

    it('should handle reset failure', async () => {
      mockIndexer.resetProjectIndexes.mockRejectedValue(new Error('Reset failed'));

      const result = await handleResetIndexes({ path: '/test/project' });

      expect(result).toEqual({
        success: false,
        error: 'Reset failed',
        suggestion: 'Ensure you have necessary permissions and the project exists',
      });
    });

    it('should handle reset errors', async () => {
      const error = new Error('Reset error');
      mockIndexer.resetProjectIndexes.mockRejectedValue(error);

      const result = await handleResetIndexes({ path: '/test/project' });

      expect(result).toEqual({
        success: false,
        error: 'Reset error',
        suggestion: 'Ensure you have necessary permissions and the project exists',
      });
    });
  });

  describe('handleStartWatching', () => {
    it('should handle successful watch start', async () => {
      mockIndexer.startWatching.mockResolvedValue(undefined);

      const result = await handleStartWatching({ path: '/test/project' });

      expect(result).toEqual({
        success: true,
        message: 'File watching started successfully',
        details: 'Project will be automatically re-indexed when files change',
      });

      expect(mockIndexer.startWatching).toHaveBeenCalledWith('/test/project');
    });

    it('should use current directory as default', async () => {
      mockIndexer.startWatching.mockResolvedValue(undefined);

      const result = await handleStartWatching({ path: process.cwd() });

      expect(mockIndexer.startWatching).toHaveBeenCalledWith(process.cwd());
    });

    it('should handle watch start errors', async () => {
      const error = new Error('Watch failed');
      mockIndexer.startWatching.mockRejectedValue(error);

      const result = await handleStartWatching({ path: '/test/project' });

      expect(result).toEqual({
        success: false,
        error: 'Watch failed',
        suggestion: 'Check the project path exists and you have read permissions',
      });
    });
  });

  describe('handleStopWatching', () => {
    it('should handle successful watch stop', async () => {
      mockIndexer.stopWatching.mockResolvedValue(undefined);

      const result = await handleStopWatching({ path: '/test/project' });

      expect(result).toEqual({
        success: true,
        message: 'File watching stopped successfully',
      });

      expect(mockIndexer.stopWatching).toHaveBeenCalledWith('/test/project');
    });

    it('should use current directory as default', async () => {
      mockIndexer.stopWatching.mockResolvedValue(undefined);

      const result = await handleStopWatching({ path: process.cwd() });

      expect(mockIndexer.stopWatching).toHaveBeenCalledWith(process.cwd());
    });

    it('should handle watch stop errors', async () => {
      const error = new Error('Stop failed');
      mockIndexer.stopWatching.mockRejectedValue(error);

      const result = await handleStopWatching({ path: '/test/project' });

      expect(result).toEqual({
        success: false,
        error: 'Stop failed',
      });
    });
  });

  describe('handleGetIndexingStatus', () => {
    it('should return specific session status', async () => {
      const mockSession = {
        id: 'session-123',
        projectId: 'project-123',
        status: 'completed' as const,
        filesFound: 20,
        filesProcessed: 20,
        chunksCreated: 150,
        symbolsExtracted: 75,
        embeddings: 150,
        startTime: new Date('2024-01-01T10:00:00Z'),
        errors: [],
      };

      mockIndexer.getSession.mockReturnValue(mockSession);

      const result = await handleGetIndexingStatus({ sessionId: 'session-123' });

      expect(result).toEqual({
        success: true,
        session: {
          id: mockSession.id,
          projectId: mockSession.projectId,
          status: mockSession.status,
          filesFound: mockSession.filesFound,
          filesProcessed: mockSession.filesProcessed,
          chunksCreated: mockSession.chunksCreated,
          symbolsExtracted: mockSession.symbolsExtracted,
          embeddings: mockSession.embeddings,
          errors: mockSession.errors,
          startTime: mockSession.startTime,
          progress: 100,
        },
      });

      expect(mockIndexer.getSession).toHaveBeenCalledWith('session-123');
    });

    it('should return all sessions when no sessionId provided', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          projectId: 'project-1',
          status: 'completed' as const,
          filesFound: 10,
          filesProcessed: 10,
          chunksCreated: 50,
          symbolsExtracted: 25,
          embeddings: 50,
          startTime: new Date(),
          errors: [],
        },
        {
          id: 'session-2',
          projectId: 'project-2',
          status: 'processing' as const,
          filesFound: 15,
          filesProcessed: 8,
          chunksCreated: 40,
          symbolsExtracted: 20,
          embeddings: 40,
          startTime: new Date(),
          errors: [],
        },
      ];

      mockIndexer.getActiveSessions.mockReturnValue(mockSessions);

      const result = await handleGetIndexingStatus({});

      expect(result).toEqual({
        success: true,
        message: 'Found 2 active indexing sessions',
        sessions: [
          {
            id: mockSessions[0].id,
            projectId: mockSessions[0].projectId,
            status: mockSessions[0].status,
            filesFound: mockSessions[0].filesFound,
            filesProcessed: mockSessions[0].filesProcessed,
            progress: 100,
            startTime: mockSessions[0].startTime,
            errors: 0,
          },
          {
            id: mockSessions[1].id,
            projectId: mockSessions[1].projectId,
            status: mockSessions[1].status,
            filesFound: mockSessions[1].filesFound,
            filesProcessed: mockSessions[1].filesProcessed,
            progress: Math.round(
              (mockSessions[1].filesProcessed / mockSessions[1].filesFound) * 100
            ),
            startTime: mockSessions[1].startTime,
            errors: 0,
          },
        ],
      });

      expect(mockIndexer.getActiveSessions).toHaveBeenCalledTimes(1);
    });

    it('should handle session not found', async () => {
      mockIndexer.getSession.mockReturnValue(undefined);

      const result = await handleGetIndexingStatus({ sessionId: 'non-existent' });

      expect(result).toEqual({
        success: false,
        error: 'Session not found',
        sessionId: 'non-existent',
      });
    });

    it('should handle empty sessions list', async () => {
      mockIndexer.getActiveSessions.mockReturnValue([]);

      const result = await handleGetIndexingStatus({});

      expect(result).toEqual({
        success: true,
        message: 'Found 0 active indexing sessions',
        sessions: [],
      });
    });

    it('should handle status errors', async () => {
      const error = new Error('Status failed');
      mockIndexer.getSession.mockImplementation(() => {
        throw error;
      });

      const result = await handleGetIndexingStatus({ sessionId: 'session-123' });

      expect(result).toEqual({
        success: false,
        error: 'Status failed',
      });
    });
  });

  describe('Input Validation', () => {
    it('should validate indexProject path parameter', async () => {
      // Test with invalid path type
      const invalidArgs = { path: 123 } as any;

      await expect(handleIndexProject(invalidArgs)).rejects.toBeTruthy();
    });

    it('should validate boolean parameters', async () => {
      const mockSession = {
        id: 'test',
        projectId: 'project-test',
        status: 'processing' as const,
        filesFound: 0,
        filesProcessed: 0,
        chunksCreated: 0,
        symbolsExtracted: 0,
        embeddings: 0,
        startTime: new Date(),
        errors: [],
      };

      mockIndexer.indexProject.mockResolvedValue(mockSession);

      // Test with string instead of boolean
      const invalidArgs = { force: 'true', skipCloud: 'false' } as any;

      await expect(handleIndexProject(invalidArgs as any)).rejects.toBeTruthy();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent indexing requests', async () => {
      const mockSession1 = {
        id: 'session-1',
        projectId: 'project-1',
        status: 'processing' as const,
        filesFound: 10,
        filesProcessed: 0,
        chunksCreated: 0,
        symbolsExtracted: 0,
        embeddings: 0,
        startTime: new Date(),
        errors: [],
      };

      const mockSession2 = {
        id: 'session-2',
        projectId: 'project-2',
        status: 'processing' as const,
        filesFound: 15,
        filesProcessed: 0,
        chunksCreated: 0,
        symbolsExtracted: 0,
        embeddings: 0,
        startTime: new Date(),
        errors: [],
      };

      mockIndexer.indexProject
        .mockResolvedValueOnce(mockSession1)
        .mockResolvedValueOnce(mockSession2);

      const [result1, result2] = await Promise.all([
        handleIndexProject({ path: '/project1' }),
        handleIndexProject({ path: '/project2' }),
      ]);

      expect(result1.session.id).toBe('session-1');
      expect(result2.session.id).toBe('session-2');
      expect(mockIndexer.indexProject).toHaveBeenCalledTimes(2);
    });
  });
});
