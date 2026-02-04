/**
 * @fileOverview: Common helpers for tool operations
 * @module: ToolHelpers
 * @keyFunctions:
 *   - formatError(): Format errors for tool responses
 *   - createToolResponse(): Create standardized tool responses
 *   - validateToolInput(): Basic tool input validation
 * @dependencies:
 *   - logger: Centralized logging
 * @context: Provides common utilities for tool implementations
 */

import { logger } from '../../utils/logger';

/**
 * Format error for tool response
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
}

/**
 * Create standardized tool response
 */
export function createToolResponse<T>(
  success: boolean,
  data?: T,
  error?: string,
  metadata?: Record<string, any>
): {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
} {
  const response: any = { success };

  if (success && data !== undefined) {
    response.data = data;
  }

  if (!success && error) {
    response.error = error;
    logger.error('Tool operation failed', { error });
  }

  if (metadata) {
    response.metadata = metadata;
  }

  return response;
}

/**
 * Basic tool input validation
 */
export function validateToolInput(input: any, requiredFields: string[]): void {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid input: must be an object');
  }

  for (const field of requiredFields) {
    if (!(field in input) || input[field] === undefined || input[field] === null) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

/**
 * Estimate token count from text (rough approximation)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to approximate token limit
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return text;
  }
  return text.substring(0, maxChars) + '...';
}

/**
 * Convert a glob-style pattern to a regular expression that matches POSIX-style paths.
 * Supports `*`, `?`, and `**` wildcards while escaping other regex metacharacters.
 */
export function globToRegExp(pattern: string): RegExp {
  const normalized = (pattern || '').replace(/\\/g, '/');

  const escapeRegex = (value: string) => value.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  const withEscaped = escapeRegex(normalized)
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');

  const regexSource = `^${withEscaped.replace(/__DOUBLE_STAR__/g, '.*')}$`;

  return new RegExp(regexSource);
}

/**
 * Compile an array of glob-style exclude patterns into regular expressions.
 */
export function compileExcludePatterns(patterns: string[] = []): RegExp[] {
  return patterns
    .filter(pattern => typeof pattern === 'string' && pattern.trim().length > 0)
    .map(globToRegExp);
}

/**
 * Determine whether a relative path should be excluded based on compiled patterns.
 */
export function isExcludedPath(relativePath: string, excludeRegexes: RegExp[]): boolean {
  if (!excludeRegexes.length) {
    return false;
  }

  const normalized = relativePath.replace(/\\/g, '/');
  return excludeRegexes.some(regex => regex.test(normalized));
}

/**
 * Cleanup function (no-op for compatibility)
 */
export function cleanupLightweightTools(): void {
  // No cleanup needed for lightweight tools
  logger.debug('Lightweight tools cleanup completed');
}

/**
 * Validate file path (basic validation)
 */
export function validateFilePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  // Basic path validation
  return !filePath.includes('\0') && filePath.length > 0 && filePath.length < 1000;
}
