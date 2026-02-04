import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('fs');
jest.mock('../../utils/logger');

const mockFs = fs as jest.Mocked<typeof fs>;

// Mock fs.watch to return a controllable EventEmitter
const mockWatcher = new EventEmitter() as any;
mockWatcher.close = jest.fn();

// Variable to capture the file change handler
let capturedHandler: ((eventType: string, filename: string | null) => void) | null = null;

// File watcher implementation for testing
class FileWatcher {
  private watchers: Map<string, any> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private onFileChange?: (filePath: string) => Promise<void>;

  constructor(onFileChange?: (filePath: string) => Promise<void>) {
    this.onFileChange = onFileChange;
  }

  async startWatching(projectPath: string, ignorePatterns: string[] = []): Promise<void> {
    if (this.watchers.has(projectPath)) {
      throw new Error(`Already watching: ${projectPath}`);
    }

    const watcher = mockFs.watch(projectPath, { recursive: true }, (eventType, filename) => {
      if (filename) {
        this.handleFileChange(eventType, path.join(projectPath, filename), ignorePatterns);
      }
    });

    this.watchers.set(projectPath, watcher);
  }

  async stopWatching(projectPath: string): Promise<void> {
    const watcher = this.watchers.get(projectPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(projectPath);

      // Clear any pending debounce timers for files in this project
      const normalizedProjectPath = path.resolve(projectPath);
      for (const [filePath, timer] of this.debounceTimers.entries()) {
        const normalizedFilePath = path.resolve(filePath);
        if (normalizedFilePath.startsWith(normalizedProjectPath)) {
          clearTimeout(timer);
          this.debounceTimers.delete(filePath);
        }
      }
    }
  }

  private handleFileChange(eventType: string, filePath: string, ignorePatterns: string[]): void {
    // Skip ignored files
    if (this.shouldIgnoreFile(filePath, ignorePatterns)) {
      return;
    }

    // Skip directories
    try {
      if (mockFs.statSync && mockFs.statSync(filePath).isDirectory()) {
        return;
      }
    } catch {
      // File might not exist anymore, continue anyway
    }

    // Debounce file changes
    const debounceKey = filePath;
    const existingTimer = this.debounceTimers.get(debounceKey);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(debounceKey);

      if (this.onFileChange) {
        try {
          await this.onFileChange(filePath);
        } catch (error) {
          console.error('Error handling file change:', error);
          // Ensure the error is properly propagated for testing
          throw error;
        }
      }
    }, 500); // 500ms debounce

    this.debounceTimers.set(debounceKey, timer);
  }

  private shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
    const filename = path.basename(filePath);

    return ignorePatterns.some(pattern => {
      if (pattern.includes('**')) {
        // Handle directory patterns like 'node_modules/**'
        const simplePattern = pattern.replace('/**', '').replace('**', '');
        return filePath.includes(simplePattern);
      }
      if (pattern.startsWith('*.')) {
        // Handle extension patterns like '*.min.js'
        const extension = pattern.slice(2);
        return filename.endsWith(`.${extension}`);
      }
      if (pattern.includes('*')) {
        // Handle patterns like 'test*.tmp'
        const regexPattern = pattern.replace(/\*/g, '.*');
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(filename);
      }
      // Handle exact matches or directory names
      return filePath.includes(pattern) || filename === pattern;
    });
  }

  getWatchedPaths(): string[] {
    return Array.from(this.watchers.keys());
  }

  isWatching(projectPath: string): boolean {
    return this.watchers.has(projectPath);
  }

  stopAll(): void {
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Stop all watchers
    for (const [projectPath, watcher] of this.watchers.entries()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

describe('File Watching Functionality', () => {
  let fileWatcher: FileWatcher;
  let onFileChangeMock: jest.MockedFunction<(filePath: string) => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Reset the mock watcher
    mockWatcher.removeAllListeners();

    // Reset captured handler
    capturedHandler = null;

    // Mock fs.watch to return our controlled watcher and capture the handler
    jest
      .spyOn(mockFs, 'watch')
      .mockImplementation((filename: any, options: any, listener?: any) => {
        if (listener) {
          capturedHandler = listener;
        }
        return mockWatcher as any;
      });

    // Mock fs.statSync
    jest.spyOn(mockFs, 'statSync').mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
      mtime: new Date(),
      size: 1000,
    } as any);

    onFileChangeMock = jest.fn<(filePath: string) => Promise<void>>().mockResolvedValue(void 0);
    fileWatcher = new FileWatcher(onFileChangeMock);
  });

  afterEach(() => {
    jest.useRealTimers();
    fileWatcher.stopAll();
  });

  describe('startWatching', () => {
    beforeEach(() => {
      fileWatcher.stopAll();
    });

    it('should start watching a project directory', async () => {
      await fileWatcher.startWatching('/test/project');

      expect(mockFs.watch).toHaveBeenCalledWith(
        '/test/project',
        { recursive: true },
        expect.any(Function)
      );
      expect(fileWatcher.isWatching('/test/project')).toBe(true);
    });

    it('should throw error when already watching the same path', async () => {
      await fileWatcher.startWatching('/test/project');

      await expect(fileWatcher.startWatching('/test/project')).rejects.toThrow(
        'Already watching: /test/project'
      );
    });

    it('should allow watching multiple different paths', async () => {
      await fileWatcher.startWatching('/test/project1');
      await fileWatcher.startWatching('/test/project2');

      expect(fileWatcher.isWatching('/test/project1')).toBe(true);
      expect(fileWatcher.isWatching('/test/project2')).toBe(true);
      expect(fileWatcher.getWatchedPaths()).toEqual(['/test/project1', '/test/project2']);
    });
  });

  describe('stopWatching', () => {
    beforeEach(async () => {
      fileWatcher.stopAll();
      await fileWatcher.startWatching('/test/project');
    });

    it('should stop watching a project directory', async () => {
      expect(fileWatcher.isWatching('/test/project')).toBe(true);

      await fileWatcher.stopWatching('/test/project');

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(fileWatcher.isWatching('/test/project')).toBe(false);
    });

    it('should handle stopping non-existent watcher gracefully', async () => {
      await fileWatcher.stopWatching('/non/existent');

      // Should not throw error
      expect(mockWatcher.close).not.toHaveBeenCalled();
    });

    it('should clear debounce timers when stopping', async () => {
      // Trigger a file change
      if (capturedHandler) {
        capturedHandler('change', 'src/index.ts');
      }

      // Wait a bit to ensure the timer is set up but hasn't fired yet
      jest.advanceTimersByTime(100);

      // Stop watching (this should clear the timer)
      await fileWatcher.stopWatching('/test/project');

      // Fast forward past debounce period
      jest.advanceTimersByTime(600);

      // File change handler should not have been called
      expect(onFileChangeMock).not.toHaveBeenCalled();
    });
  });

  describe('file change handling', () => {
    beforeEach(async () => {
      await fileWatcher.startWatching('/test/project', ['node_modules/**', '*.log']);
    });

    it('should handle file changes with debouncing', () => {
      // Trigger multiple rapid changes to same file
      if (capturedHandler) {
        capturedHandler('change', 'src/index.ts');
        capturedHandler('change', 'src/index.ts');
        capturedHandler('change', 'src/index.ts');
      }

      // Should not have called handler yet (debounced)
      expect(onFileChangeMock).not.toHaveBeenCalled();

      // Fast forward past debounce period
      jest.advanceTimersByTime(600);

      // Should have called handler only once
      expect(onFileChangeMock).toHaveBeenCalledTimes(1);
      expect(onFileChangeMock).toHaveBeenCalledWith(path.join('/test/project', 'src/index.ts'));
    });

    it('should handle multiple files changing', () => {
      // Trigger changes to different files
      if (capturedHandler) {
        capturedHandler('change', 'src/index.ts');
        capturedHandler('change', 'src/utils.ts');
        capturedHandler('change', 'package.json');
      }

      // Fast forward past debounce period
      jest.advanceTimersByTime(600);

      // Should have called handler for each unique file
      expect(onFileChangeMock).toHaveBeenCalledTimes(3);
      expect(onFileChangeMock).toHaveBeenCalledWith(path.join('/test/project', 'src/index.ts'));
      expect(onFileChangeMock).toHaveBeenCalledWith(path.join('/test/project', 'src/utils.ts'));
      expect(onFileChangeMock).toHaveBeenCalledWith(path.join('/test/project', 'package.json'));
    });

    it('should ignore files matching ignore patterns', () => {
      // Trigger changes to ignored files
      if (capturedHandler) {
        capturedHandler('change', 'node_modules/express/index.js');
        capturedHandler('change', 'app.log');
        capturedHandler('change', 'error.log');
      }

      // Fast forward past debounce period
      jest.advanceTimersByTime(600);

      // Should not have called handler for ignored files
      expect(onFileChangeMock).not.toHaveBeenCalled();
    });

    it('should ignore directory changes', () => {
      // Mock statSync to return directory for this test
      jest.spyOn(mockFs, 'statSync').mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as any);

      if (capturedHandler) {
        capturedHandler('change', 'src');
      }

      jest.advanceTimersByTime(600);

      expect(onFileChangeMock).not.toHaveBeenCalled();
    });

    it('should handle file stat errors gracefully', () => {
      // Mock statSync to throw error (file doesn't exist)
      jest.spyOn(mockFs, 'statSync').mockImplementation(() => {
        throw new Error('File not found');
      });

      if (capturedHandler) {
        capturedHandler('change', 'deleted-file.ts');
      }

      jest.advanceTimersByTime(600);

      // Should still call handler even if file doesn't exist
      expect(onFileChangeMock).toHaveBeenCalledWith(path.join('/test/project', 'deleted-file.ts'));
    });

    it('should handle errors in file change callback', async () => {
      // Create a new file watcher with a callback that throws
      const errorFileWatcher = new FileWatcher(async () => {
        throw new Error('Processing failed');
      });

      // Mock fs.watch to capture the handler
      let capturedErrorHandler: ((eventType: string, filename: string | null) => void) | null =
        null;
      const originalWatch = mockFs.watch;
      mockFs.watch.mockImplementation(
        (
          filename: any,
          options: any,
          listener?: (eventType: string, filename: string | null) => void
        ) => {
          if (listener) {
            capturedErrorHandler = listener;
          }
          return mockWatcher as any;
        }
      );

      await errorFileWatcher.startWatching('/test/project');

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Trigger a file change through the captured handler
      if (capturedErrorHandler) {
        capturedErrorHandler('change', 'src/index.ts');
      }

      // Advance timers to trigger the callback
      jest.advanceTimersByTime(600);

      // The error should be logged
      expect(consoleSpy).toHaveBeenCalledWith('Error handling file change:', expect.any(Error));

      consoleSpy.mockRestore();
      await errorFileWatcher.stopWatching('/test/project');

      // Restore the original mock
      mockFs.watch = originalWatch;
    });

    it('should reset debounce timer for subsequent changes to same file', () => {
      // First change
      if (capturedHandler) {
        capturedHandler('change', 'src/index.ts');
      }

      // Advance time partially (not enough to trigger)
      jest.advanceTimersByTime(300);
      expect(onFileChangeMock).not.toHaveBeenCalled();

      // Second change to same file (should reset timer)
      if (capturedHandler) {
        capturedHandler('change', 'src/index.ts');
      }

      // Advance time by another 300ms (total 600ms from first, 300ms from second)
      jest.advanceTimersByTime(300);
      expect(onFileChangeMock).not.toHaveBeenCalled();

      // Advance another 300ms (600ms from second change)
      jest.advanceTimersByTime(300);
      expect(onFileChangeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('ignore patterns', () => {
    beforeEach(() => {
      // Stop any existing watchers from parent beforeEach
      fileWatcher.stopAll();
    });

    it('should handle wildcard patterns', async () => {
      await fileWatcher.startWatching('/test/project', ['*.min.js', 'test*.tmp']);

      // Clear mock call history
      onFileChangeMock.mockClear();

      // Should ignore these
      if (capturedHandler) {
        capturedHandler('change', 'bundle.min.js');
        capturedHandler('change', 'testfile.tmp');

        // Should not ignore this
        capturedHandler('change', 'bundle.js');
      }

      jest.advanceTimersByTime(600);

      expect(onFileChangeMock).toHaveBeenCalledTimes(1);
      expect(onFileChangeMock).toHaveBeenCalledWith(path.join('/test/project', 'bundle.js'));
    });

    it('should handle directory patterns with **', async () => {
      await fileWatcher.startWatching('/test/project', ['node_modules/**', 'dist/**']);

      // Should ignore these
      if (capturedHandler) {
        capturedHandler('change', 'node_modules/express/index.js');
        capturedHandler('change', 'dist/bundle.js');

        // Should not ignore this
        capturedHandler('change', 'src/index.js');
      }

      jest.advanceTimersByTime(600);

      expect(onFileChangeMock).toHaveBeenCalledTimes(1);
      expect(onFileChangeMock).toHaveBeenCalledWith(path.join('/test/project', 'src/index.js'));
    });

    it('should handle empty ignore patterns', async () => {
      await fileWatcher.startWatching('/test/project', []);

      if (capturedHandler) {
        capturedHandler('change', 'any-file.js');
      }

      jest.advanceTimersByTime(600);

      expect(onFileChangeMock).toHaveBeenCalledWith(path.join('/test/project', 'any-file.js'));
    });
  });

  describe('watcher state management', () => {
    beforeEach(() => {
      fileWatcher.stopAll();
    });

    it('should track watched paths correctly', async () => {
      expect(fileWatcher.getWatchedPaths()).toEqual([]);

      await fileWatcher.startWatching('/project1');
      expect(fileWatcher.getWatchedPaths()).toEqual(['/project1']);

      await fileWatcher.startWatching('/project2');
      expect(fileWatcher.getWatchedPaths()).toEqual(['/project1', '/project2']);

      await fileWatcher.stopWatching('/project1');
      expect(fileWatcher.getWatchedPaths()).toEqual(['/project2']);
    });

    it('should stop all watchers', async () => {
      await fileWatcher.startWatching('/project1');
      await fileWatcher.startWatching('/project2');
      await fileWatcher.startWatching('/project3');

      expect(fileWatcher.getWatchedPaths()).toHaveLength(3);

      fileWatcher.stopAll();

      expect(fileWatcher.getWatchedPaths()).toEqual([]);
      expect(mockWatcher.close).toHaveBeenCalledTimes(3);
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      fileWatcher.stopAll();
    });

    it('should handle null/undefined filenames from fs.watch', async () => {
      await fileWatcher.startWatching('/test/project');

      // Simulate fs.watch calling with null filename
      if (capturedHandler) {
        capturedHandler('change', null);
        capturedHandler('change', null);
      }

      jest.advanceTimersByTime(600);

      // Should not have called file change handler
      expect(onFileChangeMock).not.toHaveBeenCalled();
    });

    it('should handle fs.watch errors', async () => {
      jest.spyOn(mockFs, 'watch').mockImplementation(() => {
        throw new Error('Watch failed');
      });

      await expect(fileWatcher.startWatching('/test/project')).rejects.toThrow('Watch failed');
    });

    it('should handle very rapid file changes efficiently', () => {
      fileWatcher.startWatching('/test/project');

      // Simulate 100 rapid changes
      if (capturedHandler) {
        for (let i = 0; i < 100; i++) {
          capturedHandler('change', 'src/index.ts');
        }
      }

      jest.advanceTimersByTime(600);

      // Should have debounced to only 1 call
      expect(onFileChangeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('without callback', () => {
    beforeEach(() => {
      fileWatcher.stopAll();
    });

    it('should work without file change callback', async () => {
      const watcherWithoutCallback = new FileWatcher();

      await watcherWithoutCallback.startWatching('/test/project');

      if (capturedHandler) {
        capturedHandler('change', 'src/index.ts');
      }

      jest.advanceTimersByTime(600);

      // Should not throw error even without callback
      expect(() => {
        jest.advanceTimersByTime(600);
      }).not.toThrow();

      watcherWithoutCallback.stopAll();
    });
  });
});
