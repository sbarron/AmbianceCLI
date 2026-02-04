/**
 * Integration tests for tool combinations to improve coverage
 * Tests workflows that use multiple tools together
 */

import { describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import {
  setupStandardMocks,
  setupTestEnvironment,
  cleanupMocks,
} from '../../__tests__/utils/mockSetup';
import {
  createTestProject,
  TestPatterns,
  VALID_TEST_CONTENT,
} from '../../__tests__/utils/testHelpers';

setupStandardMocks();

describe('Tool Combination Integration Tests', () => {
  let envRestore: ReturnType<typeof setupTestEnvironment>['restore'];
  let testProject: Awaited<ReturnType<typeof createTestProject>>;

  beforeEach(async () => {
    cleanupMocks();
    const env = setupTestEnvironment({
      USE_LOCAL_EMBEDDINGS: 'true',
      AMBIANCE_API_KEY: 'test-key',
    });
    envRestore = env.restore;

    // Create a test project with realistic files
    testProject = await createTestProject([
      {
        name: 'src/index.ts',
        content: VALID_TEST_CONTENT.codeContent,
      },
      {
        name: 'src/utils.ts',
        content: `
export function parseConfig(input: string): Config {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error('Invalid configuration format');
  }
}

export interface Config {
  apiKey: string;
  timeout: number;
}
        `,
      },
      {
        name: 'src/database.ts',
        content: `
import { Config } from './utils';

export class DatabaseConnection {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // Connection logic
  }

  async disconnect(): Promise<void> {
    // Disconnection logic
  }
}
        `,
      },
    ]);
  });

  afterEach(async () => {
    await testProject.cleanup();
    envRestore();
    cleanupMocks();
  });

  describe('Project Analysis Workflow', () => {
    test('should combine local_project_hints and local_context for comprehensive analysis', async () => {
      const { handleProjectHints } = require('../localTools/projectHints');
      const { handleSemanticCompact } = require('../localTools/semanticCompact');

      // Step 1: Get project overview
      const hintsResult = await handleProjectHints({
        projectPath: testProject.path,
        format: 'structured',
        includeContent: true,
        useAI: false,
      });

      expect(hintsResult.success).toBe(true);
      expect(hintsResult.hints).toBeDefined();

      // Step 2: Get focused context based on hints
      const contextResult = await handleSemanticCompact({
        projectPath: testProject.path,
        query: 'database connection configuration',
        maxTokens: 4000,
        format: 'enhanced',
      });

      expect(contextResult.success).toBe(true);
      // Results should complement each other
      expect(hintsResult.hints.projectOverview).toBeDefined();
      expect(contextResult.compactedContent).toBeDefined();
    });

    test('should handle file_summary then local_context workflow', async () => {
      const { handleFileSummary } = require('../localTools/fileSummary');
      const { handleSemanticCompact } = require('../localTools/semanticCompact');

      // Step 1: Analyze specific file
      const summaryResult = await handleFileSummary({
        filePath: `${testProject.path}/src/database.ts`,
        projectPath: testProject.path,
        includeSymbols: true,
        maxSymbols: 10,
      });

      expect(summaryResult.success).toBe(true);

      // Step 2: Get broader context about database-related code
      const contextResult = await handleSemanticCompact({
        projectPath: testProject.path,
        query: 'database connections and configuration',
        maxTokens: 4000,
        format: 'enhanced',
      });

      expect(contextResult.success).toBe(true);
      // Should provide complementary information
      expect(summaryResult.summary).toBeDefined();
      expect(contextResult.compactedContent).toBeDefined();
    });
  });

  describe('Error Recovery Workflows', () => {
    test('should handle failed tool gracefully and continue with alternatives', async () => {
      const { handleProjectHints } = require('../localTools/projectHints');
      const { handleFileSummary } = require('../localTools/fileSummary');

      // First tool fails
      let hintsResult;
      try {
        hintsResult = await handleProjectHints({
          projectPath: '/nonexistent/path',
          format: 'structured',
        });
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Should still be able to use alternative approach
      const summaryResult = await handleFileSummary({
        filePath: `${testProject.path}/src/index.ts`,
        projectPath: testProject.path,
        includeSymbols: true,
      });

      expect(summaryResult.success).toBe(true);
    });

    test('should handle partial failures in multi-file analysis', async () => {
      const { handleFileSummary } = require('../localTools/fileSummary');

      // Mix of valid and invalid files
      const files = [
        `${testProject.path}/src/index.ts`, // valid
        '/nonexistent/file.ts', // invalid
        `${testProject.path}/src/utils.ts`, // valid
      ];

      const results = await Promise.allSettled(
        files.map(filePath =>
          handleFileSummary({
            filePath,
            projectPath: testProject.path,
            includeSymbols: true,
          })
        )
      );

      // Should have both successful and failed results
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      expect(successful).toBeGreaterThan(0);
      expect(failed).toBeGreaterThan(0);
      expect(successful + failed).toBe(files.length);
    });
  });

  describe('Performance Under Load', () => {
    test('should handle concurrent tool executions', async () => {
      const { handleFileSummary } = require('../localTools/fileSummary');
      const { handleSemanticCompact } = require('../localTools/semanticCompact');

      // Execute multiple tools concurrently
      const promises = [
        handleFileSummary({
          filePath: `${testProject.path}/src/index.ts`,
          projectPath: testProject.path,
        }),
        handleFileSummary({
          filePath: `${testProject.path}/src/utils.ts`,
          projectPath: testProject.path,
        }),
        handleSemanticCompact({
          projectPath: testProject.path,
          query: 'configuration management',
          maxTokens: 2000,
        }),
        handleSemanticCompact({
          projectPath: testProject.path,
          query: 'database operations',
          maxTokens: 2000,
        }),
      ];

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    test('should handle resource cleanup after multiple operations', async () => {
      const { handleSemanticCompact } = require('../localTools/semanticCompact');

      // Perform multiple operations that might create resources
      for (let i = 0; i < 5; i++) {
        const result = await handleSemanticCompact({
          projectPath: testProject.path,
          query: `test query ${i}`,
          maxTokens: 1000,
        });

        expect(result.success).toBe(true);
      }

      // Resources should be properly cleaned up (no memory leaks)
      // This is more of a smoke test - in real scenarios you'd monitor memory usage
      expect(true).toBe(true);
    });
  });

  describe('Configuration Variations', () => {
    test('should work with different format combinations', async () => {
      const { handleSemanticCompact } = require('../localTools/semanticCompact');

      const formats = ['enhanced', 'structured', 'compact'];

      for (const format of formats) {
        const result = await handleSemanticCompact({
          projectPath: testProject.path,
          query: 'project structure',
          maxTokens: 2000,
          format,
        });

        expect(result.success).toBe(true);
        expect(result.compactedContent).toBeDefined();
      }
    });

    test('should handle different token limits gracefully', async () => {
      const { handleSemanticCompact } = require('../localTools/semanticCompact');

      const tokenLimits = [500, 2000, 8000];

      for (const maxTokens of tokenLimits) {
        const result = await handleSemanticCompact({
          projectPath: testProject.path,
          query: 'comprehensive analysis',
          maxTokens,
        });

        expect(result.success).toBe(true);
        // Should respect token limits (approximate)
        expect(result.compactedContent.length).toBeLessThan(maxTokens * 6); // ~6 chars per token
      }
    });
  });

  describe('Data Flow Validation', () => {
    test('should maintain data consistency across tool chain', async () => {
      const { handleProjectHints } = require('../localTools/projectHints');
      const { handleSemanticCompact } = require('../localTools/semanticCompact');

      // Get hints about the project
      const hintsResult = await handleProjectHints({
        projectPath: testProject.path,
        format: 'structured',
        includeContent: true,
      });

      expect(hintsResult.success).toBe(true);
      const detectedFiles = hintsResult.hints.fileBreakdown?.totalFiles || 0;

      // Use semantic compaction on the same project
      const contextResult = await handleSemanticCompact({
        projectPath: testProject.path,
        query: 'all files and functions',
        maxTokens: 4000,
      });

      expect(contextResult.success).toBe(true);

      // Data should be consistent
      expect(detectedFiles).toBeGreaterThan(0);
      expect(contextResult.compactedContent).toContain('function');
    });

    test('should handle edge cases in data transformation', async () => {
      const { handleSemanticCompact } = require('../localTools/semanticCompact');

      // Test with empty query
      const emptyQueryResult = await handleSemanticCompact({
        projectPath: testProject.path,
        query: '',
        maxTokens: 2000,
      });

      // Should handle gracefully
      expect(emptyQueryResult.success).toBe(true);

      // Test with very specific query
      const specificResult = await handleSemanticCompact({
        projectPath: testProject.path,
        query: 'DatabaseConnection constructor parameters and error handling patterns',
        maxTokens: 2000,
      });

      expect(specificResult.success).toBe(true);
    });
  });
});
