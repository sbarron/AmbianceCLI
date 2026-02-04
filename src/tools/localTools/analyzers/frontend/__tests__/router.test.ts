/**
 * @fileOverview: Unit tests for router analyzer functionality
 * @module: RouterAnalyzerTests
 * @context: Tests route path mapping, dynamic routes, and HTTP method extraction
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { nextRoutePath, analyzeRoutes, extractRouteMethods } from '../router';
import type { FileInfo } from '../../../../../core/compactor/fileDiscovery';

// Mock file system for testing
const mockFiles: FileInfo[] = [
  {
    absPath: '/project/app/page.tsx',
    relPath: 'app/page.tsx',
    size: 100,
    ext: '.tsx',
    language: 'typescript',
  },
  {
    absPath: '/project/app/dashboard/page.tsx',
    relPath: 'app/dashboard/page.tsx',
    size: 150,
    ext: '.tsx',
    language: 'typescript',
  },
  {
    absPath: '/project/app/users/[id]/page.tsx',
    relPath: 'app/users/[id]/page.tsx',
    size: 120,
    ext: '.tsx',
    language: 'typescript',
  },
  {
    absPath: '/project/app/blog/[...slug]/page.tsx',
    relPath: 'app/blog/[...slug]/page.tsx',
    size: 130,
    ext: '.tsx',
    language: 'typescript',
  },
  {
    absPath: '/project/app/files/[[...path]]/page.tsx',
    relPath: 'app/files/[[...path]]/page.tsx',
    size: 140,
    ext: '.tsx',
    language: 'typescript',
  },
  {
    absPath: '/project/app/(marketing)/pricing/page.tsx',
    relPath: 'app/(marketing)/pricing/page.tsx',
    size: 110,
    ext: '.tsx',
    language: 'typescript',
  },
  {
    absPath: '/project/app/api/users/route.ts',
    relPath: 'app/api/users/route.ts',
    size: 160,
    ext: '.ts',
    language: 'typescript',
  },
];

describe('Router Analyzer', () => {
  describe('nextRoutePath function', () => {
    it('should handle root page correctly', () => {
      expect(nextRoutePath('app/page.tsx')).toBe('/');
    });

    it('should handle static routes', () => {
      expect(nextRoutePath('app/dashboard/page.tsx')).toBe('/dashboard');
    });

    it('should convert dynamic routes [id] to :id', () => {
      expect(nextRoutePath('app/users/[id]/page.tsx')).toBe('/users/:id');
    });

    it('should convert catch-all routes [...slug] to *slug', () => {
      expect(nextRoutePath('app/blog/[...slug]/page.tsx')).toBe('/blog/*slug');
    });

    it('should convert optional catch-all routes [[...path]] to *path?', () => {
      expect(nextRoutePath('app/files/[[...path]]/page.tsx')).toBe('/files/*path?');
    });

    it('should ignore route groups (parentheses)', () => {
      expect(nextRoutePath('app/(marketing)/pricing/page.tsx')).toBe('/pricing');
    });

    it('should handle nested routes', () => {
      expect(nextRoutePath('app/dashboard/users/[id]/page.tsx')).toBe('/dashboard/users/:id');
    });

    it('should handle API routes', () => {
      expect(nextRoutePath('app/api/users/route.ts')).toBe('/api/users');
    });

    it('should handle pages with different extensions', () => {
      expect(nextRoutePath('app/about/page.ts')).toBe('/about');
      expect(nextRoutePath('app/contact/page.js')).toBe('/contact');
      expect(nextRoutePath('app/portfolio/page.jsx')).toBe('/portfolio');
    });
  });

  describe('extractRouteMethods function', () => {
    it('should extract GET method from route.ts', async () => {
      const content = `
        export async function GET() {
          return Response.json({ message: 'Hello' });
        }
      `;
      // Mock readFile for this test
      const originalReadFile = require('fs/promises').readFile;
      require('fs/promises').readFile = async () => content;

      const methods = await extractRouteMethods('/fake/path/route.ts');
      expect(methods).toContain('GET');

      // Restore original
      require('fs/promises').readFile = originalReadFile;
    });

    it('should extract multiple HTTP methods', async () => {
      const content = `
        export async function GET() { return Response.json({}); }
        export async function POST() { return Response.json({}); }
        export async function PUT() { return Response.json({}); }
      `;
      const originalReadFile = require('fs/promises').readFile;
      require('fs/promises').readFile = async () => content;

      const methods = await extractRouteMethods('/fake/path/route.ts');
      expect(methods).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT']));

      require('fs/promises').readFile = originalReadFile;
    });

    it('should handle const function exports', async () => {
      const content = `
        export const GET = async () => { return Response.json({}); }
      `;
      const originalReadFile = require('fs/promises').readFile;
      require('fs/promises').readFile = async () => content;

      const methods = await extractRouteMethods('/fake/path/route.ts');
      expect(methods).toContain('GET');

      require('fs/promises').readFile = originalReadFile;
    });
  });

  describe('analyzeRoutes function', () => {
    it('should analyze routes from file list', async () => {
      const routes = await analyzeRoutes(mockFiles);

      // Should find routes for pages
      expect(routes.length).toBeGreaterThan(0);

      // Check for root route
      const rootRoute = routes.find(r => r.path === '/');
      expect(rootRoute).toBeDefined();
      expect(rootRoute?.files.page).toBe('app/page.tsx');

      // Check for dynamic route
      const userRoute = routes.find(r => r.path === '/users/:id');
      expect(userRoute).toBeDefined();
      expect(userRoute?.files.page).toBe('app/users/[id]/page.tsx');

      // Check for catch-all route
      const blogRoute = routes.find(r => r.path === '/blog/*slug');
      expect(blogRoute).toBeDefined();
      expect(blogRoute?.files.page).toBe('app/blog/[...slug]/page.tsx');
    });

    it('should handle route groups correctly', async () => {
      const routes = await analyzeRoutes(mockFiles);

      // Route group should be ignored, showing direct path
      const pricingRoute = routes.find(r => r.path === '/pricing');
      expect(pricingRoute).toBeDefined();
      expect(pricingRoute?.files.page).toBe('app/(marketing)/pricing/page.tsx');
    });

    it('should sort routes by path', async () => {
      const routes = await analyzeRoutes(mockFiles);

      // Routes should be sorted alphabetically
      const paths = routes.map(r => r.path);
      const sortedPaths = [...paths].sort();
      expect(paths).toEqual(sortedPaths);
    });
  });
});
