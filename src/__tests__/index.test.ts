/**
 * @fileOverview: Tests for MCP server initialization and API key validation
 * @module: MCP Server Tests
 * @description: Tests for the main AmbianceMCPServer class and API key validation
 */

import { jest } from '@jest/globals';
import { AmbianceMCPServer } from '../index';
import { logger } from '../utils/logger';

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
jest.mock('../utils/logger');
jest.mock('../core/openaiService');
jest.mock('../client/apiClient');
jest.mock('../tools/localTools');
jest.mock('../tools/aiTools');
jest.mock('../tools/cloudTools/index');
jest.mock('../tools/index');
jest.mock('@xenova/transformers');

describe('AmbianceMCPServer', () => {
  let server: AmbianceMCPServer;
  let mockLogger: jest.Mocked<typeof logger>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = logger as jest.Mocked<typeof logger>;

    // Store original environment
    originalEnv = { ...process.env };

    // Reset singleton instance between tests
    AmbianceMCPServer.dispose();

    // Mock the imported modules to prevent actual initialization
    jest.doMock('../tools/localTools', () => ({
      localTools: [],
      localHandlers: {},
      logPathConfiguration: jest.fn(),
    }));

    jest.doMock('../tools/aiTools', () => ({
      openaiCompatibleTools: [],
      openaiCompatibleHandlers: {},
    }));

    jest.doMock('../tools/cloudTools/index', () => ({
      cloudToolDefinitions: [],
      cloudToolHandlers: {},
    }));

    jest.doMock('../tools/index', () => ({
      getAvailableTools: jest.fn(),
    }));
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('API Key Validation', () => {
    test('should initialize with no API keys', () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.AMBIANCE_API_KEY;

      server = new AmbianceMCPServer();

      expect(mockLogger.info).toHaveBeenCalledWith(
        '🔍 Environment key presence',
        expect.objectContaining({
          OPENAI_API_KEY: 'unset',
          AMBIANCE_API_KEY: 'unset',
        })
      );

      // Note: The "No valid API keys" message is logged during initializeAsync, not constructor
      expect(mockLogger.info).toHaveBeenCalledWith('🔧 Tool handlers registered successfully');
    });

    test('should detect OpenAI API key presence', () => {
      process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
      delete process.env.AMBIANCE_API_KEY;

      server = new AmbianceMCPServer();

      expect(mockLogger.info).toHaveBeenCalledWith(
        '🔍 Environment key presence',
        expect.objectContaining({
          OPENAI_API_KEY: 'set',
          AMBIANCE_API_KEY: 'unset',
        })
      );
    });

    test('should detect Ambiance API key presence', () => {
      delete process.env.OPENAI_API_KEY;
      process.env.AMBIANCE_API_KEY = process.env.AMBIANCE_API_KEY || 'test-ambiance-key';

      server = new AmbianceMCPServer();

      expect(mockLogger.info).toHaveBeenCalledWith(
        '🔍 Environment key presence',
        expect.objectContaining({
          OPENAI_API_KEY: 'unset',
          AMBIANCE_API_KEY: 'set',
        })
      );
    });

    test('should detect both API keys', () => {
      process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
      process.env.AMBIANCE_API_KEY = process.env.AMBIANCE_API_KEY || 'test-ambiance-key';

      server = new AmbianceMCPServer();

      expect(mockLogger.info).toHaveBeenCalledWith(
        '🔍 Environment key presence',
        expect.objectContaining({
          OPENAI_API_KEY: 'set',
          AMBIANCE_API_KEY: 'set',
        })
      );
    });
  });

  describe('initializeAsync', () => {
    test('should validate API keys and update tools', async () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.AMBIANCE_API_KEY;
      delete process.env.USE_LOCAL_EMBEDDINGS;

      // Create a new server instance for this test
      const testServer = new AmbianceMCPServer();

      // Mock the validateApiKeys method
      const mockValidateKeys = jest.spyOn(testServer as any, 'validateApiKeys');
      mockValidateKeys.mockResolvedValue({ openai: false, ambiance: false });

      // Mock the fallback environment variables method to prevent interference
      const mockApplyFallbacks = jest.spyOn(testServer as any, 'applyFallbackEnvironmentVariables');
      mockApplyFallbacks.mockImplementation(() => {});

      await (testServer as any).initializeAsync();

      expect(mockValidateKeys).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Applied fallback for LOCAL_EMBEDDING_MODEL')
      );
    });
  });

  describe('validateApiKeys', () => {
    test('should validate OpenAI key when present', async () => {
      process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
      delete process.env.AMBIANCE_API_KEY;

      server = new AmbianceMCPServer();

      const mockValidateKeys = jest.spyOn(server as any, 'validateApiKeys');
      mockValidateKeys.mockResolvedValue({ openai: true, ambiance: false });

      await (server as any).initializeAsync();

      expect(mockValidateKeys).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '✅ OpenAI connectivity probe succeeded - adding OpenAI-compatible tools'
      );
    });

    test('should handle OpenAI validation failure', async () => {
      process.env.OPENAI_API_KEY = 'invalid-openai-key';
      delete process.env.AMBIANCE_API_KEY;

      server = new AmbianceMCPServer();

      const mockValidateKeys = jest.spyOn(server as any, 'validateApiKeys');
      mockValidateKeys.mockResolvedValue({ openai: false, ambiance: false });

      await (server as any).initializeAsync();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '⚠️ OpenAI API key detected but connectivity probe failed - OpenAI tools disabled'
      );
    });

    test('should validate Ambiance key when present', async () => {
      delete process.env.OPENAI_API_KEY;
      process.env.AMBIANCE_API_KEY = process.env.AMBIANCE_API_KEY || 'test-ambiance-key';

      server = new AmbianceMCPServer();

      const mockValidateKeys = jest.spyOn(server as any, 'validateApiKeys');
      mockValidateKeys.mockResolvedValue({ openai: false, ambiance: true });

      await (server as any).initializeAsync();

      expect(mockValidateKeys).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '✅ Ambiance API key validated - adding cloud storage and embedding tools'
      );
    });

    test('should handle Ambiance validation failure', async () => {
      delete process.env.OPENAI_API_KEY;
      process.env.AMBIANCE_API_KEY = 'invalid-ambiance-key';

      server = new AmbianceMCPServer();

      const mockValidateKeys = jest.spyOn(server as any, 'validateApiKeys');
      mockValidateKeys.mockResolvedValue({ openai: false, ambiance: false });

      await (server as any).initializeAsync();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '⚠️ Ambiance API key detected but validation failed - cloud tools disabled'
      );
    });
  });

  describe('start method', () => {
    test('should call initializeAsync on start', async () => {
      server = new AmbianceMCPServer();

      const mockInitializeAsync = jest.spyOn(server as any, 'initializeAsync');
      mockInitializeAsync.mockResolvedValue(undefined);

      // Mock the server connect method
      const mockConnect = jest.spyOn((server as any).server, 'connect');
      mockConnect.mockResolvedValue(undefined);

      await server.start();

      expect(mockInitializeAsync).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('✅ MCP Server ready for requests');
    });
  });
});
