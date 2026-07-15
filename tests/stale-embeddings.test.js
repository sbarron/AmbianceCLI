const mockGlobby = jest.fn();
const mockStorage = {
  listProjectFiles: jest.fn(),
  getRecentlyUpdatedFiles: jest.fn(),
};

jest.mock('fs');

jest.mock('../src/runtime/utils/pathUtils', () => ({
  validateAndResolvePath: jest.fn(input => input),
}));

jest.mock('../src/local/projectIdentifier', () => ({
  ProjectIdentifier: {
    getInstance: jest.fn(() => ({
      identifyProject: jest.fn(async () => ({
        id: 'project-1',
        workspaceRoot: 'C:\\project',
      })),
    })),
  },
  loadIgnorePatterns: jest.fn(async () => []),
}));

jest.mock('../src/local/embeddingStorage', () => ({
  LocalEmbeddingStorage: jest.fn(() => mockStorage),
}));

jest.mock('../src/runtime/utils/esmImport', () => ({
  importEsm: jest.fn(async () => ({ globby: mockGlobby })),
}));

describe('embedding stale checks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USE_LOCAL_EMBEDDINGS = 'true';
    mockStorage.getRecentlyUpdatedFiles.mockResolvedValue([
      {
        filePath: 'src/index.ts',
        fileId: 'file-index',
        embeddingCount: 2,
        totalChunks: 2,
      },
    ]);
  });

  test('reports newly discovered indexable files as pending embedding updates', async () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockImplementation(filePath => ({
      size: filePath.includes('new.ts') ? 50 : 100,
      mtime: filePath.includes('index.ts')
        ? new Date('2026-02-01T00:00:00.000Z')
        : new Date('2026-03-01T00:00:00.000Z'),
      isFile: () => true,
      isDirectory: () => false,
    }));

    mockGlobby.mockResolvedValue([
      'src/index.ts',
      'src/new.ts',
      'src/index.test.ts',
      'dist/ignored.ts',
    ]);
    mockStorage.listProjectFiles.mockResolvedValue([
      {
        id: 'file-index',
        projectId: 'project-1',
        path: 'src/index.ts',
        hash: 'hash',
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
        fileSize: 100,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const { checkStaleFiles } = require('../src/runtime/embeddings/manageEmbeddings');

    const result = await checkStaleFiles({
      projectPath: 'C:\\project',
      autoUpdate: false,
    });

    expect(result.staleCount).toBe(1);
    expect(result.newCount).toBe(1);
    expect(result.newFiles[0].filePath.replace(/\\/g, '/')).toBe('src/new.ts');
    expect(result.newFiles.map(file => file.filePath.replace(/\\/g, '/'))).not.toContain(
      'src/index.test.ts'
    );
    expect(result.newFiles.map(file => file.filePath.replace(/\\/g, '/'))).not.toContain(
      'dist/ignored.ts'
    );
  });

  test('reports tracked files with zero chunks as incomplete', async () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({
      size: 100,
      mtime: new Date('2026-01-01T00:00:00.000Z'),
      isFile: () => true,
      isDirectory: () => false,
    });
    mockGlobby.mockResolvedValue(['src/index.ts']);
    mockStorage.listProjectFiles.mockResolvedValue([
      {
        id: 'file-index',
        projectId: 'project-1',
        path: 'src/index.ts',
        hash: 'hash',
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
        fileSize: 100,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    mockStorage.getRecentlyUpdatedFiles.mockResolvedValue([
      {
        filePath: 'src/index.ts',
        fileId: 'file-index',
        embeddingCount: 0,
        totalChunks: 0,
      },
    ]);

    const { checkStaleFiles } = require('../src/runtime/embeddings/manageEmbeddings');
    const result = await checkStaleFiles({
      projectPath: 'C:\\project',
      autoUpdate: false,
    });

    expect(result.staleCount).toBe(0);
    expect(result.newCount).toBe(0);
    expect(result.incompleteCount).toBe(1);
    expect(result.incompleteFiles[0]).toMatchObject({
      filePath: 'src/index.ts',
      reason: 'Tracked file has zero embedding chunks',
    });
  });
});
