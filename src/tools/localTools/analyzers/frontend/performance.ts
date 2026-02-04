/**
 * @fileOverview: Performance analyzer for React applications
 * @module: PerformanceAnalyzer
 * @keyFunctions:
 *   - analyzePerformance(): Analyze performance issues and optimization opportunities
 *   - buildPerRouteAnalysis(): Build client-only import graphs per route
 *   - detectHeavyImports(): Identify heavy client-side imports
 *   - detectDynamicImportCandidates(): Find imports that should use dynamic loading
 *   - detectMissingSuspenseBoundaries(): Identify routes missing loading/error boundaries
 * @context: Detects performance bottlenecks, heavy imports, and missing optimizations
 */

import { readFile } from 'fs/promises';
import * as path from 'path';
import type { FileInfo } from '../../../../core/compactor/fileDiscovery';
import { logger } from '../../../../utils/logger';
import type { ComponentInfo } from './components';
import { toPosixPath } from './router';
import { buildModuleGraph } from './graph';

export interface PerformanceIssue {
  file: string;
  import: string;
  sizeHint?: string;
  recommendation: string;
  severity: 'high' | 'medium' | 'low';
}

export interface DependencyWeight {
  name: string;
  sizeKB: number;
  category: string;
}

export interface RoutePerformance {
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
}

export interface PerformanceAnalysis {
  heavyClientImports: PerformanceIssue[];
  noDynamicImportCandidates: string[];
  missingSuspenseBoundaries: string[];
  imagesWithoutNextImage: Array<{ file: string; line: number; element: string }>;
  perRouteAnalysis: RoutePerformance[];
  dependencyWeights: Map<string, DependencyWeight>;
}

/**
 * Load dependency weights from weights.json
 */
async function loadDependencyWeights(): Promise<Map<string, DependencyWeight>> {
  try {
    const weightsPath = path.join(__dirname, 'weights.json');
    const weightsContent = await readFile(weightsPath, 'utf-8');
    const weightsData = JSON.parse(weightsContent);

    const weights = new Map<string, DependencyWeight>();

    // Load individual dependencies
    for (const [name, sizeKB] of Object.entries(weightsData.dependencies)) {
      weights.set(name, {
        name,
        sizeKB: sizeKB as number,
        category: 'other',
      });
    }

    // Assign categories
    for (const [category, patterns] of Object.entries(weightsData.categories)) {
      for (const pattern of patterns as string[]) {
        for (const [depName, weight] of weights) {
          if (depName.includes(pattern.replace('/', '').replace('*', ''))) {
            weight.category = category;
          }
        }
      }
    }

    return weights;
  } catch (error) {
    logger.warn('Failed to load dependency weights, using defaults', { error });
    const defaults: Array<[string, number, string]> = [
      ['@radix-ui/react-select', 45, 'radix'],
      ['recharts', 200, 'charts'],
      ['date-fns', 80, 'date-libraries'],
      ['lodash', 70, 'utility-libraries'],
      ['monaco-editor', 7000, 'editors'],
      ['three', 600, '3d'],
    ];
    const map = new Map<string, DependencyWeight>();
    defaults.forEach(([name, sizeKB, category]) => map.set(name, { name, sizeKB, category }));
    return map;
  }
}

/**
 * Extract imports from a file
 */
async function extractImports(filePath: string): Promise<string[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const imports: string[] = [];

    // Match ES6 imports
    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Match dynamic imports
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Match require statements
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return [...new Set(imports)]; // Remove duplicates
  } catch (error) {
    logger.debug('Failed to extract imports from file', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Build per-route performance analysis
 */
async function buildPerRouteAnalysis(
  files: FileInfo[],
  components: ComponentInfo[],
  dependencyWeights: Map<string, DependencyWeight>
): Promise<RoutePerformance[]> {
  const routeAnalysis: RoutePerformance[] = [];

  // Group files by route
  const routeGroups = new Map<string, FileInfo[]>();

  // Group strictly by page files under app/**/page.(t|j)sx
  for (const file of files) {
    const rel = file.relPath.replace(/\\/g, '/');
    if (!/(\.tsx|\.jsx)$/.test(rel)) continue;
    const isPage = /(^|\/)app\/.+\/page\.(tsx|jsx|ts|js)$/.test(rel);
    if (!isPage) continue;

    // Build the route path from directory structure, stripping groups and parallel slots
    const routeDir = rel.replace(/^.*?app\//, '').replace(/\/page\.(tsx|jsx|ts|js)$/, '');
    const segments = routeDir
      .split('/')
      .filter(Boolean)
      .filter(seg => !/^\(.*\)$/.test(seg) && !seg.startsWith('@'));
    const route = '/' + segments.join('/');
    const existingGroup = routeGroups.get(route);
    if (existingGroup) {
      existingGroup.push(file);
    } else {
      routeGroups.set(route, [file]);
    }
  }

  // Build shared module graph for accurate traversal
  const { imports, reverse } = await buildModuleGraph(files, process.cwd());

  // Compute client classification via propagation
  const hasUseClient = new Set<string>();
  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;
    try {
      const content = await readFile(file.absPath, 'utf-8');
      if (content.includes("'use client'") || content.includes('"use client"')) {
        hasUseClient.add(file.relPath.replace(/\\/g, '/'));
      }
    } catch (error) {
      logger.debug('Failed to inspect file for client directive during performance analysis', {
        file: toPosixPath(file.relPath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const clientSet = new Set<string>([
    ...hasUseClient,
    ...components.filter(c => c.kind === 'client').map(c => c.file.replace(/\\/g, '/')),
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [mod, importers] of reverse) {
      if (!clientSet.has(mod) && Array.from(importers).some(i => clientSet.has(i))) {
        clientSet.add(mod);
        changed = true;
      }
    }
  }

  // Analyze each route
  for (const [routePath, routeFiles] of routeGroups) {
    const routePerf: RoutePerformance = {
      path: routePath,
      totalSizeKB: 0,
      clientSizeKB: 0,
      topDeps: [],
      splitCandidates: [],
      clientComponents: [],
      serverComponents: [],
    };

    const depUsage = new Map<string, { sizeKB: number; category: string; usedIn: Set<string> }>();
    const componentDeps = new Map<string, string[]>();

    // Analyze each file in the route
    // For each route, start at the page file and traverse only client nodes reachable from the page
    const pageFiles = routeFiles.filter(f =>
      /(^|\/)app\/.+\/page\.(tsx|jsx|ts|js)$/.test(f.relPath.replace(/\\/g, '/'))
    );
    for (const pageFile of pageFiles) {
      const queue: string[] = [pageFile.relPath];
      const visited = new Set<string>();
      while (queue.length) {
        const current = queue.shift();
        if (!current) {
          continue;
        }
        const relPath = toPosixPath(current);
        if (visited.has(relPath)) continue;
        visited.add(relPath);
        const f = files.find(ff => ff.relPath.replace(/\\/g, '/') === relPath);
        if (!f) continue;
        const fRel = f.relPath.replace(/\\/g, '/');
        const isClientComponent = clientSet.has(fRel);
        if (isClientComponent) {
          if (!routePerf.clientComponents.includes(fRel)) routePerf.clientComponents.push(fRel);
        } else {
          if (!routePerf.serverComponents.includes(fRel)) routePerf.serverComponents.push(fRel);
        }

        // Extract imports for dependency attribution
        const impList = await extractImports(f.absPath);
        componentDeps.set(fRel, impList);

        for (const importPath of impList) {
          for (const [depName, weight] of dependencyWeights) {
            if (importPath === depName || importPath.startsWith(`${depName}/`)) {
              let usageEntry = depUsage.get(depName);
              if (!usageEntry) {
                usageEntry = {
                  sizeKB: weight.sizeKB,
                  category: weight.category,
                  usedIn: new Set<string>(),
                };
                depUsage.set(depName, usageEntry);
              }
              usageEntry.usedIn.add(fRel);
              break;
            }
          }
        }

        // Follow only local module imports from the graph
        const next = imports.get(relPath);
        if (next) {
          for (const child of next) {
            // Enqueue regardless; classification will decide if it counts toward client or server
            if (!visited.has(child)) queue.push(child);
          }
        }
      }
    }

    // Calculate sizes
    let totalSize = 0;
    let clientSize = 0;

    for (const usage of depUsage.values()) {
      totalSize += usage.sizeKB;

      // Check if used in client components
      const usedInClient = Array.from(usage.usedIn).some(file =>
        routePerf.clientComponents.includes(file)
      );

      if (usedInClient) {
        clientSize += usage.sizeKB;
      }
    }

    routePerf.totalSizeKB = totalSize;
    routePerf.clientSizeKB = clientSize;

    // Find top dependencies (by size, limit to top 10)
    routePerf.topDeps = Array.from(depUsage.entries())
      .sort((a, b) => b[1].sizeKB - a[1].sizeKB)
      .slice(0, 10)
      .map(([name, usage]) => ({
        name,
        sizeKB: usage.sizeKB,
        category: usage.category,
        usedIn: Array.from(usage.usedIn),
      }));

    // Find split candidates (components with heavy deps that could be lazy loaded)
    for (const [component, deps] of componentDeps) {
      const heavyDeps = deps.filter(dep => {
        for (const [depName, weight] of dependencyWeights) {
          if ((dep === depName || dep.startsWith(depName + '/')) && weight.sizeKB > 100) {
            return true;
          }
        }
        return false;
      });

      if (heavyDeps.length > 0) {
        const potentialSavings = heavyDeps.reduce((sum, dep) => {
          for (const [depName, weight] of dependencyWeights) {
            if (dep === depName || dep.startsWith(depName + '/')) {
              return sum + weight.sizeKB;
            }
          }
          return sum;
        }, 0);

        if (potentialSavings > 50) {
          // Only suggest if savings > 50KB
          routePerf.splitCandidates.push({
            component,
            heavyDeps,
            recommendation: `Use next/dynamic with ssr: false for ${component}`,
            potentialSavingsKB: potentialSavings,
          });
        }
      }
    }

    routeAnalysis.push(routePerf);
  }

  return routeAnalysis.sort((a, b) => b.totalSizeKB - a.totalSizeKB);
}

/**
 * Heavy libraries that should be dynamically imported
 */
const HEAVY_LIBRARIES = [
  'monaco-editor',
  'three',
  'chart.js',
  'd3',
  'xlsx',
  'pdfjs-dist',
  'highlight.js',
  '@codemirror/',
  'react-ace',
  'recharts',
  'echarts',
  'react-pdf',
  'react-table',
  'ag-grid',
  'react-virtualized',
  'react-window',
  'framer-motion',
  'react-spring',
  'react-transition-group',
  'react-beautiful-dnd',
  'react-dnd',
  'react-color',
  'react-datepicker',
  'react-select',
  'react-draft-wysiwyg',
  'leaflet',
  'mapbox-gl',
  'react-leaflet',
  'react-map-gl',
  'video.js',
  'plyr',
  'hls.js',
  'react-player',
  'swiper',
  'react-slick',
  'react-responsive-carousel',
];

/**
 * Detect heavy imports in client components
 */
async function detectHeavyImports(
  files: FileInfo[],
  components: ComponentInfo[]
): Promise<PerformanceIssue[]> {
  const issues: PerformanceIssue[] = [];

  for (const file of files) {
    // Only check client components and files
    const isClientComponent = components.some(
      comp => comp.file === file.relPath && comp.kind === 'client'
    );

    const hasUseClient = file.relPath.endsWith('.tsx') || file.relPath.endsWith('.jsx');

    if (!isClientComponent && !hasUseClient) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');

      // Check for heavy library imports
      for (const heavyLib of HEAVY_LIBRARIES) {
        const importRegex = new RegExp(`import.*from\\s+['"]([^'"]*${heavyLib}[^'"]*)['"]`, 'g');
        const dynamicImportRegex = new RegExp(
          `import\\s*\\(\\s*['"]([^'"]*${heavyLib}[^'"]*)['"]`,
          'g'
        );

        let match;
        while ((match = importRegex.exec(content)) !== null) {
          const importPath = match[1];

          // Check if it's already using dynamic import
          const hasDynamicImport = dynamicImportRegex.test(content);

          if (!hasDynamicImport) {
            issues.push({
              file: toPosixPath(file.relPath),
              import: importPath,
              sizeHint: getLibrarySizeHint(heavyLib),
              recommendation: `Use next/dynamic with ssr: false for ${heavyLib}`,
              severity: 'high',
            });
          }
        }
      }

      // Check for large bundle imports
      const largeBundlePatterns = [
        { pattern: /import.*from\s+['"]([^'"]*lodash[^'"]*)['"]/g, hint: '~70KB' },
        { pattern: /import.*from\s+['"]([^'"]*moment[^'"]*)['"]/g, hint: '~250KB' },
        { pattern: /import.*from\s+['"]([^'"]*jquery[^'"]*)['"]/g, hint: '~30KB' },
        { pattern: /import.*from\s+['"]([^'"]*bootstrap[^'"]*)['"]/g, hint: '~150KB' },
      ];

      for (const { pattern, hint } of largeBundlePatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const importPath = match[1];
          issues.push({
            file: toPosixPath(file.relPath),
            import: importPath,
            sizeHint: hint,
            recommendation: `Consider lazy loading or tree-shaking for ${importPath}`,
            severity: 'medium',
          });
        }
      }
    } catch (error) {
      logger.debug('Failed to analyze heavy imports for file', {
        file: toPosixPath(file.relPath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return issues;
}

/**
 * Get size hint for known heavy libraries
 */
function getLibrarySizeHint(library: string): string {
  const sizeMap: Record<string, string> = {
    'monaco-editor': '~7MB',
    three: '~600KB',
    'chart.js': '~200KB',
    d3: '~250KB',
    xlsx: '~150KB',
    'pdfjs-dist': '~1.5MB',
    'highlight.js': '~50KB',
    '@codemirror/': '~300KB',
    'react-ace': '~150KB',
    recharts: '~200KB',
    echarts: '~800KB',
    leaflet: '~150KB',
    'mapbox-gl': '~800KB',
    'react-leaflet': '~50KB',
    'react-map-gl': '~300KB',
    'video.js': '~200KB',
    plyr: '~100KB',
    'hls.js': '~150KB',
    'react-player': '~100KB',
    swiper: '~150KB',
    'react-slick': '~50KB',
    'react-responsive-carousel': '~30KB',
  };

  for (const [key, size] of Object.entries(sizeMap)) {
    if (library.includes(key.replace('/', ''))) {
      return size;
    }
  }

  return '~100KB+';
}

/**
 * Detect images not using Next.js Image component
 */
async function detectImagesWithoutNextImage(
  files: FileInfo[]
): Promise<Array<{ file: string; line: number; element: string }>> {
  const issues: Array<{ file: string; line: number; element: string }> = [];

  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const imgRegex = /<img\s+[^>]*>/g;
        let match;
        while ((match = imgRegex.exec(line)) !== null) {
          if (!line.includes('<Image') && !line.includes('next/image')) {
            issues.push({
              file: toPosixPath(file.relPath),
              line: index + 1,
              element: match[0],
            });
          }
        }
      });
    } catch (error) {
      logger.debug('Failed to analyze image usage for file', {
        file: toPosixPath(file.relPath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return issues;
}

/**
 * Detect routes missing suspense boundaries
 */
async function detectMissingSuspenseBoundaries(files: FileInfo[]): Promise<string[]> {
  const routeDirs: Set<string> = new Set();
  const routesWithDataFetching: Set<string> = new Set();
  const routesWithBoundaries: Set<string> = new Set();

  // Find all page route directories (exclude app/api/**)
  for (const file of files) {
    const rel = file.relPath.replace(/\\/g, '/');
    if (rel.includes('/page.') && !rel.includes('/app/api/')) {
      const routeDir = path.dirname(file.relPath);
      routeDirs.add(routeDir);
    }
  }

  // Check for data fetching patterns
  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const routeDir = path.dirname(file.relPath);

      if (routeDirs.has(routeDir)) {
        const hasDataFetching = /useQuery|useSWR|fetch\(|axios\./.test(content);

        if (hasDataFetching) {
          routesWithDataFetching.add(routeDir);
        }
      }
    } catch (error) {
      logger.debug('Failed to inspect suspense boundaries for route file', {
        file: toPosixPath(file.relPath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Check for loading/error boundaries (exclude app/api/**)
  for (const file of files) {
    const rel = file.relPath.replace(/\\/g, '/');
    const fileName = path.basename(rel);
    if ((fileName === 'loading.tsx' || fileName === 'error.tsx') && !rel.includes('/app/api/')) {
      const routeDir = path.dirname(rel);
      routesWithBoundaries.add(routeDir);
    }
  }

  // Find routes with data fetching but no boundaries
  const missingBoundaries: string[] = [];
  for (const route of routesWithDataFetching) {
    if (!routesWithBoundaries.has(route)) {
      missingBoundaries.push(route);
    }
  }

  return missingBoundaries;
}

/**
 * Analyze performance issues in files
 */
export async function analyzePerformance(
  files: FileInfo[],
  components: ComponentInfo[]
): Promise<PerformanceAnalysis> {
  logger.info(`⚡ Analyzing performance issues in ${files.length} files`);

  // Load dependency weights
  const dependencyWeights = await loadDependencyWeights();

  // Run all performance checks in parallel
  const [heavyClientImports, imagesWithoutNextImage, missingSuspenseBoundaries, perRouteAnalysis] =
    await Promise.all([
      detectHeavyImports(files, components),
      detectImagesWithoutNextImage(files),
      detectMissingSuspenseBoundaries(files),
      buildPerRouteAnalysis(files, components, dependencyWeights),
    ]);

  // Find dynamic import candidates (files with heavy imports but no dynamic loading)
  const noDynamicImportCandidates: string[] = [];
  const filesWithHeavyImports = new Set(heavyClientImports.map(issue => issue.file));

  for (const file of filesWithHeavyImports) {
    try {
      const fileInfo = files.find(f => f.relPath === file);
      if (fileInfo) {
        const content = await readFile(fileInfo.absPath, 'utf-8');
        const hasDynamicImport = /import\s*\(/.test(content);

        if (!hasDynamicImport) {
          noDynamicImportCandidates.push(file);
        }
      }
    } catch (error) {
      logger.debug('Failed to determine dynamic import usage for file', {
        file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const analysis: PerformanceAnalysis = {
    heavyClientImports,
    noDynamicImportCandidates,
    missingSuspenseBoundaries,
    imagesWithoutNextImage,
    perRouteAnalysis,
    dependencyWeights,
  };

  logger.info(
    `⚡ Performance analysis complete: ${heavyClientImports.length} heavy imports, ${missingSuspenseBoundaries.length} missing boundaries, ${imagesWithoutNextImage.length} non-optimized images, ${perRouteAnalysis.length} routes analyzed`
  );
  return analysis;
}
