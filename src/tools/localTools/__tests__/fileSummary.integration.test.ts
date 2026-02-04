/**
 * @fileOverview: Integration tests for file summary tool
 * @module: fileSummaryIntegrationTests
 * @description: Tests with real file system and ast-grep execution (no mocks)
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import * as path from 'path';
import { handleFileSummary } from '../fileSummary';

// No mocks - use real file system and ast-grep
const testFilesDir = path.join(__dirname, '../test-files');

describe('File Summary Integration Tests', () => {
  const pythonPath = path.join(testFilesDir, 'simple_python.py');
  const goPath = path.join(testFilesDir, 'simple_go.go');
  const rustPath = path.join(testFilesDir, 'simple_rust.rs');
  const javaPath = path.join(testFilesDir, 'simple_java.java');
  const jsonPath = path.join(testFilesDir, 'simple.json');
  const unknownPath = path.join(testFilesDir, 'unknown.txt');
  const nonExistentPath = '/nonexistent/test.py';

  beforeAll(async () => {
    // Integration tests use real file system and ast-grep
  });

  it('should analyze Python file and extract 2 symbols (function + class)', async () => {
    const result = await handleFileSummary({
      filePath: pythonPath,
      includeSymbols: true,
      maxSymbols: 10,
      format: 'structured',
    });

    expect(result.success).toBe(true);
    expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(2); // At least function/class via fallback
    expect(result.summary).toContain('Functions');
    expect(result.summary).toContain('my_func');
    expect(result.summary).toContain('Classes');
    expect(result.summary).toContain('MyClass');
    expect(result.metadata.complexity).toBe('low');
    expect(result.metadata.language).toBe('python');
  });

  it('should analyze Go file and extract 1+ function symbols', async () => {
    const result = await handleFileSummary({
      filePath: goPath,
      includeSymbols: true,
      maxSymbols: 10,
      format: 'structured',
    });

    expect(result.success).toBe(true);
    expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(1); // At least 1 function via fallback
    expect(result.summary).toContain('Functions');
    expect(result.summary).toContain('myFunc');
    expect(result.metadata.language).toBe('go');
  });

  it('should analyze Rust file and extract function symbols', async () => {
    const result = await handleFileSummary({
      filePath: rustPath,
      includeSymbols: true,
      maxSymbols: 10,
      format: 'structured',
    });

    expect(result.success).toBe(true);
    expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(1); // At least 1 function
    expect(result.summary).toContain('my_func');
    expect(result.metadata.language).toBe('rust');
  });

  it('should analyze Java file and extract class + method symbols', async () => {
    const result = await handleFileSummary({
      filePath: javaPath,
      includeSymbols: true,
      maxSymbols: 10,
      format: 'structured',
    });

    expect(result.success).toBe(true);
    expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(2); // At least class/method via fallback
    expect(result.summary).toContain('MyClass');
    expect(result.summary).toContain('sayHello');
    expect(result.metadata.language).toBe('java');
  });

  it('should analyze JSON with deep nesting and extract keys/symbols', async () => {
    const result = await handleFileSummary({
      filePath: jsonPath,
      includeSymbols: true,
      maxSymbols: 10,
      format: 'structured',
    });

    expect(result.success).toBe(true);
    expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(5); // At least name, nested, obj, key1, deep
    expect(result.summary).toContain('JSON configuration');
    expect(result.summary).toContain('nested');
    expect(result.metadata.language).toBe('json');
    expect(result.jsonInfo?.hasNesting).toBe(true);
    expect(result.jsonInfo?.depth).toBeGreaterThan(1);
  });

  it('should handle unknown language with 0 symbols and fallback', async () => {
    const result = await handleFileSummary({
      filePath: unknownPath,
      includeSymbols: true,
      maxSymbols: 10,
      format: 'structured',
    });

    expect(result.success).toBe(true);
    expect(result.metadata.symbolCount).toBe(0);
    expect(result.summary).toContain('Plain text file');
    expect(result.metadata.language).toBe('text');
  });

  it('should handle non-existent file with error fallback', async () => {
    const result = await handleFileSummary({
      filePath: nonExistentPath,
      includeSymbols: true,
      maxSymbols: 10,
      format: 'structured',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
    expect(result.fallback).toContain('Could not analyze');
  });

  it('should format output correctly for structured (default)', async () => {
    const result = await handleFileSummary({
      filePath: pythonPath,
      includeSymbols: true,
      format: 'structured',
    });

    expect(result.metadata.format).toBe('structured');
    expect(result.summary).toContain('# 📄 File Analysis');
    expect(result.summary).toContain('Symbol Count');
  });

  it('should handle XML format output', async () => {
    const result = await handleFileSummary({
      filePath: pythonPath,
      includeSymbols: true,
      format: 'xml',
    });

    expect(result.metadata.format).toBe('xml');
    expect(result.summary).toContain('<file>');
    expect(result.summary).toContain('<symbols>');
  });

  it('should compute complexity correctly (low for simple files)', async () => {
    const result = await handleFileSummary({
      filePath: pythonPath,
      includeSymbols: true,
      format: 'structured',
    });

    expect(result.metadata.complexity).toBe('low');
    expect(result.summary).toContain('low');
  });
});
