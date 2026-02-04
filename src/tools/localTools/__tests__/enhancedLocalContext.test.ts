/**
 * @fileOverview: Comprehensive test suite for enhanced local context
 * @module: EnhancedLocalContextTests
 * @keyTests:
 *   - Unit tests for core functions
 *   - Golden tests for deterministic output
 *   - Performance benchmarks
 *   - Integration tests with project_hints
 * @context: Ensures reliability and deterministic behavior of enhanced local context
 */

import { localContext, LocalContextRequest, LocalContextResponse } from '../enhancedLocalContext';
import { runAstQueriesOnFiles } from '../astQueryEngine';
import { rankCandidatesWithScoring } from '../candidateRanking';
import { assembleMiniBundle } from '../miniBundleAssembler';
import { generateDeterministicAnswer } from '../answerDraftGenerator';
import { FileInfo } from '../../../core/compactor/fileDiscovery';
import * as path from 'path';
import * as fs from 'fs';

// ===== TEST FIXTURES =====

const FIXTURE_PROJECT_PATH = path.join(__dirname, 'fixtures', 'sample-project');

const SAMPLE_FILES: FileInfo[] = [
  {
    absPath: path.join(FIXTURE_PROJECT_PATH, 'src', 'database', 'connection.ts'),
    relPath: 'src/database/connection.ts',
    size: 2048,
    ext: '.ts',
    language: 'typescript',
  },
  {
    absPath: path.join(FIXTURE_PROJECT_PATH, 'src', 'api', 'routes.ts'),
    relPath: 'src/api/routes.ts',
    size: 1536,
    ext: '.ts',
    language: 'typescript',
  },
  {
    absPath: path.join(FIXTURE_PROJECT_PATH, 'src', 'auth', 'middleware.ts'),
    relPath: 'src/auth/middleware.ts',
    size: 1024,
    ext: '.ts',
    language: 'typescript',
  },
];

const SAMPLE_DATABASE_CONTENT = `
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

export function initializeDatabase(dbPath: string) {
  const db = new Database(dbPath);
  logger.info('Database initialized');
  return db;
}

export function queryRecords(db: any, table: string) {
  return db.prepare(\`SELECT * FROM \${table}\`).all();
}

export function insertRecord(db: any, table: string, data: any) {
  const stmt = db.prepare(\`INSERT INTO \${table} VALUES (?)\`);
  return stmt.run(data);
}
`;

const SAMPLE_API_CONTENT = `
import express from 'express';
import { authenticateUser } from '../auth/middleware';

const router = express.Router();

router.get('/api/users', authenticateUser, (req, res) => {
  // Get users logic
});

router.post('/api/users', authenticateUser, (req, res) => {
  // Create user logic
});

export default router;
`;

// ===== MOCK SETUP =====

// Mock file system for test fixtures
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));

// Mock FileDiscovery to avoid touching real filesystem
jest.mock('../../../core/compactor/fileDiscovery', () => {
  const actual = jest.requireActual('../../../core/compactor/fileDiscovery');
  return {
    ...actual,
    FileDiscovery: class MockFileDiscovery {
      basePath: string;
      options: any;
      constructor(basePath: string, options: any) {
        this.basePath = basePath;
        this.options = options;
      }
      async discoverFiles() {
        return SAMPLE_FILES;
      }
    },
  };
});

const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

beforeEach(() => {
  mockReadFileSync.mockImplementation((filePath: any) => {
    const pathStr = filePath.toString();

    if (pathStr.includes('connection.ts')) {
      return SAMPLE_DATABASE_CONTENT;
    } else if (pathStr.includes('routes.ts')) {
      return SAMPLE_API_CONTENT;
    } else if (pathStr.includes('middleware.ts')) {
      return `
export function authenticateUser(req: any, res: any, next: any) {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  next();
}
      `;
    }

    return 'export default {};';
  });
});

// ===== UNIT TESTS =====

describe('Enhanced Local Context - Unit Tests', () => {
  describe('AST Query Engine', () => {
    it('should find import queries correctly', async () => {
      const queries = [{ kind: 'import' as const, source: /better-sqlite3/ }];

      const results = await runAstQueriesOnFiles(SAMPLE_FILES.slice(0, 1), queries, 10);

      expect(results).toHaveLength(1);
      expect(results[0].symbol).toContain('better-sqlite3');
      expect(results[0].kind).toBe('import');
    });

    it('should find export queries correctly', async () => {
      const queries = [{ kind: 'export' as const, name: /initialize/ }];

      const results = await runAstQueriesOnFiles(SAMPLE_FILES.slice(0, 1), queries, 10);

      expect(results).toHaveLength(1);
      expect(results[0].symbol).toContain('initializeDatabase');
      expect(results[0].kind).toBe('export');
    });

    it('should find function calls correctly', async () => {
      const queries = [{ kind: 'call' as const, callee: /prepare/ }];

      const results = await runAstQueriesOnFiles(SAMPLE_FILES.slice(0, 1), queries, 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.symbol.includes('prepare'))).toBe(true);
    });
  });

  describe('Candidate Ranking', () => {
    it('should rank candidates by relevance', async () => {
      const mockCandidates = [
        {
          file: 'src/database/connection.ts',
          symbol: 'initializeDatabase',
          start: 100,
          end: 200,
          kind: 'function',
          score: 0,
          reasons: ['database initialization'],
          role: 'initialization',
        },
        {
          file: 'src/utils/helper.ts',
          symbol: 'helperFunction',
          start: 50,
          end: 100,
          kind: 'function',
          score: 0,
          reasons: ['utility function'],
          role: 'helper',
        },
      ];

      const mockProjectContext = {
        files: SAMPLE_FILES,
        exports: [],
        imports: [],
        routes: [],
        env: [],
        systems: {},
      };

      const ranked = await rankCandidatesWithScoring(
        mockCandidates,
        mockProjectContext,
        'database initialization',
        'init-read-write'
      );

      expect(ranked).toHaveLength(2);
      expect(ranked[0].symbol).toBe('initializeDatabase'); // Should be ranked higher
      expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore);
    });
  });

  describe('Answer Draft Generation', () => {
    it('should generate deterministic answers for database queries', () => {
      const mockTargets = [
        {
          file: 'src/database/connection.ts',
          symbol: 'initializeDatabase',
          start: 100,
          end: 200,
          role: 'DB init',
          confidence: 0.9,
          why: ['database initialization function'],
        },
      ];

      const mockIndices = {
        systems: {
          db: { engine: 'vector-chroma' },
        },
        env: ['DB_PATH'],
      };

      const answer = generateDeterministicAnswer(
        'init-read-write',
        'understand',
        mockTargets,
        mockIndices
      );

      expect(answer).toContain('vector-chroma');
      expect(answer).toContain('initializeDatabase');
      expect(answer).toContain('DB_PATH');
      expect(answer.length).toBeGreaterThan(50);
      expect(answer.length).toBeLessThan(500); // Reasonable length
    });

    it('should handle missing template gracefully', () => {
      const answer = generateDeterministicAnswer('unknown-plan', 'unknown-task', [], {});

      expect(answer).toBeTruthy();
      expect(answer).toContain('unknown-plan');
    });
  });
});

// ===== INTEGRATION TESTS =====

describe('Enhanced Local Context - Integration Tests', () => {
  // Mock the project detection and file discovery
  jest.mock('../../../tools/utils/pathUtils', () => ({
    detectWorkspaceDirectory: () => FIXTURE_PROJECT_PATH,
  }));

  it('should handle database queries end-to-end', async () => {
    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'How does database connection and storage work?',
      taskType: 'understand',
      maxTokens: 2000,
      maxSimilarChunks: 10,
      useProjectHintsCache: false, // Disable for testing
    };

    const result = await localContext(request);

    expect(result.success).toBe(true);
    expect(result.answerDraft).toBeTruthy();
    expect(result.jumpTargets.length).toBeGreaterThan(0);
    expect(result.metadata.filesScanned).toBeGreaterThan(0);

    // Check that database-related symbols were found
    const hasDbSymbols = result.jumpTargets.some(
      target =>
        target.symbol.toLowerCase().includes('database') ||
        target.symbol.toLowerCase().includes('init')
    );
    expect(hasDbSymbols).toBe(true);
  });

  it('should handle API route queries', async () => {
    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'Show me the API endpoints and routing',
      taskType: 'understand',
      attackPlan: 'api-route',
      maxTokens: 2000,
      maxSimilarChunks: 10,
      useProjectHintsCache: false,
    };

    const result = await localContext(request);

    expect(result.success).toBe(true);
    expect(result.answerDraft).toContain('API');

    // Should find route-related symbols
    const hasRouteSymbols = result.jumpTargets.some(
      target => target.file.includes('routes') || target.symbol.toLowerCase().includes('router')
    );
    expect(hasRouteSymbols).toBe(true);
  });

  it('should respect token budgets', async () => {
    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'Analyze all code patterns',
      taskType: 'understand',
      maxTokens: 500, // Very small budget
      maxSimilarChunks: 20,
      useProjectHintsCache: false,
    };

    const result = await localContext(request);

    expect(result.success).toBe(true);
    expect(result.metadata.bundleTokens).toBeLessThanOrEqual(500);
  });

  it('demotes scripts and projection_matrix noise in path scoring', async () => {
    const { rankCandidatesWithScoring } = await import('../candidateRanking');
    const noisy = {
      file: 'scripts/generate_projection_matrix.js',
      symbol: 'generate_projection_matrix',
      start: 0,
      end: 10,
      kind: 'function',
      score: 0,
      reasons: [],
      role: 'helper',
    } as any;
    const legit = {
      file: 'src/middleware/auth.ts',
      symbol: 'AuthMiddleware',
      start: 0,
      end: 10,
      kind: 'export',
      score: 0,
      reasons: ['middleware'],
      role: 'middleware',
    } as any;

    const ranked = await rankCandidatesWithScoring(
      [noisy, legit],
      { files: SAMPLE_FILES, exports: [], imports: [], routes: [], env: [], systems: {} } as any,
      'auth middleware',
      'auth'
    );

    expect(ranked[0].file).toContain('auth');
    expect(ranked[ranked.length - 1].file).toContain('scripts');
  });

  it('includes env hints for SUPABASE when topic is auth', async () => {
    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'auth supabase login',
      taskType: 'understand',
      maxTokens: 1000,
      useProjectHintsCache: false,
    };

    const result = await localContext(request);
    // llmBundle should exist with envHints
    // Note: llmBundle is optional in type; ensure we generated it
    expect(result.llmBundle).toBeDefined();
    const envHints = result.llmBundle?.envHints || [];
    expect(envHints.some(k => /SUPABASE_/i.test(k))).toBe(true);
  });

  it('should respect exclude patterns when provided', async () => {
    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'auth supabase login',
      taskType: 'understand',
      maxTokens: 1000,
      useProjectHintsCache: false,
      excludePatterns: ['**/auth/**'],
    };

    const result = await localContext(request);

    expect(result.success).toBe(true);
    const hasAuthFile = result.jumpTargets.some(target => /auth/i.test(target.file));
    expect(hasAuthFile).toBe(false);
  });
});

// ===== GOLDEN TESTS =====

describe('Enhanced Local Context - Golden Tests', () => {
  // These tests ensure deterministic output for regression testing

  it('should produce consistent output for database query', async () => {
    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'database initialization',
      taskType: 'understand',
      attackPlan: 'init-read-write',
      maxTokens: 1500,
      maxSimilarChunks: 5,
      useProjectHintsCache: false,
    };

    const result1 = await localContext(request);
    const result2 = await localContext(request);

    // Results should be deterministic (same inputs = same outputs)
    expect(result1.answerDraft).toBe(result2.answerDraft);
    expect(result1.jumpTargets.length).toBe(result2.jumpTargets.length);
    expect(result1.miniBundle.length).toBe(result2.miniBundle.length);
  });

  it('should have consistent metadata format', async () => {
    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'test query',
      taskType: 'debug',
      maxTokens: 1000,
      useProjectHintsCache: false,
    };

    const result = await localContext(request);

    expect(result.metadata).toMatchObject({
      filesScanned: expect.any(Number),
      symbolsConsidered: expect.any(Number),
      originalTokens: expect.any(Number),
      compactedTokens: expect.any(Number),
      bundleTokens: expect.any(Number),
      processingTimeMs: expect.any(Number),
    });

    expect(result.next).toMatchObject({
      mode: expect.stringMatching(/^(code_lookup|project_research|implementation_ready)$/),
      openFiles: expect.any(Array),
      checks: expect.any(Array),
    });
  });
});

// ===== PERFORMANCE TESTS =====

describe('Enhanced Local Context - Performance Tests', () => {
  it('should complete analysis within reasonable time', async () => {
    const startTime = Date.now();

    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'comprehensive code analysis',
      taskType: 'understand',
      maxTokens: 3000,
      maxSimilarChunks: 20,
      useProjectHintsCache: false,
    };

    const result = await localContext(request);
    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    expect(result.metadata.processingTimeMs).toBeLessThan(5000);
  });

  it('should handle large file sets efficiently', async () => {
    // Create a larger mock file set
    const largeFileSet = Array.from({ length: 50 }, (_, i) => ({
      absPath: path.join(FIXTURE_PROJECT_PATH, `src/file${i}.ts`),
      relPath: `src/file${i}.ts`,
      size: 1024,
      ext: '.ts',
      language: 'typescript' as const,
    }));

    mockReadFileSync.mockReturnValue('export const test = "value";');

    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'find test patterns',
      taskType: 'test',
      maxTokens: 2000,
      maxSimilarChunks: 30,
      useProjectHintsCache: false,
    };

    const result = await localContext(request);

    expect(result.success).toBe(true);
    expect(result.metadata.processingTimeMs).toBeLessThan(10000); // 10 second limit
  });
});

// ===== ERROR HANDLING TESTS =====

describe('Enhanced Local Context - Error Handling', () => {
  it('should handle invalid queries gracefully', async () => {
    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: '', // Empty query
      taskType: 'understand',
      maxTokens: 1000,
      useProjectHintsCache: false,
    };

    const result = await localContext(request);

    // Should not crash, but may return empty results
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
  });

  it('should handle missing files gracefully', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('File not found');
    });

    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'analyze missing files',
      taskType: 'debug',
      maxTokens: 1000,
      useProjectHintsCache: false,
    };

    const result = await localContext(request);

    // Should handle errors gracefully
    expect(result).toBeDefined();
    expect(typeof result.answerDraft).toBe('string');
  });

  it('should respect maximum token limits', async () => {
    const request: LocalContextRequest = {
      projectPath: FIXTURE_PROJECT_PATH,
      query: 'comprehensive analysis',
      taskType: 'understand',
      maxTokens: 100, // Very small limit
      maxSimilarChunks: 50, // Large chunk request
      useProjectHintsCache: false,
    };

    const result = await localContext(request);

    expect(result.success).toBe(true);
    expect(result.metadata.bundleTokens).toBeLessThanOrEqual(100);
  });
});

// ===== HELPER FUNCTIONS FOR TESTS =====

function createMockFileInfo(relPath: string, content: string): FileInfo {
  return {
    absPath: path.join(FIXTURE_PROJECT_PATH, relPath),
    relPath,
    size: content.length,
    ext: path.extname(relPath),
    language: relPath.endsWith('.ts')
      ? 'typescript'
      : relPath.endsWith('.js')
        ? 'javascript'
        : 'typescript',
  };
}
