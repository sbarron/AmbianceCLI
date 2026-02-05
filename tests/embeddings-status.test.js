jest.mock('../src/local/embeddingStorage', () => ({
  LocalEmbeddingStorage: jest.fn(),
}));

jest.mock('../src/runtime/utils/pathUtils', () => ({
  validateAndResolvePath: jest.fn(),
}));

jest.mock('../src/local/projectIdentifier', () => ({
  ProjectIdentifier: {
    getInstance: jest.fn(),
  },
}));

describe('embeddings status', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('does not throw when embedding storage initialization fails', async () => {
    const { LocalEmbeddingStorage } = require('../src/local/embeddingStorage');
    const { validateAndResolvePath } = require('../src/runtime/utils/pathUtils');
    const { ProjectIdentifier } = require('../src/local/projectIdentifier');

    validateAndResolvePath.mockReturnValue('/project');
    ProjectIdentifier.getInstance.mockReturnValue({
      identifyProject: jest.fn().mockResolvedValue({
        id: 'proj_123',
        workspaceRoot: '/project',
      }),
    });

    LocalEmbeddingStorage.mockImplementation(() => ({
      initializeDatabase: jest.fn().mockRejectedValue(new Error('bindings missing')),
    }));

    const { getEmbeddingStatus } = require('../src/tools/localTools/embeddingManagement');

    await expect(getEmbeddingStatus({ projectPath: '/project' })).resolves.toEqual(
      expect.objectContaining({
        success: false,
        projectId: 'proj_123',
        projectPath: '/project',
        error: expect.stringContaining('Embedding storage unavailable'),
      })
    );
  });
});
