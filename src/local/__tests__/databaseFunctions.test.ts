import { jest } from '@jest/globals';

// Mock Supabase client with proper typing
const mockSupabaseClient = {
  rpc: jest.fn() as jest.MockedFunction<any>,
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  auth: {
    getUser: jest.fn() as jest.MockedFunction<any>,
  },
};

// Mock database functions for testing
interface DatabaseFunctions {
  upsertLocalProject(
    userId: string,
    name: string,
    localPath: string,
    workspaceRoot?: string
  ): Promise<string>;
  startIndexingSession(repoId: string, sessionType?: string, metadata?: object): Promise<string>;
  updateIndexingProgress(
    sessionId: string,
    progress: {
      filesProcessed?: number;
      chunksCreated?: number;
      symbolsExtracted?: number;
      embeddingsGenerated?: number;
      errors?: string[];
      status?: string;
    }
  ): Promise<boolean>;
  upsertLocalFile(
    repoId: string,
    filePath: string,
    hash: string,
    lastModified: Date,
    fileSize?: number,
    language?: string
  ): Promise<string>;
  getChangedFiles(
    repoId: string,
    since?: Date
  ): Promise<
    Array<{
      path: string;
      hash: string;
      lastModified: Date;
      fileSize: number;
      language: string;
    }>
  >;
  deleteProjectIndexes(repoId: string): Promise<boolean>;
}

class MockDatabaseFunctions implements DatabaseFunctions {
  private supabase = mockSupabaseClient;

  async upsertLocalProject(
    userId: string,
    name: string,
    localPath: string,
    workspaceRoot?: string
  ): Promise<string> {
    const result = await this.supabase.rpc('upsert_local_project', {
      p_user_id: userId,
      p_name: name,
      p_local_path: localPath,
      p_workspace_root: workspaceRoot,
    });
    return result.data;
  }

  async startIndexingSession(
    repoId: string,
    sessionType: string = 'initial',
    metadata: object = {}
  ): Promise<string> {
    const result = await this.supabase.rpc('start_indexing_session', {
      p_repo_id: repoId,
      p_session_type: sessionType,
      p_metadata: metadata,
    });
    return result.data;
  }

  async updateIndexingProgress(
    sessionId: string,
    progress: {
      filesProcessed?: number;
      chunksCreated?: number;
      symbolsExtracted?: number;
      embeddingsGenerated?: number;
      errors?: string[];
      status?: string;
    }
  ): Promise<boolean> {
    const result = await this.supabase.rpc('update_indexing_progress', {
      p_session_id: sessionId,
      p_files_processed: progress.filesProcessed,
      p_chunks_created: progress.chunksCreated,
      p_symbols_extracted: progress.symbolsExtracted,
      p_embeddings_generated: progress.embeddingsGenerated,
      p_errors: progress.errors,
      p_status: progress.status,
    });
    return result.data;
  }

  async upsertLocalFile(
    repoId: string,
    filePath: string,
    hash: string,
    lastModified: Date,
    fileSize?: number,
    language?: string
  ): Promise<string> {
    const result = await this.supabase.rpc('upsert_local_file', {
      p_repo_id: repoId,
      p_path: filePath,
      p_hash: hash,
      p_last_modified: lastModified.toISOString(),
      p_file_size: fileSize,
      p_language: language,
    });
    return result.data;
  }

  async getChangedFiles(
    repoId: string,
    since?: Date
  ): Promise<
    Array<{
      path: string;
      hash: string;
      lastModified: Date;
      fileSize: number;
      language: string;
    }>
  > {
    const result = await this.supabase.rpc('get_changed_files', {
      p_repo_id: repoId,
      p_since: since?.toISOString(),
    });
    return result.data || [];
  }

  async deleteProjectIndexes(repoId: string): Promise<boolean> {
    const result = await this.supabase.rpc('delete_project_indexes', {
      p_repo_id: repoId,
    });
    return result.data;
  }
}

describe('Database Functions', () => {
  let dbFunctions: MockDatabaseFunctions;
  const mockUserId = '550e8400-e29b-41d4-a716-446655440000';
  const mockRepoId = '550e8400-e29b-41d4-a716-446655440001';
  const mockSessionId = '550e8400-e29b-41d4-a716-446655440002';
  const mockFileId = '550e8400-e29b-41d4-a716-446655440003';

  beforeEach(() => {
    jest.clearAllMocks();
    dbFunctions = new MockDatabaseFunctions();
  });

  describe('upsertLocalProject', () => {
    it('should create a new local project successfully', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockRepoId,
        error: null,
      });

      const result = await dbFunctions.upsertLocalProject(
        mockUserId,
        'test-project',
        '/path/to/project',
        '/path/to/workspace'
      );

      expect(result).toBe(mockRepoId);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('upsert_local_project', {
        p_user_id: mockUserId,
        p_name: 'test-project',
        p_local_path: '/path/to/project',
        p_workspace_root: '/path/to/workspace',
      });
    });

    it('should update existing project', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockRepoId,
        error: null,
      });

      const result = await dbFunctions.upsertLocalProject(
        mockUserId,
        'existing-project',
        '/new/path/to/project'
      );

      expect(result).toBe(mockRepoId);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('upsert_local_project', {
        p_user_id: mockUserId,
        p_name: 'existing-project',
        p_local_path: '/new/path/to/project',
        p_workspace_root: undefined,
      });
    });

    it('should handle database errors', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Unauthorized' },
      });

      await expect(
        dbFunctions.upsertLocalProject('unauthorized-user', 'test-project', '/path/to/project')
      ).resolves.toBeNull();
    });

    it('should use workspace root as default when not provided', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockRepoId,
        error: null,
      });

      await dbFunctions.upsertLocalProject(mockUserId, 'test-project', '/path/to/project');

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('upsert_local_project', {
        p_user_id: mockUserId,
        p_name: 'test-project',
        p_local_path: '/path/to/project',
        p_workspace_root: undefined,
      });
    });
  });

  describe('startIndexingSession', () => {
    it('should start a new indexing session', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockSessionId,
        error: null,
      });

      const metadata = { version: '1.0', force: true };
      const result = await dbFunctions.startIndexingSession(mockRepoId, 'initial', metadata);

      expect(result).toBe(mockSessionId);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('start_indexing_session', {
        p_repo_id: mockRepoId,
        p_session_type: 'initial',
        p_metadata: metadata,
      });
    });

    it('should use default session type when not provided', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockSessionId,
        error: null,
      });

      await dbFunctions.startIndexingSession(mockRepoId);

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('start_indexing_session', {
        p_repo_id: mockRepoId,
        p_session_type: 'initial',
        p_metadata: {},
      });
    });

    it('should handle unauthorized access', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Unauthorized' },
      });

      await expect(dbFunctions.startIndexingSession('unauthorized-repo-id')).resolves.toBeNull();
    });

    it('should handle different session types', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockSessionId,
        error: null,
      });

      const sessionTypes = ['initial', 'incremental', 'force'];

      for (const sessionType of sessionTypes) {
        await dbFunctions.startIndexingSession(mockRepoId, sessionType);

        expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('start_indexing_session', {
          p_repo_id: mockRepoId,
          p_session_type: sessionType,
          p_metadata: {},
        });
      }
    });
  });

  describe('updateIndexingProgress', () => {
    it('should update progress with all fields', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: true,
        error: null,
      });

      const progress = {
        filesProcessed: 10,
        chunksCreated: 50,
        symbolsExtracted: 25,
        embeddingsGenerated: 40,
        errors: ['Parse error in file.ts'],
        status: 'running',
      };

      const result = await dbFunctions.updateIndexingProgress(mockSessionId, progress);

      expect(result).toBe(true);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_indexing_progress', {
        p_session_id: mockSessionId,
        p_files_processed: 10,
        p_chunks_created: 50,
        p_symbols_extracted: 25,
        p_embeddings_generated: 40,
        p_errors: ['Parse error in file.ts'],
        p_status: 'running',
      });
    });

    it('should update progress with partial fields', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: true,
        error: null,
      });

      const progress = {
        filesProcessed: 5,
        status: 'completed',
      };

      const result = await dbFunctions.updateIndexingProgress(mockSessionId, progress);

      expect(result).toBe(true);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_indexing_progress', {
        p_session_id: mockSessionId,
        p_files_processed: 5,
        p_chunks_created: undefined,
        p_symbols_extracted: undefined,
        p_embeddings_generated: undefined,
        p_errors: undefined,
        p_status: 'completed',
      });
    });

    it('should handle session not found', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: false,
        error: null,
      });

      const result = await dbFunctions.updateIndexingProgress('non-existent-session', {
        status: 'completed',
      });

      expect(result).toBe(false);
    });

    it('should handle multiple errors in array', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: true,
        error: null,
      });

      const progress = {
        errors: ['Error 1', 'Error 2', 'Error 3'],
        status: 'failed',
      };

      await dbFunctions.updateIndexingProgress(mockSessionId, progress);

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_indexing_progress', {
        p_session_id: mockSessionId,
        p_files_processed: undefined,
        p_chunks_created: undefined,
        p_symbols_extracted: undefined,
        p_embeddings_generated: undefined,
        p_errors: ['Error 1', 'Error 2', 'Error 3'],
        p_status: 'failed',
      });
    });
  });

  describe('upsertLocalFile', () => {
    it('should create a new file record', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockFileId,
        error: null,
      });

      const lastModified = new Date('2024-01-15T10:00:00Z');
      const result = await dbFunctions.upsertLocalFile(
        mockRepoId,
        'src/index.ts',
        'abc123hash',
        lastModified,
        1024,
        'typescript'
      );

      expect(result).toBe(mockFileId);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('upsert_local_file', {
        p_repo_id: mockRepoId,
        p_path: 'src/index.ts',
        p_hash: 'abc123hash',
        p_last_modified: '2024-01-15T10:00:00.000Z',
        p_file_size: 1024,
        p_language: 'typescript',
      });
    });

    it('should update existing file record', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockFileId,
        error: null,
      });

      const lastModified = new Date('2024-01-15T11:00:00Z');
      const result = await dbFunctions.upsertLocalFile(
        mockRepoId,
        'src/index.ts',
        'new123hash',
        lastModified
      );

      expect(result).toBe(mockFileId);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('upsert_local_file', {
        p_repo_id: mockRepoId,
        p_path: 'src/index.ts',
        p_hash: 'new123hash',
        p_last_modified: '2024-01-15T11:00:00.000Z',
        p_file_size: undefined,
        p_language: undefined,
      });
    });

    it('should handle file with no size or language', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockFileId,
        error: null,
      });

      const lastModified = new Date();
      await dbFunctions.upsertLocalFile(mockRepoId, 'README.md', 'readme123', lastModified);

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('upsert_local_file', {
        p_repo_id: mockRepoId,
        p_path: 'README.md',
        p_hash: 'readme123',
        p_last_modified: lastModified.toISOString(),
        p_file_size: undefined,
        p_language: undefined,
      });
    });

    it('should handle different file types', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockFileId,
        error: null,
      });

      const files = [
        { path: 'src/app.js', language: 'javascript' },
        { path: 'main.py', language: 'python' },
        { path: 'styles.css', language: 'css' },
        { path: 'config.json', language: 'json' },
      ];

      for (const file of files) {
        await dbFunctions.upsertLocalFile(
          mockRepoId,
          file.path,
          'hash123',
          new Date(),
          1000,
          file.language
        );

        expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
          'upsert_local_file',
          expect.objectContaining({
            p_path: file.path,
            p_language: file.language,
          })
        );
      }
    });
  });

  describe('getChangedFiles', () => {
    it('should get changed files since timestamp', async () => {
      const mockFiles = [
        {
          path: 'src/index.ts',
          hash: 'hash1',
          lastModified: new Date('2024-01-15T10:00:00Z'),
          fileSize: 1024,
          language: 'typescript',
        },
        {
          path: 'src/utils.ts',
          hash: 'hash2',
          lastModified: new Date('2024-01-15T11:00:00Z'),
          fileSize: 512,
          language: 'typescript',
        },
      ];

      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockFiles,
        error: null,
      });

      const since = new Date('2024-01-15T09:00:00Z');
      const result = await dbFunctions.getChangedFiles(mockRepoId, since);

      expect(result).toEqual(mockFiles);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('get_changed_files', {
        p_repo_id: mockRepoId,
        p_since: '2024-01-15T09:00:00.000Z',
      });
    });

    it('should get all files when no timestamp provided', async () => {
      const mockFiles = [
        {
          path: 'src/index.ts',
          hash: 'hash1',
          lastModified: new Date(),
          fileSize: 1024,
          language: 'typescript',
        },
      ];

      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockFiles,
        error: null,
      });

      const result = await dbFunctions.getChangedFiles(mockRepoId);

      expect(result).toEqual(mockFiles);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('get_changed_files', {
        p_repo_id: mockRepoId,
        p_since: undefined,
      });
    });

    it('should return empty array when no files found', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await dbFunctions.getChangedFiles(mockRepoId);

      expect(result).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await dbFunctions.getChangedFiles(mockRepoId);

      expect(result).toEqual([]);
    });
  });

  describe('deleteProjectIndexes', () => {
    it('should delete all project indexes successfully', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: true,
        error: null,
      });

      const result = await dbFunctions.deleteProjectIndexes(mockRepoId);

      expect(result).toBe(true);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('delete_project_indexes', {
        p_repo_id: mockRepoId,
      });
    });

    it('should handle unauthorized deletion', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Unauthorized' },
      });

      await expect(dbFunctions.deleteProjectIndexes('unauthorized-repo')).resolves.toBeNull();
    });

    it('should handle non-existent project', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: false,
        error: null,
      });

      const result = await dbFunctions.deleteProjectIndexes('non-existent-repo');

      expect(result).toBe(false);
    });

    it('should handle database errors during deletion', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Foreign key constraint violation' },
      });

      await expect(dbFunctions.deleteProjectIndexes(mockRepoId)).resolves.toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      mockSupabaseClient.rpc.mockRejectedValue(new Error('Network error'));

      await expect(
        dbFunctions.upsertLocalProject(mockUserId, 'test-project', '/path')
      ).rejects.toThrow('Network error');
    });

    it('should handle timeout errors', async () => {
      mockSupabaseClient.rpc.mockRejectedValue(new Error('Request timeout'));

      await expect(dbFunctions.startIndexingSession(mockRepoId)).rejects.toThrow('Request timeout');
    });

    it('should handle malformed responses', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        // Missing data and error properties
      });

      const result = await dbFunctions.upsertLocalProject(mockUserId, 'test-project', '/path');

      expect(result).toBeUndefined();
    });
  });

  describe('Data Validation', () => {
    it('should handle special characters in paths', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockFileId,
        error: null,
      });

      const specialPath = 'src/files with spaces/special-chars-!@#$%^&*().ts';
      await dbFunctions.upsertLocalFile(mockRepoId, specialPath, 'hash123', new Date());

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'upsert_local_file',
        expect.objectContaining({
          p_path: specialPath,
        })
      );
    });

    it('should handle very long file paths', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockFileId,
        error: null,
      });

      const longPath = 'very/'.repeat(50) + 'deep/file.ts';
      await dbFunctions.upsertLocalFile(mockRepoId, longPath, 'hash123', new Date());

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'upsert_local_file',
        expect.objectContaining({
          p_path: longPath,
        })
      );
    });

    it('should handle large file sizes', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockFileId,
        error: null,
      });

      const largeFileSize = 1024 * 1024 * 100; // 100MB
      await dbFunctions.upsertLocalFile(
        mockRepoId,
        'large-file.bin',
        'hash123',
        new Date(),
        largeFileSize
      );

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'upsert_local_file',
        expect.objectContaining({
          p_file_size: largeFileSize,
        })
      );
    });

    it('should handle empty metadata objects', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockSessionId,
        error: null,
      });

      await dbFunctions.startIndexingSession(mockRepoId, 'initial', {});

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'start_indexing_session',
        expect.objectContaining({
          p_metadata: {},
        })
      );
    });

    it('should handle complex metadata objects', async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: mockSessionId,
        error: null,
      });

      const complexMetadata = {
        version: '1.0',
        options: {
          force: true,
          skipPatterns: ['*.log', 'node_modules/**'],
        },
        stats: {
          filesFound: 100,
          startTime: new Date().toISOString(),
        },
      };

      await dbFunctions.startIndexingSession(mockRepoId, 'force', complexMetadata);

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'start_indexing_session',
        expect.objectContaining({
          p_metadata: complexMetadata,
        })
      );
    });
  });
});
