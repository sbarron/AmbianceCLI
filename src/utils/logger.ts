/**
 * @fileOverview: Simple structured logger for the MCP Server with file and console output
 * @module: Logger
 * @keyFunctions:
 *   - info(): Log informational messages with context
 *   - warn(): Log warning messages with context
 *   - error(): Log error messages with context
 *   - debug(): Log debug messages with environment-based filtering
 * @dependencies:
 *   - fs: File system operations for log file management
 *   - path: Path manipulation for log file location
 *   - console: Standard output for immediate logging
 * @context: Provides structured logging with both console and file output, ensuring logs are available in MCP stdio environments while maintaining persistent log files for debugging
 */
import * as fs from 'fs';
import * as path from 'path';

export interface LogContext {
  [key: string]: any;
}

export class Logger {
  private prefix: string;
  private logFilePath: string | null;
  private readonly maxSizeBytes = 10 * 1024 * 1024; // 10 MB
  private readonly maxArchives = 3;

  constructor(prefix: string = 'MCP') {
    this.prefix = prefix;
    this.logFilePath = this.initializeFileLogging();
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      this.log('INFO', message, context);
    }
  }

  warn(message: string, context?: LogContext): void {
    this.log('WARN', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('ERROR', message, context);
  }

  debug(message: string, context?: LogContext): void {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      this.log('DEBUG', message, context);
    }
  }

  private shouldLog(level: string): boolean {
    const logLevel = process.env.LOG_LEVEL?.toLowerCase() || 'info';

    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(logLevel);
    const messageLevelIndex = levels.indexOf(level.toLowerCase());

    // Log if message level is at or above current log level
    return messageLevelIndex >= currentLevelIndex;
  }

  private log(level: string, message: string, context?: LogContext): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      prefix: this.prefix,
      message,
      ...(context && { context }),
    };

    const formattedMessage = `[${timestamp}] ${level} [${this.prefix}] ${message}`;
    const contextStr = context ? JSON.stringify(context) : '';

    // IMPORTANT: Never write logs to stdout in MCP stdio mode; use stderr only
    switch (level) {
      case 'ERROR':
        console.error(formattedMessage, contextStr);
        break;
      case 'WARN':
        console.warn(formattedMessage, contextStr);
        break;
      case 'DEBUG':
        // Use console.debug for debug messages in tests, stderr in production
        if (process.env.NODE_ENV === 'test') {
          console.debug(formattedMessage, contextStr);
        } else {
          console.error(formattedMessage, contextStr);
        }
        break;
      default:
        // INFO level - use console.info in tests, stderr in production
        if (process.env.NODE_ENV === 'test') {
          console.info(formattedMessage, contextStr);
        } else {
          console.error(formattedMessage, contextStr);
        }
    }

    // Also write to file for environments where stdio is not surfaced (e.g., Cursor MCP)
    if (this.logFilePath) {
      try {
        this.rotateLogsIfNeeded();
        const line = JSON.stringify(logEntry) + '\n';
        fs.appendFileSync(this.logFilePath, line, { encoding: 'utf8' });
      } catch {
        // best-effort; ignore file logging errors
      }
    }
  }

  private initializeFileLogging(): string | null {
    try {
      const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
      const dir = path.join(home, '.ambiance', 'logs');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const logPath = path.join(dir, 'mcp-proxy.log');
      // Touch file
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '', { encoding: 'utf8' });
      }
      return logPath;
    } catch {
      return null;
    }
  }

  private rotateLogsIfNeeded(): void {
    if (!this.logFilePath) return;
    try {
      const stats = fs.existsSync(this.logFilePath) ? fs.statSync(this.logFilePath) : null;
      if (!stats || stats.size < this.maxSizeBytes) return;

      const base = this.logFilePath;
      const oldest = `${base}.${this.maxArchives}`;
      if (fs.existsSync(oldest)) {
        try {
          fs.unlinkSync(oldest);
        } catch {
          // best-effort; ignore file deletion errors
        }
      }

      for (let i = this.maxArchives - 1; i >= 1; i--) {
        const src = `${base}.${i}`;
        const dst = `${base}.${i + 1}`;
        if (fs.existsSync(src)) {
          try {
            fs.renameSync(src, dst);
          } catch {
            // best-effort; ignore file rename errors
          }
        }
      }

      if (fs.existsSync(base)) {
        try {
          fs.renameSync(base, `${base}.1`);
        } catch {
          // best-effort; ignore file rename errors
        }
      }
      try {
        fs.writeFileSync(base, '', { encoding: 'utf8' });
      } catch {
        // best-effort; ignore file write errors
      }
    } catch {
      // ignore rotation failures
    }
  }
}

// Default logger instance
export const logger = new Logger('Ambiance');
