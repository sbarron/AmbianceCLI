/**
 * @fileOverview: Language Detection Utilities
 * @module: LanguageUtils
 * @keyFunctions:
 *   - getLanguageFromPath: Detect programming language from file extension
 * @context: Provides language detection for AI code analysis tools
 */

import * as path from 'path';

export function getLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.java': 'java',
    '.cpp': 'cpp',
    '.c': 'c',
    '.cs': 'csharp',
    '.php': 'php',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.html': 'html',
    '.htm': 'html',
    '.astro': 'html',
    '.vue': 'html',
    '.svelte': 'html',
    '.css': 'css',
    '.scss': 'css',
    '.sass': 'css',
    '.less': 'css',
    '.mdx': 'markdown',
  };
  return languageMap[ext] || 'unknown';
}
