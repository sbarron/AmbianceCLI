import * as path from 'path';
import { logger } from '../../utils/logger';
import { validateAndResolvePath } from '../utils/pathUtils';
import { FileDiscovery, FileInfo } from '../../core/compactor/fileDiscovery';
import { formatFrontendInsights } from '../../tools/localTools/formatters/frontendInsightsFormatters';
import { analyzeRoutes } from '../../tools/localTools/analyzers/frontend/router';
import { analyzeComponents } from '../../tools/localTools/analyzers/frontend/components';
import { analyzeDataFlow } from '../../tools/localTools/analyzers/frontend/dataFlow';
import type { FrontendInsights } from '../../tools/localTools/frontendInsights';

function analyzeFileComposition(
  allFiles: FileInfo[],
  frontendFiles: FileInfo[]
): FrontendInsights['summary']['fileComposition'] {
  const byType: Record<string, number> = {};
  const filteredOut: Record<string, number> = {};

  for (const file of allFiles) {
    const ext = file.ext || path.extname(file.relPath).toLowerCase() || 'no-extension';
    byType[ext] = (byType[ext] || 0) + 1;
  }

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

export async function handleFrontendInsights(args: any): Promise<any> {
  const { projectPath, format = 'structured', subtree = 'web/app', maxFiles = 2000 } = args;

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
    const fileDiscovery = new FileDiscovery(resolvedProjectPath);
    const allFiles = await fileDiscovery.discoverFiles();

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

    const fileComposition = analyzeFileComposition(allFiles, frontendFiles);

    let effectiveSubtree = subtree;
    if (subtree === 'web/app' || subtree === 'app') {
      const appPatterns = ['app', 'src/app', 'web/app', 'pages', 'src/pages'];
      let detectedAppDir: string | null = null;

      for (const pattern of appPatterns) {
        const testPath = path.join(resolvedProjectPath, pattern);
        const filesInPattern = frontendFiles.filter(file => file.absPath.startsWith(testPath));
        if (filesInPattern.length > 0) {
          const pageFiles = filesInPattern.filter(file => {
            const relPath = file.relPath;
            if (pattern.includes('pages')) {
              return (
                /\.(js|jsx|ts|tsx)$/.test(relPath) &&
                !relPath.includes('/api/') &&
                !relPath.includes('/_') &&
                !relPath.includes('/page.') &&
                !relPath.includes('/layout.') &&
                !relPath.includes('/route.')
              );
            }

            return relPath.includes('/page.');
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
        effectiveSubtree = '.';
        logger.info(`🔍 No specific app directory detected, analyzing entire project`);
      }
    }

    const targetPath = path.join(resolvedProjectPath, effectiveSubtree);
    const subtreeFiles = frontendFiles.filter(
      file => effectiveSubtree === '.' || file.absPath.startsWith(targetPath)
    );

    const filesToAnalyze =
      subtreeFiles.length > 0 ? subtreeFiles.slice(0, maxFiles) : frontendFiles.slice(0, maxFiles);

    logger.info(`📁 Analyzing ${filesToAnalyze.length} files in frontend`);

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

    try {
      logger.info('🛣️  Analyzing routes');
      const appDir = effectiveSubtree === '.' ? 'app' : effectiveSubtree;
      const routeAnalysis = await analyzeRoutes(filesToAnalyze, appDir);

      let totalPages = 0;

      if (Array.isArray(routeAnalysis)) {
        insights.routes = { pages: routeAnalysis as any, handlers: [] };
        const appRouterPages = routeAnalysis.filter((route: any) => route.files?.page).length;
        totalPages += appRouterPages;
      } else if (routeAnalysis && typeof routeAnalysis === 'object') {
        insights.routes = routeAnalysis as any;
        totalPages += (routeAnalysis as any).pages?.length || 0;
      } else {
        insights.routes = { pages: [], handlers: [] };
      }

      const pagesRouterPages = filesToAnalyze.filter(file => {
        const relPath = file.relPath.replace(/\\/g, '/');
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
