/**
 * @fileOverview: Ast-grep patterns for multi-language symbol extraction
 * @module: SymbolPatterns
 * @description: Defines structural patterns for extracting functions, classes, etc., using ast-grep syntax.
 * Patterns are simple (pattern mode) for now; can extend to rules later.
 * Based on schemas in ./schemas/ (e.g., python_rule.json for "function_definition").
 */

import * as path from 'path';

export interface SymbolPattern {
  pattern: string; // Ast-grep pattern string
  lang: string; // Ast-grep language code (e.g., 'py', 'go')
  captures?: string[]; // Expected metavariables (e.g., ['$NAME', '$PARAMS'])
  description: string;
}

export interface LanguagePatterns {
  functions: SymbolPattern[];
  classes: SymbolPattern[];
  methods?: SymbolPattern[]; // Optional for OOP langs
  exports?: SymbolPattern[]; // Lang-specific exports
}

/**
 * Symbol extraction patterns by language.
 * Extend as needed; test with executeAstGrep.
 */
export const symbolPatterns: Record<string, LanguagePatterns> = {
  py: {
    functions: [
      {
        pattern: 'def ',
        lang: 'py',
        captures: [],
        description: 'Python function definition',
      },
    ],
    classes: [
      {
        pattern: 'class ',
        lang: 'py',
        captures: [],
        description: 'Python class definition',
      },
    ],
  },
  go: {
    functions: [
      {
        pattern: 'func ',
        lang: 'go',
        captures: [],
        description: 'Go function definition',
      },
    ],
    classes: [], // Go uses structs; add "type $NAME struct {" later
  },
  rs: {
    functions: [
      {
        pattern: 'fn ',
        lang: 'rs',
        captures: [],
        description: 'Rust function definition',
      },
    ],
    classes: [], // Rust uses structs/impls; add "struct $NAME {" later
  },
  java: {
    functions: [], // Methods under classes
    classes: [
      {
        pattern: 'class ',
        lang: 'java',
        captures: [],
        description: 'Java class declaration',
      },
    ],
    methods: [
      {
        pattern: 'public ',
        lang: 'java',
        captures: [],
        description: 'Java public method/class declaration',
      },
    ],
  },
  // Add more langs as needed (e.g., C++ from cpp_rule.json: "void $NAME($PARAMS) {")
};

/**
 * Get patterns for a language and symbol type.
 */
export function getPatterns(
  lang: string,
  type: 'functions' | 'classes' | 'methods' | 'exports'
): SymbolPattern[] {
  const patterns = symbolPatterns[lang];
  if (!patterns) return [];
  return patterns[type] || [];
}

/**
 * Validate and prepare pattern for ast-grep (adds lang if needed).
 */
export function preparePattern(pattern: SymbolPattern, filePath: string): any {
  // For single file extraction, use the file path as projectPath and a pattern that matches just this file
  const fileName = path.basename(filePath);
  return {
    pattern: pattern.pattern,
    language: pattern.lang,
    projectPath: path.dirname(filePath),
    filePattern: fileName, // Use just the filename as a pattern
    maxMatches: 50,
    includeContext: true,
    contextLines: 2,
  };
}
