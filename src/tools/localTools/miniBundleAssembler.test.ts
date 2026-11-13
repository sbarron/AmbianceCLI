import * as path from 'path';
import * as fs from 'fs';
import { assembleMiniBundle } from './miniBundleAssembler';
import type { JumpTarget } from './enhancedLocalContext';

jest.mock('fs');

it('preserves semantic frontier order despite a higher lexical score elsewhere', async () => {
  const files = ['agent/verifier.py', 'cli/context.ts'].map(relPath => ({
    absPath: path.resolve(relPath), relPath, size: 100, ext: path.extname(relPath), language: 'text',
  }));
  (fs.readFileSync as jest.Mock).mockImplementation((file: string) => file.endsWith('.py')
    ? '# Keep the decode policy with its implementation.\nvalue = "/* literal */"\nreturn open(file, errors="replace")'
    : 'export const unrelated = 100;');
  const targets: JumpTarget[] = files.map((file, i) => ({ file: file.absPath,
    symbol: i ? 'unrelated' : 'build_corpus', start: 1, end: i ? 1 : 3,
    role: i ? 'init' : 'semantic:code', relevance: i ? 0.9 : 0.5,
    confidence: 0.9, why: [] }));
  const bundle = await assembleMiniBundle(targets, files, 120);
  expect(bundle[0].symbol).toBe('build_corpus');
  expect(bundle[0].snippet).toContain('# Keep the decode policy');
  expect(bundle[0].snippet).toContain('"/* literal */"');
  expect(bundle[0].snippet).toContain('errors="replace"');
  expect(bundle[0].start).toBe(1);
  expect(bundle[0].end).toBe(3);
});

it('bounds a large excerpt by complete source lines and marks its actual range', async () => {
  const file = path.resolve('long.py');
  const source = Array.from({ length: 1000 }, (_, i) => `value_${i} = "original source"`).join('\n');
  (fs.readFileSync as jest.Mock).mockReturnValue(source);
  const bundle = await assembleMiniBundle([{ file, symbol: 'large', start: 1, end: 1000,
    role: 'semantic:code', confidence: 1, why: [] }], [], 150);
  expect(bundle[0].truncated).toBe(true);
  expect(bundle[0].snippet).toBe(source.split('\n').slice(0, bundle[0].end).join('\n'));
  expect(bundle[0].end).toBeLessThan(1000);
});
