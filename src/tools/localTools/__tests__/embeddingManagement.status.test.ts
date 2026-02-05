jest.mock('../../../local/embeddingStorage', () => ({
  LocalEmbeddingStorage: jest.fn(),
}));

jest.mock('../../utils/pathUtils', () => ({
  validateAndResolvePath: jest.fn(),
}));

jest.mock('../../../local/projectIdentifier', () => ({
  ProjectIdentifier: {
    getInstance: jest.fn(),
  },
}));

describe('getEmbeddingStatus', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('returns success=false when embedding storage is unavailable', async () => {
    const { LocalEmbeddingStorage } = await import('../../../local/embeddingStorage');
    const { validateAndResolvePath } = await import('../../utils/pathUtils');
    const { ProjectIdentifier } = await import('../../../local/projectIdentifier');

    (validateAndResolvePath as jest.Mock).mockReturnValue('/project');
    (ProjectIdentifier.getInstance as jest.Mock).mockReturnValue({
      identifyProject: jest.fn().mockResolvedValue({
        id: 'proj_123',
        workspaceRoot: '/project',
      }),
    });

    (LocalEmbeddingStorage as unknown as jest.Mock).mockImplementation(() => ({
      initializeDatabase: jest.fn().mockRejectedValue(new Error('bindings missing')),
    }));

    const { getEmbeddingStatus } = await import('../embeddingManagement');

    await expect(getEmbeddingStatus({ projectPath: '/project' })).resolves.toEqual(
      expect.objectContaining({
        success: false,
        projectId: 'proj_123',
        projectPath: '/project',
        error: expect.stringContaining('Embedding storage unavailable'),
        recommendations: expect.any(Array),
      })
    );
  });
});
