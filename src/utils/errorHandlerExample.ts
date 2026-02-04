/**
 * @fileOverview: Example usage of the centralized error handling system
 * @module: ErrorHandlerExample
 * @context: This file demonstrates how to use the new error handling system throughout the codebase
 */

// Import the error handling system
import {
  AmbianceError,
  ValidationError,
  APIError,
  FileSystemError,
  ErrorCode,
  withErrorHandling,
  withSyncErrorHandling,
  handleError,
  getUserFriendlyMessage,
} from './errorHandler';
import { logger } from './logger';

/**
 * Example 1: Basic error handling with automatic logging
 */
export async function exampleBasicErrorHandling() {
  try {
    // Some operation that might fail
    throw new Error('OPENAI_API_KEY environment variable is required');
  } catch (error) {
    // This will automatically log the error and categorize it
    const mcpError = handleError(
      error,
      { operation: 'exampleBasicErrorHandling' },
      { rethrow: false }
    );
    logger.info('Error handled', { code: mcpError.code, message: mcpError.message });

    // Get user-friendly message
    const userMessage = getUserFriendlyMessage(mcpError);
    logger.info('User message', { userMessage });
  }
}

/**
 * Example 2: Using custom error classes
 */
export function exampleCustomErrors() {
  try {
    // Validation error
    throw new ValidationError('email', 'Invalid email format', { value: 'invalid-email' });
  } catch (error) {
    const mcpError = handleError(error, { userId: 123 }, { rethrow: false });
    logger.warn('Validation error', { code: mcpError.code, message: mcpError.message });
  }

  try {
    // API error
    throw new APIError(ErrorCode.API_ERROR, 'Failed to fetch data', 404, {
      endpoint: '/api/users',
    });
  } catch (error) {
    const mcpError = handleError(error, { userId: 123 }, { rethrow: false });
    logger.warn('API error', { code: mcpError.code, message: mcpError.message });
  }

  try {
    // File system error
    throw new FileSystemError(
      ErrorCode.FILE_NOT_FOUND,
      'Config file not found',
      '/etc/config.json'
    );
  } catch (error) {
    const mcpError = handleError(error, { fileOperation: 'read' }, { rethrow: false });
    logger.warn('File error', { code: mcpError.code, message: mcpError.message });
  }
}

/**
 * Example 3: Using the wrapper functions for automatic error handling
 */
export async function exampleWithWrappers() {
  // Async function with automatic error handling
  const result = await withErrorHandling(
    async () => {
      // Your async operation here
      const response = await fetch('https://api.example.com/data');
      return response.json();
    },
    { operation: 'fetchData', userId: 123 },
    { logLevel: 'warn' } // Log as warning instead of error
  );

  // Sync function with automatic error handling
  const syncResult = withSyncErrorHandling(
    () => {
      // Your sync operation here
      return JSON.parse('{"valid": "json"}');
    },
    { operation: 'parseConfig', file: 'config.json' }
  );

  return { asyncResult: result, syncResult };
}

/**
 * Example 4: Replacing existing error handling patterns
 */
export async function exampleReplacingOldPatterns() {
  // OLD WAY (scattered throughout codebase):
  // try {
  //   const result = await someOperation();
  //   return result;
  // } catch (error) {
  //   logger.error('Operation failed', { error: error.message });
  //   throw error;
  // }

  // NEW WAY (consistent error handling):
  try {
    const result = await withErrorHandling(
      async () => {
        // Your operation here
        return await someOperation();
      },
      { operation: 'someOperation', context: 'important' }
    );
    return result;
  } catch (error) {
    // Error is already logged by withErrorHandling
    // You can still handle specific error types if needed
    if (error instanceof AmbianceError) {
      switch (error.code) {
        case ErrorCode.NETWORK_ERROR:
          // Handle network errors specifically
          break;
        case ErrorCode.RATE_LIMIT_ERROR:
          // Handle rate limiting
          break;
        default:
          // Handle other errors
          break;
      }
    }
    throw error; // Re-throw for caller to handle
  }
}

/**
 * Example 5: Creating specific errors for your domain
 */
export function exampleDomainErrors() {
  // You can extend the error system for your specific domain
  class DatabaseError extends AmbianceError {
    constructor(operation: string, table: string, details?: Record<string, unknown>) {
      super(
        ErrorCode.INTERNAL_ERROR,
        `Database operation '${operation}' failed on table '${table}'`,
        { operation, table, ...details }
      );
      this.name = 'DatabaseError';
    }
  }

  try {
    throw new DatabaseError('INSERT', 'users', { userId: 123, email: 'test@example.com' });
  } catch (error) {
    const mcpError = handleError(error, { service: 'userService' }, { rethrow: false });
    logger.error('Database error', { code: mcpError.code, message: mcpError.message });
  }
}

/**
 * Example 6: Error handling in API client (like apiClient.ts)
 */
export async function exampleAPIClientErrorHandling() {
  try {
    const response = await fetch('/api/data');

    if (!response.ok) {
      // Use specific error codes for API responses
      if (response.status === 404) {
        throw new APIError(ErrorCode.FILE_NOT_FOUND, 'Resource not found', 404, {
          url: '/api/data',
        });
      } else if (response.status === 429) {
        throw new APIError(ErrorCode.RATE_LIMIT_ERROR, 'Rate limit exceeded', 429);
      } else {
        throw new APIError(ErrorCode.API_ERROR, `API error: ${response.status}`, response.status);
      }
    }

    return await response.json();
  } catch (error) {
    // handleError will categorize the error appropriately
    const mcpError = handleError(
      error,
      {
        operation: 'fetchData',
        url: '/api/data',
        method: 'GET',
      },
      { rethrow: false }
    );

    // You could return the MCP error for further processing
    return { success: false, error: mcpError };
  }
}

// Placeholder function for examples
async function someOperation(): Promise<{ success: boolean }> {
  // Simulate an operation that might fail
  if (Math.random() > 0.5) {
    throw new Error('Random failure');
  }
  return { success: true };
}
