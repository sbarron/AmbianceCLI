/**
 * Simplified error handling tests for better coverage
 * Focus on actual validation and error scenarios
 */

import { describe, test, expect } from '@jest/globals';
import {
  ValidationError,
  ValidationHelper,
  DiscoverFilesInputSchema,
  ReadFileInputSchema,
} from '../validation';
import { z } from 'zod';

describe('Core Validation Error Handling', () => {
  describe('Zod Schema Validation', () => {
    test('should reject empty arrays when minimum required', () => {
      const arraySchema = z.array(z.string()).min(1, 'Array cannot be empty');

      expect(() => {
        ValidationHelper.validateInput(arraySchema, [], 'testArray');
      }).toThrow(ValidationError);
    });

    test('should reject invalid UUIDs', () => {
      expect(() => {
        ValidationHelper.validateInput(ReadFileInputSchema, { fileId: 'not-a-uuid' }, 'readFile');
      }).toThrow(ValidationError);
    });

    test('should reject null values for required strings', () => {
      const stringSchema = z.string().min(1);

      expect(() => {
        ValidationHelper.validateInput(stringSchema, null, 'requiredString');
      }).toThrow(ValidationError);
    });

    test('should reject undefined values for required fields', () => {
      const requiredSchema = z.string();

      expect(() => {
        ValidationHelper.validateInput(requiredSchema, undefined, 'required');
      }).toThrow(ValidationError);
    });

    test('should reject empty directory paths', () => {
      expect(() => {
        ValidationHelper.validateInput(DiscoverFilesInputSchema, { baseDir: '' }, 'discover');
      }).toThrow(ValidationError);
    });

    test('should reject content that is too short', () => {
      const longStringSchema = z.string().min(100, 'Content must be at least 100 characters');

      expect(() => {
        ValidationHelper.validateInput(longStringSchema, 'short', 'content');
      }).toThrow(ValidationError);
    });

    test('should reject invalid regex patterns', () => {
      const alphanumericSchema = z.string().regex(/^[a-zA-Z0-9]*$/, 'Must be alphanumeric');

      expect(() => {
        ValidationHelper.validateInput(alphanumericSchema, 'content with spaces!', 'alphanumeric');
      }).toThrow(ValidationError);
    });

    test('should reject arrays that exceed maximum size', () => {
      const limitedArraySchema = z.array(z.string()).max(3, 'Array too large');
      const largeArray = ['item1', 'item2', 'item3', 'item4', 'item5'];

      expect(() => {
        ValidationHelper.validateInput(limitedArraySchema, largeArray, 'limitedArray');
      }).toThrow(ValidationError);
    });

    test('should reject numbers outside valid range', () => {
      const rangeSchema = z.number().min(1).max(100);

      expect(() => {
        ValidationHelper.validateInput(rangeSchema, 0, 'range');
      }).toThrow(ValidationError);

      expect(() => {
        ValidationHelper.validateInput(rangeSchema, 101, 'range');
      }).toThrow(ValidationError);
    });

    test('should reject invalid enum values', () => {
      const enumSchema = z.enum(['option1', 'option2', 'option3']);

      expect(() => {
        ValidationHelper.validateInput(enumSchema, 'invalidOption', 'enum');
      }).toThrow(ValidationError);
    });
  });

  describe('Error Message Structure', () => {
    test('should provide structured error information', () => {
      let caughtError: unknown;

      try {
        ValidationHelper.validateInput(ReadFileInputSchema, { fileId: 'invalid' }, 'readFile');
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(ValidationError);
      const validationError = caughtError as ValidationError;
      expect(validationError.structured).toBeDefined();
      expect(validationError.structured.code).toBeDefined();
      expect(validationError.structured.context).toBeDefined();
    });

    test('should include helpful suggestions in error messages', () => {
      let caughtError: unknown;

      try {
        const stringSchema = z.string().min(10, 'String too short');
        ValidationHelper.validateInput(stringSchema, 'short', 'test');
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(ValidationError);
      const validationError = caughtError as ValidationError;
      expect(validationError.message).toContain('String too short');
    });
  });

  describe('Complex Object Validation', () => {
    test('should validate nested objects correctly', () => {
      const nestedSchema = z.object({
        user: z.object({
          name: z.string().min(1),
          email: z.string().email(),
          age: z.number().min(0).max(150),
        }),
        settings: z.object({
          theme: z.enum(['light', 'dark']),
          notifications: z.boolean(),
        }),
      });

      const invalidData = {
        user: {
          name: '',
          email: 'invalid-email',
          age: -5,
        },
        settings: {
          theme: 'invalid-theme',
          notifications: 'not-boolean',
        },
      };

      expect(() => {
        ValidationHelper.validateInput(nestedSchema, invalidData, 'nested');
      }).toThrow(ValidationError);
    });

    test('should handle optional fields correctly', () => {
      const optionalSchema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      // Should pass with only required field
      expect(() => {
        ValidationHelper.validateInput(optionalSchema, { required: 'value' }, 'optional');
      }).not.toThrow();

      // Should fail without required field
      expect(() => {
        ValidationHelper.validateInput(optionalSchema, { optional: 'value' }, 'optional');
      }).toThrow(ValidationError);
    });
  });

  describe('Type Coercion and Validation', () => {
    test('should handle string-to-number coercion failures', () => {
      const numberSchema = z.coerce.number();

      expect(() => {
        ValidationHelper.validateInput(numberSchema, 'not-a-number', 'coerceNumber');
      }).toThrow(ValidationError);
    });

    test('should handle date validation failures', () => {
      const dateSchema = z.date();

      expect(() => {
        ValidationHelper.validateInput(dateSchema, 'invalid-date', 'date');
      }).toThrow(ValidationError);
    });

    test('should handle boolean validation failures', () => {
      const booleanSchema = z.boolean();

      expect(() => {
        ValidationHelper.validateInput(booleanSchema, 'not-boolean', 'boolean');
      }).toThrow(ValidationError);
    });
  });

  describe('Custom Validation Rules', () => {
    test('should handle custom refinement failures', () => {
      const customSchema = z.string().refine(val => val.includes('required-text'), {
        message: 'String must contain required-text',
      });

      expect(() => {
        ValidationHelper.validateInput(customSchema, 'missing text', 'custom');
      }).toThrow(ValidationError);
    });

    test('should handle transform failures', () => {
      const transformSchema = z.string().transform(val => {
        const num = parseInt(val, 10);
        if (isNaN(num)) {
          throw new Error('Cannot transform to number');
        }
        return num;
      });

      expect(() => {
        ValidationHelper.validateInput(transformSchema as any, 'not-a-number', 'transform');
      }).toThrow(ValidationError);
    });
  });

  describe('Edge Cases', () => {
    test('should handle very large objects', () => {
      const largeObjectSchema = z.object({
        data: z.array(z.string()).max(10000),
      });

      const largeArray = new Array(10001).fill('item');

      expect(() => {
        ValidationHelper.validateInput(largeObjectSchema, { data: largeArray }, 'large');
      }).toThrow(ValidationError);
    });

    test('should handle circular reference detection', () => {
      const obj: any = { name: 'test' };
      obj.self = obj;

      const simpleSchema = z.object({
        name: z.string(),
        self: z.any().optional(),
      });

      // Should not crash on circular references
      expect(() => {
        ValidationHelper.validateInput(simpleSchema, obj, 'circular');
      }).not.toThrow();
    });

    test('should handle null vs undefined distinction', () => {
      const nullableSchema = z.string().nullable();
      const optionalSchema = z.string().optional();

      // Nullable allows null but not undefined
      expect(() => {
        ValidationHelper.validateInput(nullableSchema, null, 'nullable');
      }).not.toThrow();

      expect(() => {
        ValidationHelper.validateInput(nullableSchema, undefined, 'nullable');
      }).toThrow(ValidationError);

      // Optional allows undefined but not null (without nullable)
      expect(() => {
        ValidationHelper.validateInput(optionalSchema, undefined, 'optional');
      }).not.toThrow();
    });
  });
});
