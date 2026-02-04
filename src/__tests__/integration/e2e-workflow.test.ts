/**
 * End-to-end tests for Ambiance MCP core workflows
 * Tests complete user journeys from startup to tool execution
 */

import { jest } from '@jest/globals';
import { AmbianceMCPServer } from '../../index';
import { MockApiServer } from './mockApiServer';
import { logger } from '../../utils/logger';

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

// Mock the logger to capture output
jest.mock('../../utils/logger');
// Mock @xenova/transformers
jest.mock('@xenova/transformers');

describe('Ambiance MCP E2E Workflows', () => {
  let mockServer: MockApiServer;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    // Store original environment
    originalEnv = { ...process.env };

    // Start mock API server
    mockServer = new MockApiServer({
      port: 4001,
      validKeys: ['e2e-test-key'],
      simulateErrors: false,
    });

    await mockServer.start();
  });

  afterAll(async () => {
    // Restore original environment
    process.env = originalEnv;

    // Stop mock server
    await mockServer.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton instances between tests
    AmbianceMCPServer.dispose();
    // Reset API client singleton by forcing recreation
    const apiClientModule = require('../../client/apiClient');
    // Clear the singleton instance
    apiClientModule._apiClient = null;
    // Force recreation by accessing the getter (this will create a new instance with current env vars)
    const freshClient = apiClientModule.apiClient;
  });

  describe('Local Mode E2E', () => {
    test('should complete full workflow without API keys', async () => {
      // Test local-only mode (no API keys)
      delete process.env.AMBIANCE_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const server = new AmbianceMCPServer();
      await server.start();

      // Verify server started successfully
      expect(logger.info).toHaveBeenCalledWith('🔧 Startup flags', expect.any(Object));
      expect(logger.info).toHaveBeenCalledWith('🔧 Tool handlers registered successfully');
      expect(logger.info).toHaveBeenCalledWith(
        '🚀 Initializing Ambiance MCP Server v0.1.9-beta with SDK v1.17.3'
      );
    });
  });

  describe('Cloud Mode E2E', () => {
    test('should complete full workflow with valid API key', async () => {
      // Test with valid API key
      process.env.AMBIANCE_API_KEY = 'e2e-test-key';
      process.env.USING_LOCAL_SERVER_URL = mockServer.getBaseUrl();
      delete process.env.OPENAI_API_KEY;

      const server = new AmbianceMCPServer();
      await server.start();

      // Verify server started with cloud tools
      expect(logger.info).toHaveBeenCalledWith('✅ Ambiance API key validation successful');
      expect(logger.info).toHaveBeenCalledWith(
        '✅ Ambiance API key validated - adding cloud storage and embedding tools'
      );
      expect(logger.info).toHaveBeenCalledWith('✅ MCP Server ready for requests');
    });
  });

  describe('Fallback Mode E2E', () => {
    test('should gracefully handle invalid API key and continue with local tools', async () => {
      // Test with invalid API key - should fallback to local mode
      process.env.AMBIANCE_API_KEY = 'invalid-e2e-key';
      process.env.AMBIANCE_API_URL = mockServer.getBaseUrl();
      delete process.env.OPENAI_API_KEY;

      const server = new AmbianceMCPServer();
      await server.start();

      // Verify server handled invalid key gracefully and continued
      expect(logger.warn).toHaveBeenCalledWith(
        '⚠️ Ambiance API key detected but validation failed - cloud tools disabled'
      );
      expect(logger.info).toHaveBeenCalledWith('✅ MCP Server ready for requests');
    });
  });

  describe('Error Recovery E2E', () => {
    test('should handle server startup errors gracefully', async () => {
      // Test with server that will have errors
      const errorServer = new MockApiServer({
        port: 4002,
        validKeys: ['e2e-test-key'],
        simulateErrors: true,
      });

      await errorServer.start();

      process.env.AMBIANCE_API_KEY = 'e2e-test-key';
      process.env.AMBIANCE_API_URL = errorServer.getBaseUrl();

      const server = new AmbianceMCPServer();
      await server.start();

      // Verify server handled errors and still started
      expect(logger.warn).toHaveBeenCalledWith(
        '⚠️ Ambiance API key detected but validation failed - cloud tools disabled'
      );
      expect(logger.info).toHaveBeenCalledWith('✅ MCP Server ready for requests');

      await errorServer.stop();
    });
  });
});
