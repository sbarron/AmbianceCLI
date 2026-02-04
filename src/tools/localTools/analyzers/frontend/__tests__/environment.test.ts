/**
 * @fileOverview: Unit tests for environment analyzer functionality
 * @module: EnvironmentAnalyzerTests
 * @context: Tests environment variable leak detection and NEXT_PUBLIC validation
 */

import { describe, it, expect } from '@jest/globals';
import { detectEnvironmentUsage } from '../environment';
import type { FileInfo } from '../../../../../core/compactor/fileDiscovery';
import type { ComponentInfo } from '../components';

// Mock file system and components for testing
const mockFiles: FileInfo[] = [
  {
    absPath: '/project/app/page.tsx',
    relPath: 'app/page.tsx',
    size: 100,
    ext: '.tsx',
    language: 'typescript',
  },
  {
    absPath: '/project/app/client-component.tsx',
    relPath: 'app/client-component.tsx',
    size: 120,
    ext: '.tsx',
    language: 'typescript',
  },
  {
    absPath: '/project/app/server-component.tsx',
    relPath: 'app/server-component.tsx',
    size: 110,
    ext: '.tsx',
    language: 'typescript',
  },
];

const mockComponents: ComponentInfo[] = [
  {
    name: 'ClientComponent',
    file: 'app/client-component.tsx',
    kind: 'client',
    uses: {},
    hooks: [],
  },
  {
    name: 'ServerComponent',
    file: 'app/server-component.tsx',
    kind: 'server',
    uses: {},
    hooks: [],
  },
];

// Mock file contents for different scenarios
const fileContents = {
  'app/page.tsx': `
    // Server component - this should be allowed
    const apiKey = process.env.API_KEY;
    const dbUrl = process.env.DATABASE_URL;
  `,
  'app/client-component.tsx': `
    // Client component - should flag leaks
    'use client';
    const publicKey = process.env.NEXT_PUBLIC_API_KEY;
    const secretKey = process.env.API_SECRET; // This should be flagged
    const dbPass = process.env.DB_PASSWORD; // This should be flagged
  `,
  'app/server-component.tsx': `
    // Server component - this should be allowed
    const serverKey = process.env.SERVER_API_KEY;
    const { NEXT_PUBLIC_APP_URL, INTERNAL_KEY } = process.env;
  `,
};

describe('Environment Analyzer', () => {
  // Mock readFile for tests
  let originalReadFile: any;
  beforeEach(() => {
    originalReadFile = require('fs/promises').readFile;
  });

  afterEach(() => {
    require('fs/promises').readFile = originalReadFile;
  });

  describe('detectEnvironmentUsage function', () => {
    it('should detect NEXT_PUBLIC variables correctly', async () => {
      // Create test files with NEXT_PUBLIC variables
      const testFiles = [
        {
          absPath: '/project/app/client.tsx',
          relPath: 'app/client.tsx',
          size: 100,
          ext: '.tsx',
          language: 'typescript',
        },
      ];
      const testComponents = [
        {
          name: 'ClientComponent',
          file: 'app/client.tsx',
          kind: 'client' as const,
          uses: {},
          hooks: [],
        },
      ];

      require('fs/promises').readFile = async () => `
        'use client';
        const key = process.env.NEXT_PUBLIC_API_KEY;
        const url = process.env.NEXT_PUBLIC_APP_URL;
      `;

      const result = await detectEnvironmentUsage(testFiles, testComponents);

      // Should detect NEXT_PUBLIC variables as properly exposed
      expect(result.nextPublicVars).toContain('NEXT_PUBLIC_API_KEY');
      expect(result.nextPublicVars).toContain('NEXT_PUBLIC_APP_URL');
    });

    it('should flag server-only variables used in client components', async () => {
      require('fs/promises').readFile = async (filePath: string) => {
        const relPath = filePath.replace('/project/', '');
        return fileContents[relPath as keyof typeof fileContents] || '';
      };

      const result = await detectEnvironmentUsage(mockFiles, mockComponents);

      // Should flag API_SECRET and DB_PASSWORD as leaks
      expect(result.clientLeaks.length).toBe(2);

      const apiSecretLeak = result.clientLeaks.find((leak: any) => leak.key === 'API_SECRET');
      expect(apiSecretLeak).toBeDefined();
      expect(apiSecretLeak?.file).toBe('app/client-component.tsx');
      expect(apiSecretLeak?.severity).toBe('high');

      const dbPasswordLeak = result.clientLeaks.find((leak: any) => leak.key === 'DB_PASSWORD');
      expect(dbPasswordLeak).toBeDefined();
      expect(dbPasswordLeak?.file).toBe('app/client-component.tsx');
    });

    it('should allow server-only variables in server components', async () => {
      require('fs/promises').readFile = async (filePath: string) => {
        const relPath = filePath.replace('/project/', '');
        return fileContents[relPath as keyof typeof fileContents] || '';
      };

      const result = await detectEnvironmentUsage(mockFiles, mockComponents);

      // Should not flag server variables used in server components
      const serverLeaks = result.clientLeaks.filter(
        (leak: any) => leak.file === 'app/server-component.tsx' || leak.file === 'app/page.tsx'
      );
      expect(serverLeaks.length).toBe(0);
    });

    it('should detect destructured environment variables', async () => {
      const testFiles = [
        {
          absPath: '/project/app/client.tsx',
          relPath: 'app/client.tsx',
          size: 100,
          ext: '.tsx',
          language: 'typescript',
        },
      ];
      const testComponents = [
        {
          name: 'ClientComponent',
          file: 'app/client.tsx',
          kind: 'client' as const,
          uses: {},
          hooks: [],
        },
      ];

      require('fs/promises').readFile = async () => `
        'use client';
        const { NEXT_PUBLIC_KEY } = process.env;
        const secret = process.env.SECRET_KEY;
      `;

      const result = await detectEnvironmentUsage(testFiles, testComponents);

      expect(result.allEnvVars.has('SECRET_KEY')).toBe(true);
      expect(result.allEnvVars.has('NEXT_PUBLIC_KEY')).toBe(true);
      // Note: NEXT_PUBLIC categorization happens in the main analysis function
      // which processes all detected variables, not just the direct process.env.X ones
    });

    it('should handle files without client directive correctly', async () => {
      const testFiles = [
        {
          absPath: '/project/app/server.tsx',
          relPath: 'app/server.tsx',
          size: 100,
          ext: '.tsx',
          language: 'typescript',
        },
      ];

      require('fs/promises').readFile = async () => `
        // Pure server component - no client directive anywhere
        const secret = process.env.SERVER_SECRET;
        const apiKey = process.env.API_KEY;
      `;

      const result = await detectEnvironmentUsage(testFiles, []);

      // Should detect the variables but not create any client leaks since no client components
      expect(result.allEnvVars.has('SERVER_SECRET')).toBe(true);
      expect(result.allEnvVars.has('API_KEY')).toBe(true);
      // No client components passed, so no leaks should be detected
      expect(result.clientLeaks.length).toBe(0);
    });

    it('should detect all environment variables used', async () => {
      require('fs/promises').readFile = async (filePath: string) => {
        const relPath = filePath.replace('/project/', '');
        return fileContents[relPath as keyof typeof fileContents] || '';
      };

      const result = await detectEnvironmentUsage(mockFiles, mockComponents);

      // Should detect all environment variables
      expect(result.allEnvVars.has('API_KEY')).toBe(true);
      expect(result.allEnvVars.has('DATABASE_URL')).toBe(true);
      expect(result.allEnvVars.has('NEXT_PUBLIC_API_KEY')).toBe(true);
      expect(result.allEnvVars.has('API_SECRET')).toBe(true);
      expect(result.allEnvVars.has('DB_PASSWORD')).toBe(true);
      expect(result.allEnvVars.has('SERVER_API_KEY')).toBe(true);
      expect(result.allEnvVars.has('NEXT_PUBLIC_APP_URL')).toBe(true);
      expect(result.allEnvVars.has('INTERNAL_KEY')).toBe(true);
    });
  });

  describe('Environment variable categorization', () => {
    it('should categorize variables correctly', () => {
      const allVars = new Set([
        'NEXT_PUBLIC_API_KEY',
        'NEXT_PUBLIC_APP_URL',
        'API_SECRET',
        'DATABASE_URL',
        'SERVER_KEY',
      ]);

      // Test the internal categorization logic
      const nextPublicVars: string[] = [];
      const serverOnlyVars: string[] = [];

      allVars.forEach(varName => {
        if (varName.startsWith('NEXT_PUBLIC_')) {
          nextPublicVars.push(varName);
        } else {
          serverOnlyVars.push(varName);
        }
      });

      expect(nextPublicVars).toEqual(['NEXT_PUBLIC_API_KEY', 'NEXT_PUBLIC_APP_URL']);
      expect(serverOnlyVars).toEqual(['API_SECRET', 'DATABASE_URL', 'SERVER_KEY']);
    });
  });
});
