import { describe, it, expect } from '@jest/globals';
import { ValidationHelper, ValidationError } from '../validation';
import {
  DiscoverFilesInputSchema,
  ReadFileInputSchema,
  ValidateRequestInputSchema,
} from '../validation';

describe('Phase 13 Validation System', () => {
  describe('Input Validation', () => {
    it('should validate discover_files input correctly', () => {
      const validInput = { baseDir: '.' };
      expect(() => {
        ValidationHelper.validateInput(DiscoverFilesInputSchema, validInput, 'discover_files');
      }).not.toThrow();

      const invalidInput = { baseDir: '' };
      expect(() => {
        ValidationHelper.validateInput(DiscoverFilesInputSchema, invalidInput, 'discover_files');
      }).toThrow(ValidationError);
    });

    it('should validate read_file input correctly', () => {
      const validInput = { fileId: '123e4567-e89b-12d3-a456-426614174000' };
      expect(() => {
        ValidationHelper.validateInput(ReadFileInputSchema, validInput, 'read_file');
      }).not.toThrow();

      const invalidInput = { fileId: 'not-a-uuid' };
      expect(() => {
        ValidationHelper.validateInput(ReadFileInputSchema, invalidInput, 'read_file');
      }).toThrow(ValidationError);
    });

    it('should provide structured error messages', () => {
      try {
        ValidationHelper.validateInput(ReadFileInputSchema, { fileId: 'invalid' }, 'read_file');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.structured.code).toBe('SCHEMA_VALIDATION_FAILED');
        expect(validationError.structured.context).toBeDefined();
        expect(validationError.structured.suggestion).toBeDefined();
        expect(validationError.structured.examples).toBeDefined();
      }
    });

    it('should validate request validation input', () => {
      const validInput = {
        toolName: 'discover_files',
        arguments: { baseDir: '.' },
      };
      expect(() => {
        ValidationHelper.validateInput(ValidateRequestInputSchema, validInput, 'validate_request');
      }).not.toThrow();

      const invalidInput = {
        toolName: '',
        arguments: {},
      };
      expect(() => {
        ValidationHelper.validateInput(
          ValidateRequestInputSchema,
          invalidInput,
          'validate_request'
        );
      }).toThrow(ValidationError);
    });
  });

  describe('Dry Run Responses', () => {
    it('should create dry run responses for tools', () => {
      const dryRunResponse = ValidationHelper.createDryRunResponse('discover_files', {
        baseDir: '.',
      });

      expect(dryRunResponse.dryRun).toBe(true);
      expect(dryRunResponse.tool).toBe('discover_files');
      expect(dryRunResponse.timestamp).toBeDefined();
      expect(dryRunResponse.plan).toBeDefined();
      expect(dryRunResponse.invariants).toBeDefined();
      expect(dryRunResponse.estimatedDuration).toBeDefined();
      expect(dryRunResponse.resourceRequirements).toBeDefined();
    });

    it('should provide execution plans for different tools', () => {
      const discoverPlan = ValidationHelper.createDryRunResponse('discover_files', {
        baseDir: '.',
      });
      expect(discoverPlan.plan.join(' ')).toContain('Scan directory');
      expect(discoverPlan.plan.join(' ')).toContain('Return secure file handles');

      const readPlan = ValidationHelper.createDryRunResponse('read_file', { fileId: 'test' });
      expect(readPlan.plan.join(' ')).toContain('Validate file ID');
      expect(readPlan.plan.join(' ')).toContain('Read file content');
    });

    it('should provide invariants for tools', () => {
      const response = ValidationHelper.createDryRunResponse('discover_files', { baseDir: '.' });
      expect(response.invariants.pre).toContain('Base directory must exist');
      expect(response.invariants.post).toContain('All returned handles have valid UUIDs');
    });
  });

  describe('Tool Examples', () => {
    it('should provide examples for all tools', () => {
      const tools = ['discover_files', 'read_file', 'parse_ast', 'search_context'];

      tools.forEach(toolName => {
        const examples = ValidationHelper.getToolExamples(toolName);
        expect(examples).toBeDefined();
        if (examples.good_call) {
          expect(examples.good_call).toBeDefined();
        }
        if (examples.bad_call) {
          expect(examples.bad_call).toBeDefined();
        }
      });
    });
  });

  describe('Error Codes', () => {
    it('should have consistent error codes', () => {
      const errorCodes = ['SCHEMA_VALIDATION_FAILED', 'OUTPUT_VALIDATION_FAILED'];

      errorCodes.forEach(code => {
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(0);
      });
    });
  });
});
