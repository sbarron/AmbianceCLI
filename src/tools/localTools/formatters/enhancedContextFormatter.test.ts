import * as path from 'path';
import { formatEnhancedContextOutput } from './enhancedContextFormatter';
import type { LocalContextResponse } from '../enhancedLocalContext';
import { estimateTokens } from '../../utils/toolHelpers';

const root = path.resolve('fixture');
function response(): LocalContextResponse {
  const required = { file: path.join(root, 'cli/src/required.ts'), symbol: 'requestedHelper',
    start: 40, end: 44, role: 'helper', relevance: 0.99, confidence: 0.9, why: ['query match'],
    snippet: 'function requestedHelper() {\n  return "evidence";\n}' };
  return { success: true, answerDraft: 'Verbose analysis '.repeat(1000),
    jumpTargets: [required, ...Array.from({ length: 20 }, (_, i) => ({ ...required,
      file: path.join(root, `cli/src/noise${i}.ts`), symbol: `noise${i}`, relevance: 0.1 }))],
    miniBundle: [{ file: 'cli/src/noise0.ts', symbol: 'noise0', snippet: 'const noise = 0;\n'.repeat(100), byteLen: 1700 },
      { file: 'cli/src/required.ts', symbol: required.symbol, snippet: required.snippet, byteLen: 60 }],
    next: { mode: 'code_lookup', openFiles: ['cli/src/required.ts:40-44'], checks: [] }, evidence: [],
    metadata: { filesScanned: 21, symbolsConsidered: 21, originalTokens: 0, compactedTokens: 0,
      bundleTokens: 1000, processingTimeMs: 1 } };
}

it('keeps relevant source ahead of verbose metadata and preserves nested package paths', () => {
  const text = formatEnhancedContextOutput(response(), 'inspect required helper', 300, 'enhanced', root);
  expect(text).toContain('return "evidence";');
  expect(text).toContain('cli/src/required.ts:40-44');
  expect(estimateTokens(text)).toBeLessThanOrEqual(300);
  expect((text.match(/```/g)?.length || 0) % 2).toBe(0);
});

it('uses a bounded, labelled preview when a source block cannot fit', () => {
  const result = response();result.miniBundle = [result.miniBundle[1]];
  result.miniBundle[0].snippet = 'const enormous = 1;\n'.repeat(10000);
  const text = formatEnhancedContextOutput(result, '', 150, 'enhanced', root);
  expect(text).toContain('return "evidence";');
  expect(text).toContain('Excerpt; read cli/src/required.ts:40-44');
  expect(estimateTokens(text)).toBeLessThanOrEqual(150);
  expect(text.match(/```/g)?.length).toBe(2);
});

it('keeps index output as bounded navigable pointers', () => {
  const text = formatEnhancedContextOutput(response(), '', 100, 'index', root);
  expect(text).toContain('cli/src/required.ts:40-44');
  expect(text).not.toContain('```');
  expect(estimateTokens(text)).toBeLessThanOrEqual(100);
  expect(formatEnhancedContextOutput(response(), '', 0, 'enhanced', root)).toBe('');
});

it('retains the cross-module frontier before admitting distracting source bodies', () => {
  const result = response();
  result.jumpTargets[0] = { ...result.jumpTargets[0], file: path.join(root, 'agent/verifier.py'),
    symbol: 'build_corpus', relevance: 0.5 };
  result.jumpTargets[1].relevance = 0.99;
  result.miniBundle = [{ file: 'cli/src/noise0.ts', symbol: 'noise0',
    snippet: 'export const irrelevant = 1;\n'.repeat(1000), byteLen: 30000 }];
  const text = formatEnhancedContextOutput(result, '', 600, 'enhanced', root);
  expect(text).toContain('- build_corpus: agent/verifier.py:40-44');
  expect(text.indexOf('agent/verifier.py')).toBeLessThan(text.indexOf('cli/src/noise0.ts'));
  expect(estimateTokens(text)).toBeLessThanOrEqual(600);
});

it('labels source lines independently from the full symbol range', () => {
  const result = response();
  result.miniBundle = [{ file: 'cli/src/required.ts', symbol: 'requestedHelper',
    snippet: 'return "evidence";', byteLen: 18, start: 41, end: 41, truncated: true }];
  const text = formatEnhancedContextOutput(result, '', 600, 'enhanced', root);
  expect(text).toContain('### requestedHelper (cli/src/required.ts:41-41)');
  expect(text).toContain('Excerpt; read cli/src/required.ts:40-44');
});
