/**
 * @fileOverview: Centralized error handling system for Ambiance MCP
 * @module: ErrorHandler
 * @keyFunctions:
 *   - createError(): Standardized error creation with context
 *   - handleError(): Unified error handling with logging and recovery
 *   - isRetryableError(): Determine if an error should trigger a retry
 *   - getErrorCode(): Extract error codes for programmatic handling
 * @dependencies:
 *   - logger: Logging utilities for error tracking
 *   - Custom error classes for specific error types
 * @context: Provides consistent error handling across the entire MCP server, ensuring proper logging, user feedback, and error recovery
 */

import { logger } from './logger'; // Main Logger

/**
 * Custom error types for different categories of errors
 */
export enum ErrorCode {
  // Configuration errors
  MISSING_CONFIG = 'MISSING_CONFIG',
  INVALID_CONFIG = 'INVALID_CONFIG',

  // API errors
  API_ERROR = 'API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',

  // File system errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  FILESYSTEM_ERROR = 'FILESYSTEM_ERROR',

  // AI/ML errors
  AI_SERVICE_ERROR = 'AI_SERVICE_ERROR',
  AI_TIMEOUT_ERROR = 'AI_TIMEOUT_ERROR',
  AI_RATE_LIMIT_ERROR = 'AI_RATE_LIMIT_ERROR',

  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',

  // Search errors
  SEARCH_FAILED = 'SEARCH_FAILED',
  INDEX_ERROR = 'INDEX_ERROR',

  // Generic errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface MCPError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  originalError?: Error;
  timestamp?: string;
  context?: Record<string, unknown>;
}

export interface ErrorHandlingOptions {
  logLevel?: 'error' | 'warn' | 'info';
  includeStack?: boolean;
  includeContext?: boolean;
  rethrow?: boolean;
  retryable?: boolean;
}

/**
 * Custom error classes for better error type checking
 */
export class AmbianceError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AmbianceError';
    this.code = code;
    this.details = details;
    this.context = context;
  }
}

export class ValidationError extends AmbianceError {
  constructor(field: string, message: string, context?: Record<string, unknown>) {
    super(
      ErrorCode.VALIDATION_ERROR,
      `Validation error for ${field}: ${message}`,
      { field },
      context
    );
    this.name = 'ValidationError';
  }
}

export class APIError extends AmbianceError {
  public readonly statusCode?: number;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode?: number,
    details?: Record<string, unknown>
  ) {
    super(code, message, { statusCode, ...details });
    this.name = 'APIError';
    this.statusCode = statusCode;
  }
}

export class FileSystemError extends AmbianceError {
  public readonly path?: string;

  constructor(code: ErrorCode, message: string, path?: string, details?: Record<string, unknown>) {
    super(code, message, { path, ...details });
    this.name = 'FileSystemError';
    this.path = path;
  }
}

/**
 * Centralized error handler for the MCP server
 */
export class MCPErrorHandler {
  /**
   * Create a standardized MCP error from any error type
   */
  static createError(error: unknown, context?: Record<string, unknown>): MCPError {
    const timestamp = new Date().toISOString();

    if (error instanceof AmbianceError) {
      return {
        code: error.code,
        message: error.message,
        details: error.details,
        originalError: error,
        timestamp,
        context: { ...error.context, ...context },
      };
    }

    if (error instanceof Error) {
      // Handle specific error types based on message patterns
      if (error.message.includes('DATABASE_URL') || error.message.includes('OPENAI_API_KEY')) {
        return {
          code: ErrorCode.MISSING_CONFIG,
          message: 'Required configuration is missing. Please check environment variables.',
          details: { originalError: error.message },
          originalError: error,
          timestamp,
          context,
        };
      }

      if (error.message.includes('network') || error.message.includes('ECONNREFUSED')) {
        return {
          code: ErrorCode.NETWORK_ERROR,
          message: 'Network connection failed',
          details: { originalError: error.message },
          originalError: error,
          timestamp,
          context,
        };
      }

      if (error.message.includes('timeout')) {
        return {
          code: ErrorCode.AI_TIMEOUT_ERROR,
          message: 'Operation timed out',
          details: { originalError: error.message },
          originalError: error,
          timestamp,
          context,
        };
      }

      if (error.message.includes('rate limit') || error.message.includes('429')) {
        return {
          code: ErrorCode.RATE_LIMIT_ERROR,
          message: 'Rate limit exceeded, please try again later',
          details: { originalError: error.message },
          originalError: error,
          timestamp,
          context,
        };
      }

      if (error.message.includes('Search failed')) {
        return {
          code: ErrorCode.SEARCH_FAILED,
          message: 'Search operation failed',
          details: { originalError: error.message },
          originalError: error,
          timestamp,
          context,
        };
      }

      if (error.message.includes('permission') || error.message.includes('EACCES')) {
        return {
          code: ErrorCode.PERMISSION_ERROR,
          message: 'Permission denied',
          details: { originalError: error.message },
          originalError: error,
          timestamp,
          context,
        };
      }

      if (error.message.includes('ENOENT') || error.message.includes('file not found')) {
        return {
          code: ErrorCode.FILE_NOT_FOUND,
          message: 'File or directory not found',
          details: { originalError: error.message },
          originalError: error,
          timestamp,
          context,
        };
      }

      // Generic error handling
      return {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An internal error occurred',
        details: { originalError: error.message },
        originalError: error,
        timestamp,
        context,
      };
    }

    // Unknown error type
    return {
      code: ErrorCode.UNKNOWN_ERROR,
      message: 'An unknown error occurred',
      details: { error: String(error) },
      timestamp,
      context,
    };
  }

  /**
   * Unified error handling method with logging and optional rethrowing
   */
  static handleError(
    error: unknown,
    context?: Record<string, unknown>,
    options: ErrorHandlingOptions = {}
  ): MCPError {
    const {
      logLevel = 'error',
      includeStack = true,
      includeContext = true,
      rethrow = true,
      retryable,
    } = options;

    const mcpError = this.createError(error, context);

    // Log the error with appropriate level
    const logContext = {
      code: mcpError.code,
      ...(includeContext && mcpError.context),
      ...(includeStack && mcpError.originalError?.stack && { stack: mcpError.originalError.stack }),
    };

    switch (logLevel) {
      case 'warn':
        logger.warn(mcpError.message, logContext);
        break;
      case 'info':
        logger.info(mcpError.message, logContext);
        break;
      default:
        logger.error(mcpError.message, logContext);
    }

    // Override retryable if explicitly set
    if (retryable !== undefined) {
      mcpError.details = { ...mcpError.details, retryable };
    }

    if (rethrow) {
      // Re-throw the original error for backward compatibility
      if (error instanceof Error) {
        throw error;
      }
      // For unknown errors, throw a new AmbianceError
      throw new AmbianceError(mcpError.code, mcpError.message, mcpError.details, mcpError.context);
    }

    return mcpError;
  }

  /**
   * Determine if an error is retryable
   */
  static isRetryableError(error: MCPError): boolean {
    // Check if explicitly marked as retryable/non-retryable
    if (error.details?.retryable !== undefined) {
      return Boolean(error.details.retryable);
    }

    const retryableCodes = [
      ErrorCode.NETWORK_ERROR,
      ErrorCode.AI_TIMEOUT_ERROR,
      ErrorCode.RATE_LIMIT_ERROR,
      ErrorCode.API_ERROR,
    ];

    return retryableCodes.includes(error.code);
  }

  /**
   * Extract error code from any error type
   */
  static getErrorCode(error: unknown): ErrorCode {
    return this.createError(error).code;
  }

  /**
   * Create a user-friendly error message
   */
  static getUserFriendlyMessage(error: MCPError): string {
    switch (error.code) {
      case ErrorCode.MISSING_CONFIG:
        return 'Please check your configuration and environment variables.';
      case ErrorCode.NETWORK_ERROR:
        return 'Please check your internet connection and try again.';
      case ErrorCode.RATE_LIMIT_ERROR:
        return 'Rate limit exceeded. Please wait a moment and try again.';
      case ErrorCode.FILE_NOT_FOUND:
        return 'The requested file or directory could not be found.';
      case ErrorCode.PERMISSION_ERROR:
        return 'Permission denied. Please check file permissions.';
      case ErrorCode.AI_TIMEOUT_ERROR:
        return 'The operation timed out. Please try again with a smaller request.';
      default:
        return 'An unexpected error occurred. Please try again or contact support.';
    }
  }

  /**
   * Wrap async functions with error handling
   */
  static async withErrorHandling<T>(
    fn: () => Promise<T>,
    context?: Record<string, unknown>,
    options?: ErrorHandlingOptions
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.handleError(error, context, { ...options, rethrow: true });
      // This line won't be reached due to rethrow, but TypeScript needs it
      throw error;
    }
  }

  /**
   * Wrap sync functions with error handling
   */
  static withSyncErrorHandling<T>(
    fn: () => T,
    context?: Record<string, unknown>,
    options?: ErrorHandlingOptions
  ): T {
    try {
      return fn();
    } catch (error) {
      this.handleError(error, context, { ...options, rethrow: true });
      // This line won't be reached due to rethrow, but TypeScript needs it
      throw error;
    }
  }
}

// Export convenience functions
export const createError = MCPErrorHandler.createError;
export const handleError = MCPErrorHandler.handleError;
export const isRetryableError = MCPErrorHandler.isRetryableError;
export const getErrorCode = MCPErrorHandler.getErrorCode;
export const getUserFriendlyMessage = MCPErrorHandler.getUserFriendlyMessage;
export const withErrorHandling = MCPErrorHandler.withErrorHandling;
export const withSyncErrorHandling = MCPErrorHandler.withSyncErrorHandling;
