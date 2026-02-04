/**
 * @fileOverview: Comprehensive tests for AST-Grep pattern validation and error handling
 * @testCategories:
 *   - Pattern validation (valid/invalid patterns)
 *   - Error message quality and helpfulness
 *   - Pattern suggestions for common mistakes
 *   - Edge cases and boundary conditions
 * @dependencies:
 *   - jest testing framework
 *   - astGrep validation functions
 */

import { validateAstGrepPattern } from './astGrep';

describe('AST-Grep Pattern Validation', () => {
  describe('Valid Patterns', () => {
    test('should accept complete function patterns', () => {
      const result = validateAstGrepPattern('function $NAME($ARGS) { $BODY }');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should accept export patterns', () => {
      const result = validateAstGrepPattern('export const $NAME = $VALUE');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should accept import patterns', () => {
      const result = validateAstGrepPattern('import $NAME from "$MODULE"');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should accept class instantiation patterns', () => {
      const result = validateAstGrepPattern('new $CLASS($ARGS)');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should accept method call patterns', () => {
      const result = validateAstGrepPattern('$OBJ.$METHOD($ARGS)');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should accept async function patterns', () => {
      const result = validateAstGrepPattern('async function $NAME($ARGS) { $BODY }');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should accept arrow function patterns', () => {
      const result = validateAstGrepPattern('const $NAME = ($ARGS) => $BODY');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should accept patterns with $$$ for multiple arguments', () => {
      const result = validateAstGrepPattern('console.log($$$ARGS)');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Invalid Patterns - Regex Syntax', () => {
    test('should reject regex literal syntax', () => {
      const result = validateAstGrepPattern('/pattern/gim');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Regex literal syntax');
      expect(result.suggestions).toContain('Use structural patterns instead of regex');
    });

    test('should reject alternation operator', () => {
      const result = validateAstGrepPattern('import $NAME | const $NAME');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Alternation operator');
      expect(result.suggestions).toContain('Run separate searches for each pattern instead');
    });

    test('should reject regex wildcards', () => {
      const result = validateAstGrepPattern('function $NAME(.*) { $BODY }');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Regex wildcards');
      expect(result.suggestions).toContain('Use structural wildcards like $NAME, $ARGS instead');
    });

    test('should reject regex escape sequences', () => {
      const result = validateAstGrepPattern('function \\$NAME(\\$ARGS)');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Regex escape sequences');
      expect(result.suggestions).toContain(
        'Remove backslashes - AST patterns use structural matching, not text matching'
      );
    });

    test('should reject regex groups', () => {
      const result = validateAstGrepPattern('(?i)pattern');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Regex groups');
      expect(result.suggestions).toContain(
        'Use structural patterns with multiple searches instead'
      );
    });
  });

  describe('Invalid Patterns - Ambiguous AST', () => {
    test('should reject ambiguous export patterns', () => {
      const result = validateAstGrepPattern('export $TYPE');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('ambiguous and cannot be parsed');
      expect(result.suggestions).toContain(
        'Example: "export const $NAME = $VALUE" instead of "export $TYPE"'
      );
    });

    test('should reject ambiguous import patterns', () => {
      const result = validateAstGrepPattern('import $NAME');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('ambiguous and cannot be parsed');
      expect(result.suggestions).toContain('Add more context to make the pattern unambiguous');
    });

    test('should reject ambiguous function patterns', () => {
      const result = validateAstGrepPattern('function $FUNC');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('ambiguous and cannot be parsed');
      expect(result.suggestions).toContain(
        'Example: "function $NAME($ARGS) { $BODY }" instead of "function $FUNC"'
      );
    });

    test('should reject standalone metavariables', () => {
      const result = validateAstGrepPattern('$NAME');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('ambiguous and cannot be parsed');
      expect(result.suggestions).toContain('Add more context to make the pattern unambiguous');
    });

    test('should reject export default with metavariable', () => {
      const result = validateAstGrepPattern('export default $NAME');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('ambiguous and cannot be parsed');
      expect(result.suggestions).toContain('Add more context to make the pattern unambiguous');
    });
  });

  describe('Empty and Invalid Input', () => {
    test('should reject empty patterns', () => {
      const result = validateAstGrepPattern('');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('cannot be empty');
      expect(result.suggestions).toBeDefined();
    });

    test('should reject whitespace-only patterns', () => {
      const result = validateAstGrepPattern('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('cannot be empty');
      expect(result.suggestions).toBeDefined();
    });
  });

  describe('Pattern Warnings', () => {
    test('should warn about overly generic patterns', () => {
      const result = validateAstGrepPattern('export $NAME');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('ambiguous');
    });

    test('should warn about function patterns without body', () => {
      const result = validateAstGrepPattern('function $NAME');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('ambiguous');
    });
  });

  describe('Pattern Suggestions', () => {
    test('should suggest metavariables for export patterns', () => {
      const result = validateAstGrepPattern('export function test() { return 1; }');
      expect(result.isValid).toBe(true);
      expect(result.suggestions).toContain(
        'Use metavariables like $NAME for the exported identifier'
      );
    });

    test('should suggest metavariables for class patterns', () => {
      const result = validateAstGrepPattern('class Test { constructor() {} }');
      expect(result.isValid).toBe(true);
      expect(result.suggestions).toContain('Use $NAME for the class name');
    });

    test('should suggest metavariables for import patterns', () => {
      const result = validateAstGrepPattern('import express from "express"');
      expect(result.isValid).toBe(true);
      expect(result.suggestions).toContain('Use $NAME for the imported identifier');
    });
  });

  describe('Edge Cases', () => {
    test('should handle patterns with special characters correctly', () => {
      const result = validateAstGrepPattern('const $NAME = $VALUE ?? $DEFAULT');
      expect(result.isValid).toBe(true);
    });

    test('should handle nested patterns', () => {
      const result = validateAstGrepPattern('if ($COND) { $THEN } else { $ELSE }');
      expect(result.isValid).toBe(true);
    });

    test('should handle patterns with quotes and strings', () => {
      const result = validateAstGrepPattern('const $MSG = "Hello $NAME"');
      expect(result.isValid).toBe(true);
    });

    test('should handle TypeScript-specific patterns', () => {
      const result = validateAstGrepPattern('interface $NAME { $PROPS }');
      expect(result.isValid).toBe(true);
    });

    test('should handle React JSX patterns', () => {
      const result = validateAstGrepPattern('const $COMP = () => <div>$CONTENT</div>');
      expect(result.isValid).toBe(true);
    });
  });

  describe('Real-World Examples', () => {
    test('should validate Express.js usage patterns', () => {
      const patterns = [
        'import $NAME from "express"',
        'const $NAME = require("express")',
        'express()',
        'app.use($MIDDLEWARE)',
        'app.get("$ROUTE", $HANDLER)',
      ];

      patterns.forEach(pattern => {
        const result = validateAstGrepPattern(pattern);
        expect(result.isValid).toBe(true);
      });
    });

    test('should validate React component patterns', () => {
      const patterns = [
        'export function $NAME($PROPS) { return $JSX }',
        'const $NAME = ($PROPS) => $JSX',
        'function $NAME() { const [$STATE, $SETTER] = useState($INITIAL) }',
        'useEffect(() => { $EFFECT }, [$DEPS])',
      ];

      patterns.forEach(pattern => {
        const result = validateAstGrepPattern(pattern);
        expect(result.isValid).toBe(true);
      });
    });

    test('should validate database patterns', () => {
      const patterns = [
        'await $DB.query("$SQL")',
        '$DB.findById($ID)',
        'new $CONNECTION("$URL")',
        'mongoose.connect("$URI")',
      ];

      patterns.forEach(pattern => {
        const result = validateAstGrepPattern(pattern);
        expect(result.isValid).toBe(true);
      });
    });
  });
});
