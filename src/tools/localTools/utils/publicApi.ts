/**
 * @fileOverview: Public API surface detection with signatures for server-only exports
 * @module: PublicApi
 * @keyFunctions:
 *   - isPublicSurface(): Check if file should be included in public API analysis
 *   - extractApiSignature(): Extract function signature from AST-like parsing
 *   - formatSignature(): Format export with parameters for agent consumption
 * @context: Focuses on server-side programmatic APIs that agents can understand and use
 */

import { isServerishPath, toPosix } from './pathUtils';

export type ApiSymbol = {
  name: string;
  kind: 'function' | 'class' | 'const' | 'interface' | 'type';
  file: string;
  line: number;
  params?: number; // parameter count from AST
  signature?: string; // formatted signature
  role?: string; // inferred role (handler, validator, etc.)
};

/**
 * Check if a file path represents a public API surface
 * Only server-side files should be included in public API analysis
 */
export function isPublicSurface(posixPath: string): boolean {
  // Must be server-side code
  if (!isServerishPath(posixPath)) {
    return false;
  }

  // Exclude test files
  if (/(\/|^)(__tests__|tests)\//i.test(posixPath)) {
    return false;
  }
  if (/\.(test|spec)\./i.test(posixPath)) {
    return false;
  }

  // Exclude build artifacts and generated files
  if (/(\/|^)(dist|build|out|coverage|\.next)\//i.test(posixPath)) {
    return false;
  }

  return true;
}

/**
 * Extract function signature information from code content
 */
export function extractApiSignature(
  content: string,
  exportName: string,
  kind: string
): { params?: number; signature?: string } {
  const lines = content.split('\n');

  // Find the export line
  const exportPatterns = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${exportName}\\s*\\(([^)]*)\\)`, 'g'),
    new RegExp(
      `export\\s+const\\s+${exportName}\\s*=\\s*(?:async\\s+)?(?:function\\s*)?\\(([^)]*)\\)`,
      'g'
    ),
    new RegExp(`${exportName}\\s*:\\s*(?:async\\s+)?function\\s*\\(([^)]*)\\)`, 'g'),
    new RegExp(`function\\s+${exportName}\\s*\\(([^)]*)\\)`, 'g'), // For function declarations that might be exported later
  ];

  for (const line of lines) {
    for (const pattern of exportPatterns) {
      const match = pattern.exec(line);
      if (match) {
        const paramString = match[1] || '';
        const params = countParameters(paramString);
        const signature = formatSignatureFromParams(exportName, paramString, kind);

        return { params, signature };
      }
    }
  }

  // Fallback for classes
  if (kind === 'class') {
    const classPattern = new RegExp(
      `class\\s+${exportName}(?:\\s*<[^>]*>)?(?:\\s+extends\\s+\\w+)?\\s*\\{`,
      'g'
    );
    if (classPattern.test(content)) {
      return { signature: `${exportName} (class)` };
    }
  }

  // Fallback for interfaces/types
  if (kind === 'interface' || kind === 'type') {
    return { signature: `${exportName} (${kind})` };
  }

  return {};
}

/**
 * Count parameters in a parameter string, handling complex cases
 */
function countParameters(paramString: string): number {
  if (!paramString.trim()) return 0;

  // Remove default values and type annotations for counting
  const cleaned = paramString
    .replace(/:\s*[^,=)]+/g, '') // Remove type annotations
    .replace(/=\s*[^,)]+/g, '') // Remove default values
    .replace(/\s+/g, '') // Remove whitespace
    .trim();

  if (!cleaned) return 0;

  // Count commas + 1, but handle destructured parameters
  let count = 1;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (const char of cleaned) {
    if (char === '{') braceDepth++;
    else if (char === '}') braceDepth--;
    else if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth--;
    else if (char === ',' && braceDepth === 0 && bracketDepth === 0) {
      count++;
    }
  }

  return count;
}

/**
 * Format a signature from parameter string
 */
function formatSignatureFromParams(name: string, paramString: string, kind: string): string {
  if (kind === 'class') {
    return `${name} (class)`;
  }

  if (kind === 'interface' || kind === 'type') {
    return `${name} (${kind})`;
  }

  const paramCount = countParameters(paramString);

  if (paramCount === 0) {
    return `${name}()`;
  }

  // Extract parameter names for a more informative signature
  const paramNames = extractParameterNames(paramString);
  if (paramNames.length > 0 && paramNames.length <= 4) {
    return `${name}(${paramNames.join(', ')})`;
  }

  // Fallback to count
  return `${name}(${paramCount})`;
}

/**
 * Extract parameter names from parameter string
 */
function extractParameterNames(paramString: string): string[] {
  if (!paramString.trim()) return [];

  const params = paramString.split(',').map(p => p.trim());
  const names: string[] = [];

  for (const param of params) {
    // Extract the parameter name (before : or =)
    let name = param.split(/[:=]/)[0].trim();

    // Handle destructuring
    if (name.startsWith('{') && name.endsWith('}')) {
      names.push('{ ... }');
    } else if (name.startsWith('[') && name.endsWith(']')) {
      names.push('[ ... ]');
    } else if (name.includes('...')) {
      names.push(`...${name.replace(/^\.\.\./, '')}`);
    } else {
      // Clean up the name
      name = name.replace(/[{}[\]]/g, '').trim();
      if (name && name.length > 0) {
        names.push(name);
      }
    }
  }

  return names.slice(0, 4); // Limit to 4 parameters for readability
}

/**
 * Format a complete signature for an API symbol
 */
export function formatSignature(symbol: ApiSymbol): string {
  if (symbol.signature) {
    return symbol.signature;
  }

  if (symbol.params !== undefined) {
    return `${symbol.name}(${symbol.params})`;
  }

  return symbol.name;
}

/**
 * Infer the role/purpose of an export based on its name and kind
 */
export function inferExportRole(name: string, kind: string, filePath?: string): string {
  const nameLower = name.toLowerCase();

  // Role inference based on name patterns
  if (/^(init|initialize|bootstrap|setup|configure)/.test(nameLower)) return 'initializer';
  if (/^(create|build|make|generate)/.test(nameLower)) return 'factory';
  if (/(handler|handle)/.test(nameLower)) return 'handler';
  if (/(validate|verify|check|assert)/.test(nameLower)) return 'validator';
  if (/(parse|transform|convert|format)/.test(nameLower)) return 'transformer';
  if (/(search|query|find|filter)/.test(nameLower)) return 'search';
  if (/(save|store|persist|write|insert|update)/.test(nameLower)) return 'storage';
  if (/(load|read|fetch|get|retrieve)/.test(nameLower)) return 'retrieval';
  if (/(connect|client|pool|database)/.test(nameLower)) return 'connection';
  if (/(middleware|guard|auth|authorize)/.test(nameLower)) return 'middleware';
  if (/(tool|command|execute)/.test(nameLower)) return 'tool';
  if (/(service|provider|manager)/.test(nameLower)) return 'service';
  if (/(router|route|endpoint)/.test(nameLower)) return 'routing';

  // Role inference based on file path context
  if (filePath) {
    const posixPath = toPosix(filePath);
    if (/\/handlers?\//.test(posixPath)) return 'handler';
    if (/\/middleware\//.test(posixPath)) return 'middleware';
    if (/\/services?\//.test(posixPath)) return 'service';
    if (/\/utils?\//.test(posixPath)) return 'utility';
    if (/\/tools?\//.test(posixPath)) return 'tool';
    if (/\/validators?\//.test(posixPath)) return 'validator';
    if (/\/models?\//.test(posixPath)) return 'model';
    if (/\/controllers?\//.test(posixPath)) return 'controller';
    if (/(api|routes?)\//.test(posixPath)) return 'api';
  }

  // Default role based on kind
  return kind;
}

/**
 * Check if an export should be excluded from public API (noise filtering)
 */
export function shouldExcludeFromPublicApi(name: string, kind: string, filePath: string): boolean {
  const nameLower = name.toLowerCase();
  const posixPath = toPosix(filePath);

  // Exclude overly generic names unless in meaningful contexts
  const genericNames = new Set([
    'default',
    'index',
    'config',
    'props',
    'children',
    'value',
    'data',
    'item',
    'element',
    'component',
    'wrapper',
    'container',
    'render',
  ]);

  if (genericNames.has(nameLower)) {
    // Allow in server contexts
    if (!isServerishPath(posixPath)) {
      return true;
    }
  }

  // Exclude obvious UI components
  if (/^(button|card|modal|dialog|input|form|label|text|icon|image)$/i.test(name)) {
    return true;
  }

  // Exclude React patterns
  if (/^(use[A-Z]|with[A-Z]|create[A-Z].*Component)/.test(name)) {
    return true;
  }

  // Exclude HTTP method exports that are route handlers (they belong in routes section)
  const httpMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  if (httpMethods.has(name.toUpperCase())) {
    if (posixPath.includes('/api/') || posixPath.match(/\/app\/.*\/route\.(ts|js)$/)) {
      return true; // This is a route handler, not a public API export
    }
  }

  return false;
}
