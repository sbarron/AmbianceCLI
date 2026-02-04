/**
 * @fileOverview: Unit tests for the Logger utility
 * @module: Logger Tests
 * @description: Comprehensive test suite for Logger class covering console logging, file logging, log rotation, and error handling
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogContext } from '../logger';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
}));

// Mock path module
jest.mock('path', () => ({
  join: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;

describe('Logger', () => {
  let logger: Logger;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new Logger('Test');

    // Mock environment
    process.env.USERPROFILE = '/home/testuser';
    process.env.NODE_ENV = 'test';

    // Mock path.join to return predictable paths
    mockPath.join.mockImplementation((...args: string[]) => args.join('/'));

    // Mock fs operations
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({
      size: 1000,
      isFile: () => true,
      isDirectory: () => false,
      mtime: new Date(),
      ctime: new Date(),
      atime: new Date(),
      birthtime: new Date(),
      mode: 0o666,
      uid: 0,
      gid: 0,
      nlink: 1,
      dev: 0,
      ino: 0,
      rdev: 0,
      blksize: 4096,
      blocks: 0,
    } as any);
  });

  afterEach(() => {
    delete process.env.USERPROFILE;
    delete process.env.NODE_ENV;
    delete process.env.DEBUG;
  });

  describe('Constructor', () => {
    test('should initialize with default prefix', () => {
      const defaultLogger = new Logger();
      expect(defaultLogger).toBeDefined();
    });

    test('should initialize with custom prefix', () => {
      expect(logger).toBeDefined();
    });

    test('should initialize file logging when directory exists', () => {
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/home/testuser/.ambiance/logs/mcp-proxy.log',
        '',
        { encoding: 'utf8' }
      );
    });

    test('should handle file logging initialization failure gracefully', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const newLogger = new Logger('Test2');
      expect(newLogger).toBeDefined(); // Should not throw
    });
  });

  describe('Logging Methods', () => {
    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    test('should log info messages', () => {
      logger.info('Test message');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [Test] Test message'),
        ''
      );
    });

    test('should log warn messages', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('Warning message');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] [Test] Warning message'),
        ''
      );
      warnSpy.mockRestore();
    });

    test('should log error messages', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('Error message');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] [Test] Error message'),
        ''
      );
      errorSpy.mockRestore();
    });

    test('should log debug messages when DEBUG is set', () => {
      process.env.DEBUG = 'true';
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
      logger.debug('Debug message');
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] [Test] Debug message'),
        ''
      );
      debugSpy.mockRestore();
      delete process.env.DEBUG;
    });

    test('should not log debug messages when DEBUG is not set', () => {
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
      logger.debug('Debug message');
      expect(debugSpy).not.toHaveBeenCalled();
      debugSpy.mockRestore();
    });

    test('should include context in log messages', () => {
      const context: LogContext = { userId: 123, action: 'login' };
      logger.info('User action', context);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [Test] User action'),
        JSON.stringify(context)
      );
    });

    test('should handle empty context', () => {
      logger.info('No context');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [Test] No context'),
        ''
      );
    });
  });

  describe('File Logging', () => {
    test('should write to log file when available', () => {
      logger.info('File test message');
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        '/home/testuser/.ambiance/logs/mcp-proxy.log',
        expect.stringContaining('"level":"INFO"'),
        { encoding: 'utf8' }
      );
    });

    test('should handle file write errors gracefully', () => {
      mockFs.appendFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      // Should not throw
      expect(() => logger.info('Test')).not.toThrow();
    });
  });

  describe('Log Rotation', () => {
    test('should rotate logs when file exceeds max size', () => {
      // Mock large file
      mockFs.statSync.mockReturnValue({
        size: 15 * 1024 * 1024, // 15MB > 10MB limit
        isFile: () => true,
        isDirectory: () => false,
        mtime: new Date(),
        ctime: new Date(),
        atime: new Date(),
        birthtime: new Date(),
        mode: 0o666,
        uid: 0,
        gid: 0,
        nlink: 1,
        dev: 0,
        ino: 0,
        rdev: 0,
        blksize: 4096,
        blocks: 0,
      } as any);

      logger.info('Rotation test');

      // Should rotate existing logs and create new file
      expect(mockFs.renameSync).toHaveBeenCalledWith(
        '/home/testuser/.ambiance/logs/mcp-proxy.log',
        '/home/testuser/.ambiance/logs/mcp-proxy.log.1'
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/home/testuser/.ambiance/logs/mcp-proxy.log',
        '',
        { encoding: 'utf8' }
      );
    });

    test('should handle rotation errors gracefully', () => {
      mockFs.statSync.mockReturnValue({
        size: 15 * 1024 * 1024,
        isFile: () => true,
        isDirectory: () => false,
        mtime: new Date(),
        ctime: new Date(),
        atime: new Date(),
        birthtime: new Date(),
        mode: 0o666,
        uid: 0,
        gid: 0,
        nlink: 1,
        dev: 0,
        ino: 0,
        rdev: 0,
        blksize: 4096,
        blocks: 0,
      } as any);

      mockFs.renameSync.mockImplementation(() => {
        throw new Error('Rename failed');
      });

      // Should not throw
      expect(() => logger.info('Test')).not.toThrow();
    });

    test('should not rotate when file size is below limit', () => {
      logger.info('No rotation needed');
      expect(mockFs.renameSync).not.toHaveBeenCalled();
    });
  });

  describe('Log Entry Format', () => {
    test('should format log entries as valid JSON', () => {
      logger.info('JSON test');
      const appendCall = mockFs.appendFileSync.mock.calls[0];
      const logEntry = appendCall[1] as string;

      expect(() => JSON.parse(logEntry.trim())).not.toThrow();
      const parsed = JSON.parse(logEntry.trim());
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('level', 'INFO');
      expect(parsed).toHaveProperty('prefix', 'Test');
      expect(parsed).toHaveProperty('message', 'JSON test');
    });

    test('should include ISO timestamp', () => {
      const before = new Date();
      logger.info('Timestamp test');
      const after = new Date();

      const appendCall = mockFs.appendFileSync.mock.calls[0];
      const logEntry = JSON.parse((appendCall[1] as string).trim());
      const timestamp = new Date(logEntry.timestamp);

      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Environment-Specific Behavior', () => {
    test('should use console.info for INFO level in test environment', () => {
      process.env.NODE_ENV = 'test';
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      logger.info('Test env info');
      expect(infoSpy).toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      infoSpy.mockRestore();
      errorSpy.mockRestore();
    });

    test('should use console.debug for DEBUG level in test environment', () => {
      process.env.NODE_ENV = 'test';
      process.env.DEBUG = 'true';
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      logger.debug('Test env debug');
      expect(debugSpy).toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      debugSpy.mockRestore();
      errorSpy.mockRestore();
    });

    test('should use console.error for INFO level in production environment', () => {
      process.env.NODE_ENV = 'production';
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      logger.info('Prod env info');
      expect(infoSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      infoSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
