/**
 * @fileOverview: Component analyzer for React/Next.js component detection and analysis
 * @module: ComponentsAnalyzer
 * @keyFunctions:
 *   - analyzeComponents(): Analyze React components with AST parsing
 *   - detectComponentKind(): Determine if component is client or server
 *   - extractComponentFeatures(): Extract hooks, props, and UI features
 * @context: Detects React components, their types, and usage patterns
 */

import { readFile } from 'fs/promises';
import type { FileInfo } from '../../../../core/compactor/fileDiscovery';
import { logger } from '../../../../utils/logger';
import type { ASTParser } from '../../../../core/compactor/astParser';
import { toPosixPath } from './router';

export interface ComponentInfo {
  name: string;
  file: string;
  kind: 'client' | 'server';
  props?: { declaredAt?: string; count?: number };
  uses: { forms?: boolean; tables?: boolean; modals?: boolean };
  hooks: string[];
}

/**
 * Detect if a file is client or server component based on directives and imports
 */
export function detectComponentKind(content: string): 'client' | 'server' {
  // Check for explicit client directive
  if (content.includes("'use client'") || content.includes('"use client"')) {
    return 'client';
  }

  // Check for client-side APIs that require client rendering
  const clientAPIs = [
    'useState',
    'useEffect',
    'useRef',
    'useLayoutEffect',
    'useCallback',
    'useMemo',
    'useContext',
    'useReducer',
    'useImperativeHandle',
    'useDebugValue',
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'navigator.storage',
    'caches',
    'AsyncStorage',
    'SecuredStorage',
    'SecureStore',
    'addEventListener',
    'removeEventListener',
    'setTimeout',
    'setInterval',
    'onClick',
    'onChange',
    'onSubmit',
    'onMouse',
    'onKey',
  ];

  for (const api of clientAPIs) {
    if (content.includes(api)) {
      return 'client';
    }
  }

  // Default to server component
  return 'server';
}

/**
 * Extract component information from file content
 */
async function extractComponentInfo(
  file: FileInfo,
  astParser?: ASTParser
): Promise<ComponentInfo[]> {
  const components: ComponentInfo[] = [];

  // Skip route handlers - they are not components (normalize separators)
  const rel = toPosixPath(file.relPath);
  if (rel.includes('/route.')) {
    return components;
  }

  try {
    const content = await readFile(file.absPath, 'utf-8');
    const kind = detectComponentKind(content);

    // Simple regex-based component detection for now
    // TODO: Replace with AST parsing for more accurate detection

    // Match function components
    const functionPattern =
      /(?:export\s+)?(?:const|function)\s+([A-Z][a-zA-Z0-9]*)\s*(?:\([^)]*\))?\s*(?:=>\s*)?{/g;
    const arrowPattern =
      /(?:export\s+)?const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*(?:\([^)]*\)\s*=>|function)/g;

    const componentNames = new Set<string>();

    // Extract function component names
    let match;
    while ((match = functionPattern.exec(content)) !== null) {
      componentNames.add(match[1]);
    }

    // Reset regex and extract arrow function components
    arrowPattern.lastIndex = 0;
    while ((match = arrowPattern.exec(content)) !== null) {
      componentNames.add(match[1]);
    }

    // Create component info for each detected component
    for (const name of componentNames) {
      const component: ComponentInfo = {
        name,
        file: toPosixPath(file.relPath),
        kind,
        uses: {},
        hooks: [],
      };

      // Extract hooks used in this component
      const hookPattern = /\b(use[A-Z][a-zA-Z0-9]*)\s*\(/g;
      const hooks = new Set<string>();
      while ((match = hookPattern.exec(content)) !== null) {
        hooks.add(match[1]);
      }
      component.hooks = Array.from(hooks);

      // Detect UI features
      component.uses.forms = /<form|onSubmit=|type="submit"/.test(content);
      component.uses.tables = /<table|<Table|<DataTable/.test(content);
      component.uses.modals = /<Modal|<Dialog|<AlertDialog|<Sheet/.test(content);

      components.push(component);
    }
  } catch (error) {
    logger.warn(`Failed to analyze components in ${file.relPath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return components;
}

/**
 * Analyze components across all files
 */
export async function analyzeComponents(
  files: FileInfo[],
  astParser?: ASTParser
): Promise<ComponentInfo[]> {
  const allComponents: ComponentInfo[] = [];

  logger.info(`🔍 Analyzing components in ${files.length} files`);

  // Process files in batches to avoid memory issues
  const batchSize = 50;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchPromises = batch.map(file => extractComponentInfo(file, astParser));
    const batchResults = await Promise.all(batchPromises);
    allComponents.push(...batchResults.flat());
  }

  // Sort by file path for consistency
  allComponents.sort((a, b) => a.file.localeCompare(b.file));

  logger.info(
    `⚛️ Detected ${allComponents.length} components (${allComponents.filter(c => c.kind === 'client').length} client, ${allComponents.filter(c => c.kind === 'server').length} server)`
  );
  return allComponents;
}

/**
 * Group components by their containing files/routes
 */
export function groupComponentsByRoute(
  components: ComponentInfo[],
  routes: Array<{ path: string; files: Record<string, string> }>
): Record<string, ComponentInfo[]> {
  const grouped: Record<string, ComponentInfo[]> = {};

  for (const component of components) {
    // Find which route this component belongs to
    let routePath = '/'; // Default to root

    for (const route of routes) {
      // Check if component file is under this route's directory
      const routeFiles = Object.values(route.files).filter(Boolean);
      const componentDir = component.file.substring(0, component.file.lastIndexOf('/'));

      for (const routeFile of routeFiles) {
        const routeDir = routeFile.substring(0, routeFile.lastIndexOf('/'));
        if (componentDir.startsWith(routeDir)) {
          routePath = route.path;
          break;
        }
      }
      if (routePath !== '/') break;
    }

    if (!grouped[routePath]) {
      grouped[routePath] = [];
    }
    grouped[routePath].push(component);
  }

  return grouped;
}
