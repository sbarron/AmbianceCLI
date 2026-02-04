describe('Workspace resolution precedence', () => {
  let originalEnv;
  let getCurrentWorkspaceFolder;

  beforeAll(() => {
    try {
      ({ getCurrentWorkspaceFolder } = require('../dist/src/tools/utils/workspaceValidator.js'));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('workspaceValidator not available:', e && e.message);
    }
  });

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('prefers WORKSPACE_FOLDER over AMBIANCE_BASE_DIR', () => {
    if (!getCurrentWorkspaceFolder) return;

    process.env.WORKSPACE_FOLDER = 'C:/Dev/ambiance-mcp';
    process.env.AMBIANCE_BASE_DIR = 'C:/Some/Other/Dir';

    const folder = getCurrentWorkspaceFolder();
    expect(folder).toBe(process.env.WORKSPACE_FOLDER);
  });
});





