/**
 * @fileOverview: Frontend insights tool for comprehensive web layer analysis
 * @module: FrontendInsights
 * @keyFunctions:
 *   - frontendInsightsTool: Tool definition for frontend analysis
 *   - handleFrontendInsights(): Handler for frontend insights requests
 * @context: Provides deterministic analysis of Next.js/React frontend including routes, components, data flow, and risks
 */

import { z } from 'zod';

export { handleFrontendInsights } from '../../runtime/frontend/frontendInsights';

/**
 * Zod schema for frontend insights input validation
 */
const FRONTEND_INSIGHTS_SCHEMA = z.object({
  projectPath: z.string().describe('Absolute or relative path to the Next.js project directory'),
  format: z
    .enum(['structured', 'json', 'compact', 'markdown'])
    .default('structured')
    .describe('Output format for the analysis results'),
  includeContent: z.boolean().default(true).describe('Include detailed file content analysis'),
  subtree: z
    .string()
    .default('web/app')
    .describe('Frontend directory path to analyze (default: web/app)'),
  maxFiles: z
    .number()
    .min(1)
    .max(10000)
    .default(2000)
    .describe('Maximum number of files to analyze'),
  useEmbeddings: z
    .boolean()
    .default(true)
    .describe('Enable embedding-based similarity analysis for enhanced insights'),
  embeddingSimilarityThreshold: z
    .number()
    .min(0.0)
    .max(1.0)
    .default(0.3)
    .describe(
      'Similarity threshold for embedding-based matches (lower = more results, higher = more precise)'
    ),
  maxSimilarComponents: z
    .number()
    .min(1)
    .max(20)
    .default(5)
    .describe('Maximum number of similar components to analyze per component'),
  analyzePatterns: z
    .boolean()
    .default(true)
    .describe('Enable pattern detection for code smells, anti-patterns, and security issues'),
  generateEmbeddingsIfMissing: z
    .boolean()
    .default(false)
    .describe(
      "Generate embeddings for project files if they don't exist (may take time for large projects)"
    ),
});

/**
 * Tool definition for frontend insights
 */
const frontendInsightsTool = {
  name: 'frontend_insights',
  description:
    '🔍 Map routes, components, data flow, design system, and risks in the web layer with embedding-enhanced analysis. Analyzes Next.js/React projects for architecture insights, component similarities, and potential issues using semantic embeddings.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Absolute or relative path to the Next.js project directory',
      },
      format: {
        type: 'string',
        enum: ['structured', 'json', 'compact', 'markdown'],
        default: 'structured',
        description: 'Output format for the analysis results',
      },
      includeContent: {
        type: 'boolean',
        default: true,
        description: 'Include detailed file content analysis',
      },
      subtree: {
        type: 'string',
        default: 'web/app',
        description: 'Frontend directory path to analyze (default: web/app)',
      },
      maxFiles: {
        type: 'number',
        default: 2000,
        minimum: 1,
        maximum: 10000,
        description: 'Maximum number of files to analyze',
      },
      useEmbeddings: {
        type: 'boolean',
        default: true,
        description: 'Enable embedding-based similarity analysis for enhanced insights',
      },
      embeddingSimilarityThreshold: {
        type: 'number',
        default: 0.3,
        minimum: 0.0,
        maximum: 1.0,
        description:
          'Similarity threshold for embedding-based matches (lower = more results, higher = more precise)',
      },
      maxSimilarComponents: {
        type: 'number',
        default: 5,
        minimum: 1,
        maximum: 20,
        description: 'Maximum number of similar components to analyze per component',
      },
      analyzePatterns: {
        type: 'boolean',
        default: true,
        description: 'Enable pattern detection for code smells, anti-patterns, and security issues',
      },
      generateEmbeddingsIfMissing: {
        type: 'boolean',
        default: false,
        description:
          "Generate embeddings for project files if they don't exist (may take time for large projects)",
      },
    },
    required: ['projectPath'],
  },
};

/**
 * Type definition for frontend insights output
 */
export interface FrontendInsights {
  generatedAt: string;
  summary: {
    pages: number;
    clientComponents: number;
    serverComponents: number;
    stateStores: string[];
    dataLibraries: string[];
    designSystem: string[];
    fileComposition: {
      totalFiles: number;
      byType: Record<string, number>;
      analyzedFiles: number;
      filteredOut: Record<string, number>;
    };
  };
  routes: {
    pages: Array<{
      path: string;
      page: string;
      layout?: string;
      clientIslands: number;
      clientIslandExamples?: string[];
      routeGroup?: string;
      parallelRoutes?: string[];
      hasRouteLoading?: boolean;
      hasRouteError?: boolean;
      hasInlineLoading?: boolean;
      hasInlineError?: boolean;
      hasDataFetch?: boolean;
    }>;
    handlers: Array<{
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
      path: string;
      file: string;
      lines?: string;
    }>;
  };
  boundaries: any[];
  components: Array<{
    name: string;
    kind: 'client' | 'server';
    file: string;
    props?: { count?: number; typeRef?: string };
    hooks: string[];
    uses: { forms?: boolean; tables?: boolean; modals?: boolean };
  }>;
  dataFlow: {
    endpoints: Array<{ method: string; path: string; usedBy: string[] }>;
    externalBases: string[];
    endpointCalls: Array<{
      method: string;
      path: string;
      normalizedPath: string;
      fingerprint: string;
      params?: string[];
      bodyKeys?: string[];
      component: string;
      file: string;
      line: number;
      context: string;
    }>;
    duplicateEndpoints: Array<{
      fingerprint: string;
      method: string;
      path: string;
      count: number;
      files: string[];
      suggestion: string;
    }>;
  };
  env: {
    nextPublic: string[];
    clientLeaks: Array<{ key: string; file: string; line: number }>;
    leaks: Array<{
      file: string;
      line: number;
      codeFrame: string;
      symbol: string;
      category: 'ENV_CLIENT' | 'DOM_IN_RSC' | 'SERVER_IMPORT_IN_CLIENT' | 'UNSAFE_URLS';
      why: string;
      severity: 'high' | 'medium' | 'low';
      fixHint?: string;
      replacement?: string;
    }>;
  };
  performance: {
    heavyClientImports: Array<{
      file: string;
      import: string;
      sizeHint?: string;
      recommendation: string;
      severity: 'high' | 'medium' | 'low';
    }>;
    noDynamicCandidates: string[];
    perRouteAnalysis?: Array<{
      path: string;
      totalSizeKB: number;
      clientSizeKB: number;
      topDeps: Array<{
        name: string;
        sizeKB: number;
        category: string;
        usedIn: string[];
      }>;
      splitCandidates: Array<{
        component: string;
        heavyDeps: string[];
        recommendation: string;
        potentialSavingsKB: number;
      }>;
      clientComponents: string[];
      serverComponents: string[];
    }>;
  };
  accessibility: Array<{
    rule: string;
    file: string;
    line: number;
    sample: string;
    issue?: string;
    severity?: 'high' | 'medium' | 'low';
    recommendation?: string;
    fixHint?: string;
    codemod?: string;
  }>;
  risks: {
    score: number;
    trustedScore: number;
    rules: Array<{ id: string; why: string; evidence: string[] }>;
    scoreReductionActions?: Array<{
      action: string;
      estimatedReduction: number;
      category: string;
      priority: 'high' | 'medium' | 'low';
      files?: string[];
    }>;
  };
  recommendedNextSteps: Array<{ title: string; files?: string[] }>;
  embeddingInsights?: {
    componentSimilarities: any[];
    patternAnalysis: any[];
    apiUsagePatterns: any[];
    embeddingsUsed: boolean;
    similarComponentsFound: number;
    patternsDetected: number;
  };
}

// Export the tool and schema
export { frontendInsightsTool, FRONTEND_INSIGHTS_SCHEMA };
