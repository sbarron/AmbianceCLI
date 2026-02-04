/**
 * Integration tests for Ambiance MCP with mock API server
 * Tests API key validation and basic functionality
 */

import { jest } from '@jest/globals';
import { AmbianceMCPServer } from '../../index';
import { MockApiServer } from './mockApiServer';
import { logger } from '../../utils/logger';
import { AmbianceAPIClient } from '../../client/apiClient';

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

describe('Ambiance MCP API Integration', () => {
  let mockServer: MockApiServer;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    // Store original environment
    originalEnv = { ...process.env };

    // Start mock API server
    mockServer = new MockApiServer({
      port: 3999,
      validKeys: ['valid-test-key'],
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
    // Reset the cached apiClient instance between tests
    delete require.cache[require.resolve('../../client/apiClient')];
    const apiClientModule = require('../../client/apiClient');
    apiClientModule._apiClient = null;
  });

  describe('API Client Integration', () => {
    test('should successfully connect to mock API server', async () => {
      const client = new AmbianceAPIClient('valid-test-key', mockServer.getBaseUrl());

      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(true);
    });

    test('should fail with invalid API key', async () => {
      const client = new AmbianceAPIClient('invalid-test-key', mockServer.getBaseUrl());

      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(false);
    });

    test('should generate embeddings with valid key', async () => {
      const client = new AmbianceAPIClient('valid-test-key', mockServer.getBaseUrl());

      const result = await client.generateEmbeddings({
        texts: ['test text'],
        input_type: 'document',
        model: process.env.VOYAGEAI_MODEL || 'voyageai-model',
      });

      expect(result).toBeDefined();
      expect(result.embeddings).toBeDefined();
      expect(Array.isArray(result.embeddings)).toBe(true);
      expect(result.embeddings.length).toBe(1);
      expect(result.model).toBe(process.env.VOYAGEAI_MODEL || 'voyageai-model');
      expect(result.dimensions).toBe(1024);
    });
  });

  describe('MCP Server Integration', () => {
    test('should initialize with valid API key', async () => {
      process.env.AMBIANCE_API_KEY = 'valid-test-key';
      process.env.USING_LOCAL_SERVER_URL = mockServer.getBaseUrl();
      delete process.env.OPENAI_API_KEY;

      const server = new AmbianceMCPServer();
      await server.start();

      // The server should have logged successful validation
      expect(logger.info).toHaveBeenCalledWith('✅ Ambiance API key validation successful');
      expect(logger.info).toHaveBeenCalledWith(
        '✅ Ambiance API key validated - adding cloud storage and embedding tools'
      );
    });

    test('should handle invalid API key gracefully', async () => {
      process.env.AMBIANCE_API_KEY = 'invalid-test-key';
      process.env.USING_LOCAL_SERVER_URL = mockServer.getBaseUrl();
      delete process.env.OPENAI_API_KEY;

      const server = new AmbianceMCPServer();
      // Validation happens during initializeAsync which is called by start
      await server.start();

      // The server should have logged validation failure
      expect(logger.warn).toHaveBeenCalledWith(
        '⚠️ Ambiance API key detected but validation failed - cloud tools disabled'
      );
    });

    test('should work without API key (local mode)', async () => {
      delete process.env.AMBIANCE_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const server = new AmbianceMCPServer();
      await server.start();

      // Should log that no keys were detected
      expect(logger.info).toHaveBeenCalledWith('🔧 Startup flags', expect.any(Object));
      expect(logger.info).toHaveBeenCalledWith('🔧 Tool handlers registered successfully');
    });
  });

  describe('Error Scenarios', () => {
    test('should handle API server errors', async () => {
      // Create a new mock server that simulates errors
      const errorServer = new MockApiServer({
        port: 4000,
        validKeys: ['valid-test-key'],
        simulateErrors: true,
      });

      await errorServer.start();

      process.env.AMBIANCE_API_KEY = 'valid-test-key';
      process.env.AMBIANCE_API_URL = errorServer.getBaseUrl();

      const server = new AmbianceMCPServer();
      await server.start();

      // The server should handle the API error gracefully
      expect(logger.warn).toHaveBeenCalledWith(
        '⚠️ Ambiance API key detected but validation failed - cloud tools disabled'
      );

      await errorServer.stop();
    });
  });
});
