/**
 * @fileOverview: Frontend insights tool for comprehensive web layer analysis
 * @module: FrontendInsights
 * @keyFunctions:
 *   - frontendInsightsTool: Tool definition for frontend analysis
 *   - handleFrontendInsights(): Handler for frontend insights requests
 * @context: Provides deterministic analysis of Next.js/React frontend including routes, components, data flow, and risks
 */

import { z } from 'zod';
import { logger } from '../../utils/logger';
import { validateAndResolvePath } from '../utils/pathUtils';
import { FileDiscovery, FileInfo } from '../../core/compactor/fileDiscovery';
import { formatFrontendInsights } from './formatters/frontendInsightsFormatters';
import { analyzeRoutes, analyzeBoundaries } from './analyzers/frontend/router';
import { analyzeComponents } from './analyzers/frontend/components';
import { analyzeDataFlow } from './analyzers/frontend/dataFlow';
import * as path from 'path';

/**
 * Analyze file composition by type
 */
function analyzeFileComposition(
  allFiles: FileInfo[],
  frontendFiles: FileInfo[]
): FrontendInsights['summary']['fileComposition'] {
  const byType: Record<string, number> = {};
  const filteredOut: Record<string, number> = {};

  // Count all files by extension
  for (const file of allFiles) {
    const ext = file.ext || path.extname(file.relPath).toLowerCase() || 'no-extension';
    byType[ext] = (byType[ext] || 0) + 1;
  }

  // Count filtered out files (not in frontendFiles)
  const frontendFileSet = new Set(frontendFiles.map(f => f.absPath));
  for (const file of allFiles) {
    if (!frontendFileSet.has(file.absPath)) {
      const ext = file.ext || path.extname(file.relPath).toLowerCase() || 'no-extension';
      filteredOut[ext] = (filteredOut[ext] || 0) + 1;
    }
  }

  return {
    totalFiles: allFiles.length,
    byType,
    analyzedFiles: frontendFiles.length,
    filteredOut,
  };
}

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
 * Handler for frontend insights requests
 */
async function handleFrontendInsights(args: any): Promise<any> {
  const { projectPath, format = 'structured', subtree = 'web/app', maxFiles = 2000 } = args;

  // Validate that projectPath is provided
  if (!projectPath) {
    throw new Error(
      '❌ projectPath is required. Please provide an absolute path to the Next.js project directory.'
    );
  }

  const resolvedProjectPath = validateAndResolvePath(projectPath);

  logger.info('🔍 Starting frontend insights analysis', {
    originalPath: projectPath,
    resolvedPath: resolvedProjectPath,
    format,
    subtree,
    maxFiles,
  });

  try {
    // Discover files in the project
    const fileDiscovery = new FileDiscovery(resolvedProjectPath);
    const allFiles = await fileDiscovery.discoverFiles();

    // Filter files for frontend types (including HTML, CSS, config files, and other relevant files)
    const frontendFiles = allFiles.filter(file => {
      const isFrontendCode = /\.(ts|tsx|js|jsx|vue|svelte|html|css|scss|sass|less|astro|mdx)$/.test(
        file.relPath
      );
      const isConfigFile = file.relPath.includes('.config.') || file.relPath.includes('config.');
      const isExcluded =
        file.relPath.includes('node_modules') ||
        file.relPath.includes('dist') ||
        file.relPath.includes('.next') ||
        file.relPath.includes('build');

      return (isFrontendCode || isConfigFile) && !isExcluded;
    });

    logger.info(`📁 Found ${frontendFiles.length} frontend files (${allFiles.length} total)`);

    // Analyze file composition
    const fileComposition = analyzeFileComposition(allFiles, frontendFiles);

    // Auto-detect the correct app directory if subtree is default or doesn't exist
    let effectiveSubtree = subtree;
    if (subtree === 'web/app' || subtree === 'app') {
      // Check for common app directory patterns
      const appPatterns = ['app', 'src/app', 'web/app', 'pages', 'src/pages'];
      let detectedAppDir = null;

      for (const pattern of appPatterns) {
        const testPath = path.join(resolvedProjectPath, pattern);
        const filesInPattern = frontendFiles.filter(file => file.absPath.startsWith(testPath));
        if (filesInPattern.length > 0) {
          // Check if there are actual page files in this directory
          // For App Router: look for /page. files
          // For Pages Router: look for any JS/TS/JSX/TSX files (not special App Router files)
          const pageFiles = filesInPattern.filter(file => {
            const relPath = file.relPath;
            if (pattern.includes('pages')) {
              // Pages Router: any JS/TS file that's not an API route or special file
              return (
                /\.(js|jsx|ts|tsx)$/.test(relPath) &&
                !relPath.includes('/api/') &&
                !relPath.includes('/_') &&
                !relPath.includes('/page.') &&
                !relPath.includes('/layout.') &&
                !relPath.includes('/route.')
              );
            } else {
              // App Router: look for /page. files
              return relPath.includes('/page.');
            }
          });
          if (pageFiles.length > 0) {
            detectedAppDir = pattern;
            logger.info(
              `🔍 Auto-detected ${pattern.includes('pages') ? 'Pages Router' : 'App Router'} directory: ${pattern} (${pageFiles.length} page files found)`
            );
            break;
          }
        }
      }

      if (detectedAppDir) {
        effectiveSubtree = detectedAppDir;
      } else {
        // If no specific app directory found, use the entire project but prioritize app-like structures
        effectiveSubtree = '.';
        logger.info(`🔍 No specific app directory detected, analyzing entire project`);
      }
    }

    // Filter files for the effective subtree
    const targetPath = path.join(resolvedProjectPath, effectiveSubtree);
    const subtreeFiles = frontendFiles.filter(
      file => effectiveSubtree === '.' || file.absPath.startsWith(targetPath)
    );

    const filesToAnalyze =
      subtreeFiles.length > 0 ? subtreeFiles.slice(0, maxFiles) : frontendFiles.slice(0, maxFiles);

    logger.info(`📁 Analyzing ${filesToAnalyze.length} files in frontend`);

    // Initialize basic analysis results
    const insights: FrontendInsights = {
      generatedAt: new Date().toISOString(),
      summary: {
        pages: 0,
        clientComponents: 0,
        serverComponents: 0,
        stateStores: [],
        dataLibraries: [],
        designSystem: [],
        fileComposition,
      },
      routes: {
        pages: [],
        handlers: [],
      },
      boundaries: [],
      components: [],
      dataFlow: {
        endpoints: [],
        externalBases: [],
        endpointCalls: [],
        duplicateEndpoints: [],
      },
      env: {
        nextPublic: [],
        clientLeaks: [],
        leaks: [],
      },
      performance: {
        heavyClientImports: [],
        noDynamicCandidates: [],
      },
      accessibility: [],
      risks: {
        score: 0,
        trustedScore: 0,
        rules: [],
      },
      recommendedNextSteps: [],
    };

    // Basic analysis
    try {
      // Analyze routes - pass the detected app directory
      logger.info('🛣️  Analyzing routes');
      const appDir = effectiveSubtree === '.' ? 'app' : effectiveSubtree; // Use detected directory or default to 'app'
      const routeAnalysis = await analyzeRoutes(filesToAnalyze, appDir);

      let totalPages = 0;

      // Handle the case where routeAnalysis might be an array or have a different structure
      if (Array.isArray(routeAnalysis)) {
        insights.routes = { pages: routeAnalysis as any, handlers: [] };
        // Count only routes that have page files (App Router)
        const appRouterPages = routeAnalysis.filter((route: any) => route.files?.page).length;
        totalPages += appRouterPages;
      } else if (routeAnalysis && typeof routeAnalysis === 'object') {
        insights.routes = routeAnalysis as any;
        totalPages += (routeAnalysis as any).pages?.length || 0;
      } else {
        insights.routes = { pages: [], handlers: [] };
      }

      // Count Pages Router pages and HTML files
      const pagesRouterPages = filesToAnalyze.filter(file => {
        const relPath = file.relPath.replace(/\\/g, '/');
        // Pages Router: files in pages/ or src/pages/ that are JS/TS/JSX/TSX (but not API routes or special App Router files)
        const isInPagesDir =
          relPath.includes('/pages/') ||
          relPath.startsWith('pages/') ||
          relPath.startsWith('src/pages/');
        if (isInPagesDir) {
          return (
            /\.(js|jsx|ts|tsx)$/.test(relPath) &&
            !relPath.includes('/api/') &&
            !relPath.includes('/_') &&
            !relPath.includes('/page.') &&
            !relPath.includes('/layout.') &&
            !relPath.includes('/route.')
          );
        }
        return false;
      }).length;

      // Count HTML pages
      const htmlPages = filesToAnalyze.filter(
        file =>
          file.relPath.endsWith('.html') &&
          !file.relPath.includes('node_modules') &&
          !file.relPath.includes('dist') &&
          !file.relPath.includes('.next')
      ).length;

      totalPages += pagesRouterPages + htmlPages;

      if (pagesRouterPages > 0) {
        logger.info(`📄 Found ${pagesRouterPages} Pages Router pages`);
      }
      if (htmlPages > 0) {
        logger.info(`📄 Found ${htmlPages} HTML pages`);
      }

      insights.summary.pages = totalPages;
    } catch (error) {
      logger.warn('Route analysis failed:', {
        error: error instanceof Error ? error.message : String(error),
      });
      insights.routes = { pages: [], handlers: [] };
    }

    try {
      // Analyze components
      logger.info('⚛️  Analyzing components');
      const componentAnalysis = await analyzeComponents(filesToAnalyze);
      insights.components = Array.isArray(componentAnalysis) ? componentAnalysis : [];
      insights.summary.clientComponents = insights.components.filter(
        (c: any) => c.kind === 'client'
      ).length;
      insights.summary.serverComponents = insights.components.filter(
        (c: any) => c.kind === 'server'
      ).length;
    } catch (error) {
      logger.warn('Component analysis failed:', {
        error: error instanceof Error ? error.message : String(error),
      });
      insights.components = [];
    }

    try {
      // Analyze data flow
      logger.info('🔄 Analyzing data flow');
      const dataFlowAnalysis = await analyzeDataFlow(filesToAnalyze, insights.components);
      insights.dataFlow.endpoints = (dataFlowAnalysis.endpoints || []).map((e: any) => ({
        method: e.method || 'GET',
        path: e.path,
        usedBy: e.usedBy,
      }));
      insights.dataFlow.endpointCalls = dataFlowAnalysis.endpointCalls || [];
      insights.dataFlow.duplicateEndpoints = dataFlowAnalysis.duplicateEndpoints || [];
    } catch (error) {
      logger.warn('Data flow analysis failed:', {
        error: error instanceof Error ? error.message : String(error),
      });
      insights.dataFlow = {
        endpoints: [],
        externalBases: [],
        endpointCalls: [],
        duplicateEndpoints: [],
      };
    }

    // Generate simple recommended next steps
    const nextSteps = [];
    if (insights.dataFlow.duplicateEndpoints.length > 3) {
      nextSteps.push({
        title: `Consolidate ${insights.dataFlow.duplicateEndpoints.length} duplicate API calls`,
      });
    }
    if (insights.components.length > 50) {
      nextSteps.push({
        title: `Review component architecture (${insights.components.length} components found)`,
      });
    }
    if (insights.dataFlow.endpoints.length > 20) {
      nextSteps.push({
        title: `Consider API consolidation (${insights.dataFlow.endpoints.length} endpoints found)`,
      });
    }

    insights.recommendedNextSteps = nextSteps;

    logger.info('✅ Frontend insights analysis complete', {
      pages: insights.summary.pages,
      components: insights.components.length,
      endpoints: insights.dataFlow.endpoints.length,
    });

    // Format and return results
    const formattedResult = formatFrontendInsights(insights, format);

    return {
      content: [
        {
          type: 'text',
          text: formattedResult,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to analyze frontend insights:', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Frontend insights analysis failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

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

// Export the tool, handler, and schema
export { frontendInsightsTool, handleFrontendInsights, FRONTEND_INSIGHTS_SCHEMA };
