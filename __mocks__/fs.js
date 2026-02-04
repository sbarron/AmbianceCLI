// Mock implementation of fs/promises for Jest tests
const stat = jest.fn().mockImplementation(async (filePath) => {
  // Return mock file stats - check if it's a directory path
  const isDir = filePath.includes('test-semantic-compactor') || filePath.endsWith('/') || filePath.includes('node_modules');
  return {
    size: isDir ? 0 : 1024, // 1KB for files, 0 for directories
    isFile: () => !isDir,
    isDirectory: () => isDir,
    mtime: new Date(),
    ctime: new Date(),
    atime: new Date()
  };
});

const readFile = jest.fn().mockImplementation(async (filePath) => {
  // Return mock file content based on the file path
  if (filePath.includes('utils.ts')) {
    return `
import { DataProcessor } from './processor';

/**
 * Formats a string by trimming and converting to title case
 * @param input - The input string to format
 * @returns The formatted string
 */
export function formatString(input: string): string {
  return input.trim().replace(/\\w\\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

/**
 * Validates input data
 * @param input - The input to validate
 * @returns The validated input
 * @throws Error if input is invalid
 */
export function validateInput(input: string): string {
  if (!input || input.trim().length === 0) {
    throw new Error('Input cannot be empty');
  }
  return input;
}

/**
 * Internal helper function
 */
function internalHelper(data: any): boolean {
  return data != null;
}
    `;
  }
  
  if (filePath.includes('index.ts')) {
    return `
import { formatString, validateInput } from './utils';
import { DataProcessor } from './processor';

/**
 * Main entry point for the application
 */
export function main(): void {
  const processor = new DataProcessor();
  const input = validateInput('test data');
  const formatted = formatString(input);
  processor.process(formatted);
}

export { formatString, validateInput } from './utils';
export { DataProcessor } from './processor';
    `;
  }
  
  // Specific content for duplicate files
  if (filePath.includes('internal.ts')) {
    return `
function internalFunction(param: string): string {
  return param.toUpperCase();
}
    `;
  }
  
  if (filePath.includes('exported.ts')) {
    return `
export function internalFunction(param: string): string {
  return param.toUpperCase();
}
    `;
  }
  
  if (filePath.includes('invalid.ts')) {
    return `
invalid typescript syntax {{{
    `;
  }
  
  // Default mock content for other files
  return `
export function testFunction(): string {
  return 'test';
}
  `;
});

const mkdtemp = jest.fn().mockImplementation(async (prefix) => {
  return `/tmp/${prefix}${Math.random().toString(36).substr(2, 9)}`;
});

const mkdir = jest.fn().mockResolvedValue();

const rmdir = jest.fn().mockResolvedValue();

const rm = jest.fn().mockResolvedValue();

const writeFile = jest.fn().mockResolvedValue();
const writeFileSync = jest.fn().mockReturnValue(undefined);

const readdir = jest.fn().mockImplementation(async (path) => {
  return [
    { name: 'test.ts', isFile: () => true, isDirectory: () => false },
    { name: 'index.ts', isFile: () => true, isDirectory: () => false },
    { name: 'utils.ts', isFile: () => true, isDirectory: () => false }
  ];
});

const realpath = jest.fn().mockImplementation(async (path) => {
  return path; // Just return the same path for mocking
});

const access = jest.fn().mockResolvedValue(); // File exists

// Mock main fs object structure
const promises = {
  stat,
  readFile,
  mkdtemp,
  mkdir,
  rmdir,
  rm,
  writeFile,
  readdir,
  realpath,
  access
};

const watch = jest.fn().mockReturnValue({
  close: jest.fn(),
  on: jest.fn()
});

const realpathSync = jest.fn().mockImplementation((path) => path);

const readFileSync = jest.fn().mockImplementation((filePath, options) => {
  // Return appropriate type based on options
  if (options === 'utf8' || (options && options.encoding === 'utf8')) {
    // Return content for .gitignore-like files
    if (filePath.endsWith('.gitignore')) {
      return `
# Comments should be ignored
node_modules/
*.log
dist/

# Blank lines should be ignored

.env
.env.local
          `;
    }
    if (filePath.endsWith('.cursorignore')) {
      return `
.cursor/
*.cursor-*
cursor-logs/
          `;
    }
    if (filePath.endsWith('.vscodeignore')) {
      return `
.vscode/settings.json
.vscode/launch.json
*.code-workspace
          `;
    }
    if (filePath.endsWith('.ambianceignore')) {
      return `
# Ambiance-specific ignores
coverage/
*.tmp
*.swp
docs/_build/
          `;
    }
    // Return JSON for .ambiance/local-projects.json files
    if (filePath.endsWith('local-projects.json') || filePath.includes('local-projects.json')) {
      return JSON.stringify([
        {
          id: 'test-project-id',
          name: 'test-project',
          path: '/test/project',
          addedAt: new Date().toISOString(),
          lastIndexed: new Date().toISOString()
        }
      ]);
    }

    // For TypeScript/JavaScript files, return appropriate content
    if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
      return `
export function testFunction(): string {
  return 'test';
}
      `;
    }

    return 'mock file content';
  } else {
    // Return buffer for binary reads
    return Buffer.from('mock file content');
  }
});

const statSync = jest.fn().mockReturnValue({
  isFile: () => true,
  isDirectory: () => false,
  size: 1024,
  mtime: new Date()
});

const existsSync = jest.fn().mockImplementation((path) => {
  // Return true for directories, false for files that don't exist
  if (path.includes('test-storage') || path.includes('test.db') || path.includes('.ambiance')) {
    return false; // Database files don't exist initially
  }
  return true; // Most other paths exist
});
const mkdirSync = jest.fn().mockImplementation((path, options) => {
  // Mock successful directory creation
  return undefined;
});
const rmSync = jest.fn().mockReturnValue(undefined);
const readdirSync = jest.fn().mockReturnValue(['test1.ts', 'test2.ts']);

module.exports = {
  promises,
  watch,
  realpathSync,
  readFileSync,
  statSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
  // Also export individual functions for direct imports
  stat,
  readFile,
  mkdtemp,
  mkdir,
  rmdir,
  rm,
  writeFile,
  writeFileSync,
  readdir,
  realpath,
  access
};
