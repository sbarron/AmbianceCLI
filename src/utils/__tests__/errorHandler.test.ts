/**
 * @fileOverview: Unit tests for the ErrorHandler utility
 * @module: ErrorHandler Tests
 * @description: Comprehensive test suite for MCPErrorHandler covering error creation, custom error classes, error handling methods, and various error scenarios
 */

import {
  MCPErrorHandler,
  AmbianceError,
  ValidationError,
  APIError,
  FileSystemError,
  ErrorCode,
  MCPError,
  createError,
  handleError,
  isRetryableError,
  getErrorCode,
  getUserFriendlyMessage,
  withErrorHandling,
  withSyncErrorHandling,
} from '../errorHandler';

// Mock logger
jest.mock('../logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

import { logger } from '../logger';

describe('MCPErrorHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Custom Error Classes', () => {
    test('AmbianceError should include code and details', () => {
      const error = new AmbianceError(
        ErrorCode.API_ERROR,
        'Test error',
        { field: 'test' },
        { userId: 123 }
      );

      expect(error.code).toBe(ErrorCode.API_ERROR);
      expect(error.message).toBe('Test error');
      expect(error.details).toEqual({ field: 'test' });
      expect(error.context).toEqual({ userId: 123 });
      expect(error.name).toBe('AmbianceError');
    });

    test('ValidationError should include field information', () => {
      const error = new ValidationError('username', 'Required field', { attempt: 1 });

      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.message).toBe('Validation error for username: Required field');
      expect(error.details).toEqual({ field: 'username' });
      expect(error.context).toEqual({ attempt: 1 });
      expect(error.name).toBe('ValidationError');
    });

    test('APIError should include status code', () => {
      const error = new APIError(ErrorCode.API_ERROR, 'API failed', 404, { endpoint: '/test' });

      expect(error.code).toBe(ErrorCode.API_ERROR);
      expect(error.message).toBe('API failed');
      expect(error.statusCode).toBe(404);
      expect(error.details).toEqual({ statusCode: 404, endpoint: '/test' });
      expect(error.name).toBe('APIError');
    });

    test('FileSystemError should include path information', () => {
      const error = new FileSystemError(ErrorCode.FILE_NOT_FOUND, 'File not found', '/test/path', {
        operation: 'read',
      });

      expect(error.code).toBe(ErrorCode.FILE_NOT_FOUND);
      expect(error.message).toBe('File not found');
      expect(error.path).toBe('/test/path');
      expect(error.details).toEqual({ path: '/test/path', operation: 'read' });
      expect(error.name).toBe('FileSystemError');
    });
  });

  describe('createError', () => {
    test('should handle AmbianceError instances', () => {
      const originalError = new AmbianceError(ErrorCode.API_ERROR, 'Test error');
      const context = { userId: 123 };

      const result = MCPErrorHandler.createError(originalError, context);

      expect(result.code).toBe(ErrorCode.API_ERROR);
      expect(result.message).toBe('Test error');
      expect(result.originalError).toBe(originalError);
      expect(result.timestamp).toBeDefined();
      expect(result.context).toEqual(context);
    });

    test('should categorize network errors', () => {
      const error = new Error('Network connection failed: ECONNREFUSED');

      const result = MCPErrorHandler.createError(error);

      expect(result.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(result.message).toBe('Network connection failed');
    });

    test('should categorize timeout errors', () => {
      const error = new Error('Request timeout occurred');

      const result = MCPErrorHandler.createError(error);

      expect(result.code).toBe(ErrorCode.AI_TIMEOUT_ERROR);
      expect(result.message).toBe('Operation timed out');
    });

    test('should categorize rate limit errors', () => {
      const error = new Error('Rate limit exceeded: 429');

      const result = MCPErrorHandler.createError(error);

      expect(result.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
      expect(result.message).toBe('Rate limit exceeded, please try again later');
    });

    test('should categorize permission errors', () => {
      const error = new Error('Permission denied: EACCES');

      const result = MCPErrorHandler.createError(error);

      expect(result.code).toBe(ErrorCode.PERMISSION_ERROR);
      expect(result.message).toBe('Permission denied');
    });

    test('should categorize file not found errors', () => {
      const error = new Error('File not found: ENOENT');

      const result = MCPErrorHandler.createError(error);

      expect(result.code).toBe(ErrorCode.FILE_NOT_FOUND);
      expect(result.message).toBe('File or directory not found');
    });

    test('should categorize configuration errors', () => {
      const error = new Error('OPENAI_API_KEY is required');

      const result = MCPErrorHandler.createError(error);

      expect(result.code).toBe(ErrorCode.MISSING_CONFIG);
      expect(result.message).toBe(
        'Required configuration is missing. Please check environment variables.'
      );
    });

    test('should handle unknown errors', () => {
      const result = MCPErrorHandler.createError('string error');

      expect(result.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(result.message).toBe('An unknown error occurred');
      expect(result.details).toEqual({ error: 'string error' });
    });

    test('should handle null/undefined errors', () => {
      const result = MCPErrorHandler.createError(null);

      expect(result.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(result.details).toEqual({ error: 'null' });
    });
  });

  describe('handleError', () => {
    test('should log errors with default options', () => {
      const error = new Error('Test error');

      expect(() => {
        MCPErrorHandler.handleError(error, { userId: 123 });
      }).toThrow(error);

      expect(logger.error).toHaveBeenCalledWith(
        'An internal error occurred',
        expect.objectContaining({
          code: ErrorCode.INTERNAL_ERROR,
          userId: 123,
        })
      );
    });

    test('should log with warn level when specified', () => {
      const error = new Error('Test error');

      expect(() => {
        MCPErrorHandler.handleError(error, undefined, { logLevel: 'warn' });
      }).toThrow(error);

      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('should not rethrow when rethrow is false', () => {
      const error = new Error('Test error');

      const result = MCPErrorHandler.handleError(error, undefined, { rethrow: false });

      expect(result).toBeDefined();
      expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(logger.error).toHaveBeenCalled();
    });

    test('should include stack trace when requested', () => {
      const error = new Error('Test error');

      MCPErrorHandler.handleError(error, undefined, { rethrow: false, includeStack: true });

      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          stack: expect.stringContaining('Test error'),
        })
      );
    });

    test('should mark error as retryable when specified', () => {
      const error = new Error('Test error');

      const result = MCPErrorHandler.handleError(error, undefined, {
        rethrow: false,
        retryable: true,
      });

      expect(result.details?.retryable).toBe(true);
    });
  });

  describe('isRetryableError', () => {
    test('should return true for retryable error codes', () => {
      const retryableErrors: MCPError[] = [
        { code: ErrorCode.NETWORK_ERROR, message: 'Network error' },
        { code: ErrorCode.AI_TIMEOUT_ERROR, message: 'Timeout' },
        { code: ErrorCode.RATE_LIMIT_ERROR, message: 'Rate limited' },
        { code: ErrorCode.API_ERROR, message: 'API error' },
      ];

      retryableErrors.forEach(error => {
        expect(MCPErrorHandler.isRetryableError(error)).toBe(true);
      });
    });

    test('should return false for non-retryable error codes', () => {
      const nonRetryableErrors: MCPError[] = [
        { code: ErrorCode.MISSING_CONFIG, message: 'Missing config' },
        { code: ErrorCode.FILE_NOT_FOUND, message: 'File not found' },
        { code: ErrorCode.VALIDATION_ERROR, message: 'Validation error' },
        { code: ErrorCode.INTERNAL_ERROR, message: 'Internal error' },
      ];

      nonRetryableErrors.forEach(error => {
        expect(MCPErrorHandler.isRetryableError(error)).toBe(false);
      });
    });

    test('should respect explicit retryable flag', () => {
      const error: MCPError = {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal error',
        details: { retryable: true },
      };

      expect(MCPErrorHandler.isRetryableError(error)).toBe(true);
    });

    test('should respect explicit non-retryable flag', () => {
      const error: MCPError = {
        code: ErrorCode.NETWORK_ERROR,
        message: 'Network error',
        details: { retryable: false },
      };

      expect(MCPErrorHandler.isRetryableError(error)).toBe(false);
    });
  });

  describe('getErrorCode', () => {
    test('should extract error code from AmbianceError', () => {
      const error = new AmbianceError(ErrorCode.API_ERROR, 'Test');
      expect(MCPErrorHandler.getErrorCode(error)).toBe(ErrorCode.API_ERROR);
    });

    test('should extract error code from regular Error', () => {
      const error = new Error('Network error');
      expect(MCPErrorHandler.getErrorCode(error)).toBe(ErrorCode.NETWORK_ERROR);
    });

    test('should return UNKNOWN_ERROR for unknown error types', () => {
      expect(MCPErrorHandler.getErrorCode('string')).toBe(ErrorCode.UNKNOWN_ERROR);
    });
  });

  describe('getUserFriendlyMessage', () => {
    test('should provide user-friendly messages for common errors', () => {
      const testCases = [
        {
          code: ErrorCode.MISSING_CONFIG,
          expected: 'Please check your configuration and environment variables.',
        },
        {
          code: ErrorCode.NETWORK_ERROR,
          expected: 'Please check your internet connection and try again.',
        },
        {
          code: ErrorCode.RATE_LIMIT_ERROR,
          expected: 'Rate limit exceeded. Please wait a moment and try again.',
        },
        {
          code: ErrorCode.FILE_NOT_FOUND,
          expected: 'The requested file or directory could not be found.',
        },
        {
          code: ErrorCode.PERMISSION_ERROR,
          expected: 'Permission denied. Please check file permissions.',
        },
        {
          code: ErrorCode.AI_TIMEOUT_ERROR,
          expected: 'The operation timed out. Please try again with a smaller request.',
        },
        {
          code: ErrorCode.UNKNOWN_ERROR,
          expected: 'An unexpected error occurred. Please try again or contact support.',
        },
      ];

      testCases.forEach(({ code, expected }) => {
        const error: MCPError = { code, message: 'Test' };
        expect(MCPErrorHandler.getUserFriendlyMessage(error)).toBe(expected);
      });
    });
  });

  describe('withErrorHandling', () => {
    test('should execute successful async functions normally', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await MCPErrorHandler.withErrorHandling(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    test('should handle async function errors', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Async error'));

      await expect(MCPErrorHandler.withErrorHandling(fn)).rejects.toThrow('Async error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('withSyncErrorHandling', () => {
    test('should execute successful sync functions normally', () => {
      const fn = jest.fn().mockReturnValue('success');

      const result = MCPErrorHandler.withSyncErrorHandling(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    test('should handle sync function errors', () => {
      const fn = jest.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });

      expect(() => MCPErrorHandler.withSyncErrorHandling(fn)).toThrow('Sync error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Convenience Functions', () => {
    test('createError should delegate to MCPErrorHandler.createError', () => {
      const spy = jest.spyOn(MCPErrorHandler, 'createError');
      const error = new Error('test');

      createError(error);

      expect(spy).toHaveBeenCalledWith(error, undefined);
    });

    test('handleError should delegate to MCPErrorHandler.handleError', () => {
      const spy = jest.spyOn(MCPErrorHandler, 'handleError');
      const error = new Error('test');

      expect(() => handleError(error)).toThrow();
      expect(spy).toHaveBeenCalledWith(error, undefined, {});
    });

    test('isRetryableError should delegate to MCPErrorHandler.isRetryableError', () => {
      const spy = jest.spyOn(MCPErrorHandler, 'isRetryableError');
      const error: MCPError = { code: ErrorCode.NETWORK_ERROR, message: 'test' };

      isRetryableError(error);

      expect(spy).toHaveBeenCalledWith(error);
    });

    test('getErrorCode should delegate to MCPErrorHandler.getErrorCode', () => {
      const spy = jest.spyOn(MCPErrorHandler, 'getErrorCode');
      const error = new Error('test');

      getErrorCode(error);

      expect(spy).toHaveBeenCalledWith(error);
    });

    test('getUserFriendlyMessage should delegate to MCPErrorHandler.getUserFriendlyMessage', () => {
      const spy = jest.spyOn(MCPErrorHandler, 'getUserFriendlyMessage');
      const error: MCPError = { code: ErrorCode.NETWORK_ERROR, message: 'test' };

      getUserFriendlyMessage(error);

      expect(spy).toHaveBeenCalledWith(error);
    });
  });
});
