/**
 * @fileOverview: Data flow analyzer for React applications
 * @module: DataFlowAnalyzer
 * @keyFunctions:
 *   - analyzeDataFlow(): Analyze data fetching patterns, endpoints, and query libraries
 *   - detectQueryLibraries(): Identify React Query, SWR, and other data libraries
 *   - extractEndpoints(): Extract API endpoints from fetch/axios calls
 * @context: Detects data flow patterns, query libraries, and API endpoint usage
 */

import { readFile } from 'fs/promises';
import type { FileInfo } from '../../../../core/compactor/fileDiscovery';
import { logger } from '../../../../utils/logger';
import { nameFor, generateUniqueMethodName } from './naming';
import type { ComponentInfo } from './components';

export interface EndpointCall {
  method: string;
  path: string;
  normalizedPath: string;
  fingerprint: string; // METHOD + PATH + sorted(body keys)
  params?: string[];
  bodyKeys?: string[];
  component: string;
  file: string;
  line: number;
  context: string;
}

export interface DataFlowGraph {
  component: string;
  hook?: string;
  callsite: string;
  endpoint: EndpointCall;
}

export interface DuplicateEndpoint {
  fingerprint: string;
  method: string;
  path: string;
  count: number;
  files: string[];
  suggestion: string;
}

export interface TypeDefinition {
  name: string;
  kind: 'interface' | 'type' | 'class';
  content: string;
  file: string;
  line: number;
  exported: boolean;
}

export interface DataFlowAnalysis {
  endpoints: Array<{ path: string; usedBy: string[]; method?: string }>;
  queries: Array<{ lib: 'react-query' | 'swr' | 'fetch'; key?: string; usedBy: string[] }>;
  stores: Array<{
    lib: 'zustand' | 'redux' | 'context' | 'jotai' | 'recoil';
    file: string;
    usedBy: string[];
  }>;
  // Enhanced data structures
  endpointCalls: EndpointCall[];
  dataFlowGraph: DataFlowGraph[];
  duplicateEndpoints: DuplicateEndpoint[];
  typeDefinitions: TypeDefinition[];
}

/**
 * Detect data libraries from imports
 */
function detectDataLibraries(content: string): {
  hasReactQuery: boolean;
  hasSWR: boolean;
  hasAxios: boolean;
  hasFetch: boolean;
} {
  const imports = content.match(/import\s+.*from\s+['"][^'"]+['"]/g) || [];
  const importStatements = content.match(/import\s*{[^}]*}\s+from\s+['"][^'"]+['"]/g) || [];

  let hasReactQuery = false;
  let hasSWR = false;
  let hasAxios = false;
  let hasFetch = false;

  // Check package imports
  for (const imp of imports) {
    if (imp.includes('@tanstack/react-query') || imp.includes('react-query')) hasReactQuery = true;
    if (imp.includes('swr')) hasSWR = true;
    if (imp.includes('axios')) hasAxios = true;
  }

  // Check named imports for more specific detection
  for (const imp of importStatements) {
    if (
      imp.includes('useQuery') ||
      imp.includes('useMutation') ||
      imp.includes('useInfiniteQuery') ||
      imp.includes('QueryClient')
    ) {
      hasReactQuery = true;
    }
    if (imp.includes('useSWR') || imp.includes('useSWRInfinite') || imp.includes('SWRConfig')) {
      hasSWR = true;
    }
  }

  // Heuristics for axios factory and wrappers
  if (/axios\.create\s*\(/.test(content) || /\bAxios\b/.test(content)) hasAxios = true;
  if (/from\s+['"]ky['"]/.test(content) || /createApiClient\s*\(/.test(content)) hasFetch = true;
  // Check for fetch usage
  if (content.includes('fetch(') || content.includes('window.fetch')) hasFetch = true;

  return { hasReactQuery, hasSWR, hasAxios, hasFetch };
}

/**
 * Normalize endpoint paths by converting template strings to parameter placeholders
 */
function normalizeEndpointPath(path: string): string {
  // Return empty string for invalid paths
  if (!path || typeof path !== 'string') {
    return '';
  }

  // Remove query parameters and fragments
  let normalizedPath = path.split('?')[0].split('#')[0];

  // Strip surrounding quotes/backticks
  normalizedPath = normalizedPath.replace(/^[`'\"]/, '').replace(/[`'\"]$/, '');

  // Skip if path is just a protocol or becomes empty after processing
  if (!normalizedPath || normalizedPath === 'https' || normalizedPath === 'http') {
    return '';
  }

  // Handle external API URLs (keep them as-is)
  if (normalizedPath.match(/^https?:\/\//)) {
    // Fix malformed external URLs like "https:/api..." -> "https://api..."
    normalizedPath = normalizedPath.replace(/^https?:\/([^/])/, 'https://$1');
    return normalizedPath;
  }

  // Convert template literals ${variable} to :variable
  normalizedPath = normalizedPath.replace(/\$\{([^}]+)\}/g, ':$1');

  // Handle common base URL patterns and localhost - be more conservative
  normalizedPath = normalizedPath.replace(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?/g, '');

  // Only remove base URL patterns if they appear at the start
  normalizedPath = normalizedPath.replace(/^\/?(:?[A-Z0-9_]*BASE_URL:?)/i, '');

  // Remove process.env references that might be at the start
  normalizedPath = normalizedPath.replace(/^\/?process\.env\.[A-Z0-9_]+/i, '');

  // Fix the most common malformed URL patterns
  // Pattern 1: /:/v1/... -> /api/v1/...
  normalizedPath = normalizedPath.replace(/^\/:\//, '/api/');

  // Pattern 2: :/v1/... -> /api/v1/...
  normalizedPath = normalizedPath.replace(/^:\//, '/api/');

  // Pattern 3: /v1/... (no leading /api) -> /api/v1/...
  if (normalizedPath.match(/^\/v[0-9]+\//) && !normalizedPath.startsWith('/api/')) {
    normalizedPath = '/api' + normalizedPath;
  }

  // Pattern 4: v1/... (no leading slash) -> /api/v1/...
  if (normalizedPath.match(/^v[0-9]+\//)) {
    normalizedPath = '/api/' + normalizedPath;
  }

  // Collapse duplicate slashes but preserve structure
  normalizedPath = normalizedPath.replace(/\/+/g, '/');

  // Ensure leading slash for internal API paths
  if (normalizedPath && !normalizedPath.startsWith('/') && !normalizedPath.match(/^https?:\/\//)) {
    normalizedPath = '/' + normalizedPath;
  }

  // Skip if path is still invalid after normalization
  if (!normalizedPath || normalizedPath === '/' || normalizedPath.length < 2) {
    return '';
  }

  // Skip paths that start with non-alphanumeric characters (except / and http)
  if (normalizedPath.match(/^\/[^a-zA-Z0-9]/) && !normalizedPath.match(/^https?:\/\//)) {
    return '';
  }

  return normalizedPath;
}

/**
 * Extract API endpoints from fetch and axios calls
 */
function extractEndpoints(content: string): Array<{ path: string; method?: string }> {
  const endpoints: Array<{ path: string; method?: string }> = [];

  // Match fetch calls with method detection
  const fetchPatterns = [
    // fetch(url, { method: 'POST' })
    {
      regex: /fetch\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*{\s*method:\s*['"`]([^'"`]+)['"`]/gi,
      methodIndex: 2,
    },
    // fetch(url) - default GET
    { regex: /fetch\s*\(\s*['"`]([^'"`]+)['"`]\s*(?:\)|,)/g, methodIndex: null },
    // Template literals
    { regex: /fetch\s*\(\s*`([^`]+)`\s*(?:\)|,)/g, methodIndex: null },
    // Variables
    { regex: /fetch\s*\(\s*([^,\s)]+)\s*(?:\)|,)/g, methodIndex: null },
  ];

  for (const pattern of fetchPatterns) {
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      const url = match[1];
      const detectedMethod = pattern.methodIndex ? match[pattern.methodIndex] : null;
      const method = detectedMethod ? detectedMethod.toUpperCase() : 'GET';

      // Include external API URLs, internal API paths, and template strings
      if (
        url &&
        (url.startsWith('/api/') ||
          url.startsWith('http') ||
          url.includes('${') ||
          url.includes(':/'))
      ) {
        const normalizedPath = normalizeEndpointPath(url);
        if (normalizedPath) {
          // Only add if normalization succeeded
          endpoints.push({ path: normalizedPath, method });
        }
      }
    }
  }

  // Match axios calls - more comprehensive patterns
  const axiosPatterns = [
    /axios\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /axios\.(get|post|put|patch|delete|head|options)\s*\(\s*`([^`]+)`/gi,
    /axios\s*\(\s*{\s*method:\s*['"`]([^'"`]+)['"`][^}]*url:\s*['"`]([^'"`]+)['"`]/gi,
    /axios\s*\(\s*{\s*url:\s*['"`]([^'"`]+)['"`][^}]*method:\s*['"`]([^'"`]+)['"`]/gi,
    /axios\.create\s*\([^)]*\)\s*\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  ];

  for (const pattern of axiosPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const method = (match[1] || match[3] || match[5]).toUpperCase();
      const url = match[2] || match[4] || match[6];
      if (
        url &&
        (url.startsWith('/api/') ||
          url.startsWith('http') ||
          url.includes('${') ||
          url.includes(':/'))
      ) {
        const normalizedPath = normalizeEndpointPath(url);
        if (normalizedPath) {
          // Only add if normalization succeeded
          endpoints.push({ path: normalizedPath, method });
        }
      }
    }
  }

  // Remove duplicates based on (method, path) combination
  const uniqueEndpoints = endpoints.filter(
    (endpoint, index, self) =>
      index === self.findIndex(e => e.method === endpoint.method && e.path === endpoint.path)
  );

  return uniqueEndpoints;
}

/**
 * Extract React Query patterns
 */
function extractReactQueryPatterns(
  content: string
): Array<{ key?: string; type: 'query' | 'mutation' | 'infinite' }> {
  const patterns: Array<{ key?: string; type: 'query' | 'mutation' | 'infinite' }> = [];

  // useQuery
  const useQueryRegex = /useQuery\s*\(\s*{[^}]*queryKey:\s*(\[[^\]]*\])/g;
  let match;
  while ((match = useQueryRegex.exec(content)) !== null) {
    patterns.push({ key: match[1], type: 'query' });
  }

  // useMutation
  const useMutationRegex = /useMutation\s*\(\s*{/g;
  if (useMutationRegex.test(content)) {
    patterns.push({ type: 'mutation' });
  }

  // useInfiniteQuery
  const useInfiniteQueryRegex = /useInfiniteQuery\s*\(\s*{/g;
  if (useInfiniteQueryRegex.test(content)) {
    patterns.push({ type: 'infinite' });
  }

  return patterns;
}

/**
 * Extract SWR patterns
 */
function extractSWRPatterns(content: string): Array<{ key?: string }> {
  const patterns: Array<{ key?: string }> = [];

  // useSWR
  const useSWRRegex = /useSWR\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = useSWRRegex.exec(content)) !== null) {
    patterns.push({ key: match[1] });
  }

  // useSWRInfinite
  const useSWRInfiniteRegex = /useSWRInfinite\s*\(/g;
  if (useSWRInfiniteRegex.test(content)) {
    patterns.push({ key: 'infinite' });
  }

  return patterns;
}

/**
 * Enhanced endpoint extraction with comprehensive pattern matching
 */
function extractEnhancedEndpoints(
  content: string,
  filePath: string,
  lineOffset: number = 0
): EndpointCall[] {
  const endpointCalls: EndpointCall[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const lineNumber = index + 1 + lineOffset;

    // Enhanced fetch detection with method detection
    const fetchPatterns = [
      // fetch(url, { method: 'POST' })
      {
        regex: /fetch\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*{\s*method:\s*['"`]([^'"`]+)['"`]/gi,
        methodIndex: 2,
      },
      // fetch(url, { method: 'POST', ... }) - handles additional options
      {
        regex: /fetch\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*{\s*method:\s*['"`]([^'"`]+)['"`][^}]*}/gi,
        methodIndex: 2,
      },
      // fetch(url) - default GET
      { regex: /fetch\s*\(\s*['"`]([^'"`]+)['"`]\s*(?:\)|,)/g, methodIndex: null },
      // Template literals
      { regex: /fetch\s*\(\s*`([^`]+)`\s*(?:\)|,)/g, methodIndex: null },
      // Template literals with options
      {
        regex: /fetch\s*\(\s*`([^`]+)`\s*,\s*\{[^}]*method:\s*['"`]([^'"`]+)['"`][^}]*\}/gi,
        methodIndex: 2,
      },
      // Variables
      { regex: /fetch\s*\(\s*([^,\s)]+)\s*(?:\)|,)/g, methodIndex: null },
    ];

    for (const pattern of fetchPatterns) {
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        const url = match[1];
        const detectedMethod = pattern.methodIndex ? match[pattern.methodIndex] : null;
        const method = detectedMethod ? detectedMethod.toUpperCase() : 'GET';

        // Include external API URLs, internal API paths, and template strings
        if (url && (url.startsWith('/api/') || url.startsWith('http') || url.includes('${'))) {
          const normalizedPath = normalizeEndpointPath(url);
          if (normalizedPath) {
            // Only add if normalization succeeded
            const fingerprint = `${method}:${normalizedPath}`;
            const componentName = extractComponentName(content, lineNumber);
            const params = extractPathParams(normalizedPath);

            endpointCalls.push({
              method,
              path: url,
              normalizedPath,
              fingerprint,
              params: params.length > 0 ? params : undefined,
              component: componentName,
              file: filePath,
              line: lineNumber,
              context: line.trim().substring(0, 80) + (line.length > 80 ? '...' : ''),
            });
          }
        }
      }
    }

    // Enhanced axios detection with better method extraction
    const axiosPatterns = [
      // Direct method calls: axios.get/post/put/delete(url, config?)
      {
        regex: /axios\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        methodIndex: 1,
        urlIndex: 2,
      },
      // Template literals: axios.post(`url`, data)
      {
        regex: /axios\.(get|post|put|patch|delete|head|options)\s*\(\s*`([^`]+)`/gi,
        methodIndex: 1,
        urlIndex: 2,
      },
      // Template literals with data: axios.post(`url`, data, config)
      {
        regex: /axios\.(get|post|put|patch|delete|head|options)\s*\(\s*`([^`]+)`\s*,/gi,
        methodIndex: 1,
        urlIndex: 2,
      },
      // Generic axios call with method first: axios({ method: 'POST', url: '...' })
      {
        regex: /axios\s*\(\s*{\s*method:\s*['"`]([^'"`]+)['"`][^}]*url:\s*['"`]([^'"`]+)['"`]/gi,
        methodIndex: 1,
        urlIndex: 2,
      },
      // Generic axios call with url first: axios({ url: '...', method: 'POST' })
      {
        regex: /axios\s*\(\s*{\s*url:\s*['"`]([^'"`]+)['"`][^}]*method:\s*['"`]([^'"`]+)['"`]/gi,
        methodIndex: 2,
        urlIndex: 1,
      },
      // Template literal URLs in generic calls
      {
        regex: /axios\s*\(\s*{\s*method:\s*['"`]([^'"`]+)['"`][^}]*url:\s*`([^`]+)`/gi,
        methodIndex: 1,
        urlIndex: 2,
      },
      {
        regex: /axios\s*\(\s*{\s*url:\s*`([^`]+)`[^}]*method:\s*['"`]([^'"`]+)['"`]/gi,
        methodIndex: 2,
        urlIndex: 1,
      },
      // Axios instance calls: axiosInstance.post/get/put/delete
      {
        regex:
          /axios\.create\s*\([^)]*\)\s*\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        methodIndex: 1,
        urlIndex: 2,
      },
      // Custom axios instances: const api = axios.create(); api.post(...)
      {
        regex: /\b\w+\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        methodIndex: 1,
        urlIndex: 2,
      },
      // Custom axios instances with template literals
      {
        regex: /\b\w+\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*`([^`]+)`/gi,
        methodIndex: 1,
        urlIndex: 2,
      },
    ];

    for (const pattern of axiosPatterns) {
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        const method = match[pattern.methodIndex].toUpperCase();
        const url = match[pattern.urlIndex];
        if (
          url &&
          (url.startsWith('/api/') ||
            url.startsWith('http') ||
            url.includes('${') ||
            url.includes(':/'))
        ) {
          const normalizedPath = normalizeEndpointPath(url);
          if (normalizedPath) {
            // Only add if normalization succeeded
            const bodyKeys = extractBodyKeys(line);
            const fingerprint = `${method}:${normalizedPath}${bodyKeys.length > 0 ? `:${bodyKeys.sort().join(',')}` : ''}`;
            const componentName = extractComponentName(content, lineNumber);
            const params = extractPathParams(normalizedPath);

            endpointCalls.push({
              method,
              path: url,
              normalizedPath,
              fingerprint,
              params: params.length > 0 ? params : undefined,
              bodyKeys: bodyKeys.length > 0 ? bodyKeys : undefined,
              component: componentName,
              file: filePath,
              line: lineNumber,
              context: line.trim().substring(0, 80) + (line.length > 80 ? '...' : ''),
            });
          }
        }
      }
    }
  });

  return endpointCalls;
}

/**
 * Extract component name from surrounding context
 */
function extractComponentName(content: string, lineNumber: number): string {
  const lines = content.split('\n');
  const startLine = Math.max(0, lineNumber - 10);
  const endLine = Math.min(lines.length, lineNumber + 5);

  for (let i = startLine; i < endLine; i++) {
    // Look for function component declaration
    const functionMatch = lines[i].match(
      /(?:function|const|export\s+(?:default\s+)?)\s*([A-Z][a-zA-Z0-9]*)/
    );
    if (functionMatch) {
      return functionMatch[1];
    }

    // Look for class component
    const classMatch = lines[i].match(/class\s+([A-Z][a-zA-Z0-9]*)/);
    if (classMatch) {
      return classMatch[1];
    }
  }

  return 'Unknown';
}

/**
 * Extract body keys from axios/fetch calls
 */
function extractBodyKeys(line: string): string[] {
  const bodyKeys: string[] = [];

  // Look for data/body objects in the same line or nearby
  const bodyPatterns = [
    /data:\s*{([^}]*)}/g,
    /body:\s*{([^}]*)}/g,
    /body:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g, // Variable reference
  ];

  for (const pattern of bodyPatterns) {
    let match;
    while ((match = pattern.exec(line)) !== null) {
      if (match[1]) {
        // Extract property names from object literal
        const props = match[1].match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g);
        if (props) {
          bodyKeys.push(...props.map(p => p.replace(':', '').trim()));
        }
      }
    }
  }

  return [...new Set(bodyKeys)]; // Remove duplicates
}

/**
 * Build data flow graph from endpoint calls
 */
function buildDataFlowGraph(endpointCalls: EndpointCall[], content: string): DataFlowGraph[] {
  const graph: DataFlowGraph[] = [];

  for (const call of endpointCalls) {
    const lines = content.split('\n');
    const callLine = lines[call.line - 1];

    // Look for hook usage (useQuery, useSWR, etc.)
    const hookPatterns = [
      /useQuery\s*\(/g,
      /useSWR\s*\(/g,
      /useMutation\s*\(/g,
      /useInfiniteQuery\s*\(/g,
    ];

    let hookName: string | undefined;
    for (let i = Math.max(0, call.line - 5); i < Math.min(lines.length, call.line + 2); i++) {
      for (const pattern of hookPatterns) {
        if (pattern.test(lines[i])) {
          hookName = pattern.source.replace('\\s*\\(', '');
          break;
        }
      }
      if (hookName) break;
    }

    graph.push({
      component: call.component,
      hook: hookName,
      callsite: `${call.file}:${call.line}`,
      endpoint: call,
    });
  }

  return graph;
}

/**
 * Detect duplicate endpoints based on fingerprints and similar patterns
 */
function detectDuplicateEndpoints(endpointCalls: EndpointCall[]): DuplicateEndpoint[] {
  const fingerprintMap = new Map<string, EndpointCall[]>();
  const duplicates: DuplicateEndpoint[] = [];

  // Group by exact fingerprint first
  for (const call of endpointCalls) {
    if (!fingerprintMap.has(call.fingerprint)) {
      fingerprintMap.set(call.fingerprint, []);
    }
    fingerprintMap.get(call.fingerprint)!.push(call);
  }

  // Find exact duplicates
  for (const [fingerprint, calls] of fingerprintMap) {
    if (calls.length > 1) {
      const files = [...new Set(calls.map(c => c.file))];
      const firstCall = calls[0];

      duplicates.push({
        fingerprint,
        method: firstCall.method,
        path: firstCall.normalizedPath,
        count: calls.length,
        files,
        suggestion: `Consolidate ${calls.length} duplicate calls to ${firstCall.method} ${firstCall.normalizedPath}`,
      });
    }
  }

  // Also detect similar endpoints (same path, different methods or body structures)
  const pathMap = new Map<string, EndpointCall[]>();
  for (const call of endpointCalls) {
    const pathKey = call.normalizedPath;
    if (!pathMap.has(pathKey)) {
      pathMap.set(pathKey, []);
    }
    pathMap.get(pathKey)!.push(call);
  }

  for (const [path, calls] of pathMap) {
    if (calls.length > 1) {
      // Group by method to see if we have multiple methods for same path
      const methodGroups = new Map<string, EndpointCall[]>();
      for (const call of calls) {
        if (!methodGroups.has(call.method)) {
          methodGroups.set(call.method, []);
        }
        methodGroups.get(call.method)!.push(call);
      }

      // If we have multiple different methods for the same path, suggest REST consolidation
      if (methodGroups.size > 1) {
        const methods = Array.from(methodGroups.keys()).sort();
        const totalCount = calls.length;
        const files = [...new Set(calls.map(c => c.file))];

        duplicates.push({
          fingerprint: `MULTI_METHOD:${path}`,
          method: 'MULTI',
          path,
          count: totalCount,
          files,
          suggestion: `Consider consolidating ${methods.join(', ')} methods for ${path} into a single SDK method with method parameter`,
        });
      }
    }
  }

  return duplicates.sort((a, b) => b.count - a.count);
}

/**
 * Extract type definitions from file content
 */
function extractTypeDefinitions(content: string, filePath: string): TypeDefinition[] {
  const typeDefinitions: TypeDefinition[] = [];
  const lines = content.split('\n');

  // Pattern to match type definitions (simplified)
  const typePatterns = [
    // Interface definitions - match the interface declaration line only
    {
      regex: /export\s+interface\s+(\w+)(?:\s+extends\s+[\w\s,<>\[\]]*\{)/g,
      kind: 'interface' as const,
      getContent: (match: RegExpMatchArray) => {
        // Find the complete interface definition
        const interfaceName = match[1];
        const startIndex = content.indexOf(`export interface ${interfaceName}`);
        if (startIndex === -1) return '';

        // Find the matching closing brace
        let braceCount = 0;
        let endIndex = startIndex;
        for (let i = startIndex; i < content.length; i++) {
          if (content[i] === '{') braceCount++;
          if (content[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }

        return content.substring(startIndex, endIndex);
      },
    },
    // Type alias definitions
    {
      regex: /export\s+type\s+(\w+)\s*=\s*([^;]+);/g,
      kind: 'type' as const,
      getContent: (match: RegExpMatchArray) => `export type ${match[1]} = ${match[2]};`,
    },
    // Class definitions
    {
      regex: /export\s+(?:abstract\s+)?class\s+(\w+)/g,
      kind: 'class' as const,
      getContent: (match: RegExpMatchArray) => {
        // Find the complete class definition
        const className = match[1];
        const startIndex =
          content.indexOf(`export class ${className}`) ||
          content.indexOf(`export abstract class ${className}`);
        if (startIndex === -1) return '';

        // Find the matching closing brace
        let braceCount = 0;
        let endIndex = startIndex;
        for (let i = startIndex; i < content.length; i++) {
          if (content[i] === '{') braceCount++;
          if (content[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }

        return content.substring(startIndex, endIndex);
      },
    },
  ];

  // Simple approach: find all export statements for types
  const exportRegex = /export\s+(interface|type|class)\s+(\w+)/g;
  let match;

  while ((match = exportRegex.exec(content)) !== null) {
    const [fullMatch, kind, name] = match;
    const lineNumber = content.substring(0, match.index).split('\n').length;

    // Skip if we already found this type
    if (typeDefinitions.some(t => t.name === name)) continue;

    // Find the complete definition
    const startIndex = match.index;
    let endIndex = startIndex + fullMatch.length;

    if (kind === 'interface' || kind === 'type' || kind === 'class') {
      // Find the end of the definition
      let braceCount = 0;
      let foundStart = false;

      for (let i = startIndex; i < content.length; i++) {
        if (content[i] === '{') {
          braceCount++;
          foundStart = true;
        }
        if (content[i] === '}') {
          braceCount--;
          if (braceCount === 0 && foundStart) {
            endIndex = i + 1;
            break;
          }
        }
        // For type aliases, find the semicolon
        if (kind === 'type' && content[i] === ';') {
          endIndex = i + 1;
          break;
        }
      }
    }

    const definitionContent = content.substring(startIndex, endIndex).trim();

    if (definitionContent) {
      typeDefinitions.push({
        name,
        kind: kind as 'interface' | 'type' | 'class',
        content: definitionContent,
        file: filePath,
        line: lineNumber,
        exported: true,
      });
    }
  }

  return typeDefinitions;
}

// Export the type extraction function
export { extractTypeDefinitions };

/**
 * Extract path parameters from normalized path
 */
function extractPathParams(normalizedPath: string): string[] {
  const params: string[] = [];
  const paramRegex = /:([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let match;

  while ((match = paramRegex.exec(normalizedPath)) !== null) {
    params.push(match[1]);
  }

  return params;
}

/**
 * Analyze data flow patterns in files
 */
export async function analyzeDataFlow(
  files: FileInfo[],
  components: ComponentInfo[]
): Promise<DataFlowAnalysis> {
  const analysis: DataFlowAnalysis = {
    endpoints: [],
    queries: [],
    stores: [], // Will be implemented separately
    endpointCalls: [],
    dataFlowGraph: [],
    duplicateEndpoints: [],
    typeDefinitions: [],
  };

  logger.info(`🔄 Analyzing data flow in ${files.length} files`);

  // Track which files use which libraries
  const fileLibraries: Record<
    string,
    { hasReactQuery: boolean; hasSWR: boolean; hasAxios: boolean; hasFetch: boolean }
  > = {};

  for (const file of files) {
    try {
      const content = await readFile(file.absPath, 'utf-8');
      const libraries = detectDataLibraries(content);
      fileLibraries[file.relPath] = libraries;

      // Extract enhanced endpoints with comprehensive analysis
      const endpointCalls = extractEnhancedEndpoints(content, file.relPath);
      analysis.endpointCalls.push(...endpointCalls);

      // Build data flow graph for this file
      const graph = buildDataFlowGraph(endpointCalls, content);
      analysis.dataFlowGraph.push(...graph);

      // Extract type definitions from this file
      const typeDefinitions = extractTypeDefinitions(content, file.relPath);
      analysis.typeDefinitions.push(...typeDefinitions);

      // Extract endpoints (legacy format for backward compatibility)
      const endpoints = extractEndpoints(content);
      for (const endpoint of endpoints) {
        // Dedupe by (method, path) combination
        const existing = analysis.endpoints.find(
          e => e.path === endpoint.path && e.method === endpoint.method
        );
        if (existing) {
          // Add file to usedBy if not already present
          if (!existing.usedBy.includes(file.relPath)) {
            existing.usedBy.push(file.relPath);
          }
        } else {
          analysis.endpoints.push({
            path: endpoint.path,
            usedBy: [file.relPath],
            method: endpoint.method,
          });
        }
      }

      // Extract query patterns
      if (libraries.hasReactQuery) {
        const reactQueryPatterns = extractReactQueryPatterns(content);
        for (const pattern of reactQueryPatterns) {
          analysis.queries.push({
            lib: 'react-query',
            key: pattern.key,
            usedBy: [file.relPath],
          });
        }
      }

      if (libraries.hasSWR) {
        const swrPatterns = extractSWRPatterns(content);
        for (const pattern of swrPatterns) {
          analysis.queries.push({
            lib: 'swr',
            key: pattern.key,
            usedBy: [file.relPath],
          });
        }
      }

      if (libraries.hasFetch && !libraries.hasReactQuery && !libraries.hasSWR) {
        analysis.queries.push({
          lib: 'fetch',
          usedBy: [file.relPath],
        });
      }
    } catch (error) {
      logger.warn(`Failed to analyze data flow in ${file.relPath}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Detect duplicate endpoints
  analysis.duplicateEndpoints = detectDuplicateEndpoints(analysis.endpointCalls);

  // Deduplicate and sort
  analysis.endpoints = analysis.endpoints.sort((a, b) => a.path.localeCompare(b.path));

  analysis.queries = analysis.queries
    .filter(
      (query, index, self) =>
        index === self.findIndex(q => q.lib === query.lib && q.key === query.key)
    )
    .sort((a, b) => (a.lib + (a.key || '')).localeCompare(b.lib + (b.key || '')));

  logger.info(
    `📊 Data flow analysis complete: ${analysis.endpoints.length} endpoints, ${analysis.endpointCalls.length} calls, ${analysis.duplicateEndpoints.length} duplicates, ${analysis.dataFlowGraph.length} graph nodes`
  );
  return analysis;
}

/**
 * Get data library summary for the project
 */
export function getDataLibrariesSummary(files: FileInfo[]): {
  reactQuery: boolean;
  swr: boolean;
  axios: boolean;
  fetch: boolean;
} {
  const summary = { reactQuery: false, swr: false, axios: false, fetch: false };

  for (const file of files) {
    try {
      const content = readFile(file.absPath, 'utf-8').then(content => {
        const libraries = detectDataLibraries(content);
        summary.reactQuery = summary.reactQuery || libraries.hasReactQuery;
        summary.swr = summary.swr || libraries.hasSWR;
        summary.axios = summary.axios || libraries.hasAxios;
        summary.fetch = summary.fetch || libraries.hasFetch;
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return summary;
}
