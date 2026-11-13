import { compactSourceEvidence } from './compactSourceEvidence';

function block(file: string, start: number, lines: string[], symbol = 'helper') {
  return `### ${symbol} (${file}:${start}-${start + lines.length - 1})\n\n\`\`\`typescript\n${lines.join('\n')}\n\`\`\``;
}
function coverage(text: string) {
  const found = new Set<string>();
  const blocks = /^### .+ \((.+):(\d+)-(\d+)\)\n\n```[^\n]*\n([\s\S]*?)\n```/gm;
  for (const match of text.matchAll(blocks)) {
    match[4].split('\n').forEach((line, i) => found.add(`${match[1]}:${Number(match[2]) + i}:${line}`));
  }
  return found;
}

it('removes overlap while preserving every source line, pointer and query', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `const original_${i} = "unmodified source and comments";`);
  const original = 'Query: inspect helper\n\n## Key locations\n- helper: src/a.ts:1-50\n\n' +
    block('src/a.ts', 1, lines.slice(0, 40)) + '\n\n' + block('src/a.ts', 20, lines.slice(19));
  const compact = compactSourceEvidence(original);
  expect(coverage(compact)).toEqual(coverage(original));
  expect(compact).toContain('### helper (src/a.ts:41-50)');
  expect(compact).toContain('- helper: src/a.ts:1-50');
  expect(compact.length).toBeLessThan(original.length);
});

it('omits fully repeated bodies without mixing files or conflicting source versions', () => {
  const first = block('src/a.ts', 1, ['const value = 1;']);
  const second = block('src/b.ts', 1, ['const value = 1;']);
  const conflict = block('src/a.ts', 1, ['const value = 2;']);
  const original = [first, first, second, conflict, first].join('\n\n');
  const compact = compactSourceEvidence(original);
  expect(coverage(compact)).toEqual(coverage(original));
  expect(compact).toContain(second);expect(compact).toContain(conflict);
});

it('leaves unverified ranges unchanged and never backfills freed space', () => {
  const malformed = '### helper (src/a.ts:1-100)\n\n```ts\nonly one line\n```';
  expect(compactSourceEvidence(malformed)).toBe(malformed);
  expect(compactSourceEvidence('## Key locations\n- a: src/a.ts:1')).toBe('## Key locations\n- a: src/a.ts:1');
});

it('does not treat markdown examples inside source as outer evidence blocks', () => {
  const example = ['### fake (same.ts:1-1)', '', '```ts', 'const literal = 1;', '```'];
  const original = block('src/a.ts', 1, example) + '\n\n' + block('src/b.ts', 1, example);
  expect(compactSourceEvidence(original)).toBe(original);
});
