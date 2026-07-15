const path = require('path');

jest.mock('fs');

describe('context ranking and snippets', () => {
  it('ranks exact symbol matches before semantic file matches', async () => {
    const { rankCandidatesWithScoring } = require('../src/tools/localTools/candidateRanking');

    const exactMatch = {
      file: 'src/runtime/embeddings/manageEmbeddings.ts',
      symbol: 'checkStaleFiles',
      start: 1053,
      end: 1269,
      kind: 'function',
      score: 0.2,
      reasons: ['symbol matches: checkStaleFiles'],
      role: 'symbol',
    };
    const semanticMatch = {
      file: 'src/local/enhancedSemanticCompactor.ts',
      symbol: 'enhancedSemanticCompactor',
      start: 789,
      end: 789,
      kind: 'export',
      score: 0.9,
      reasons: ['semantic context'],
      role: 'interface',
    };

    const ranked = await rankCandidatesWithScoring(
      [semanticMatch, exactMatch],
      { files: [], exports: [], imports: [], routes: [], env: [], systems: {} },
      'checkStaleFiles embeddingSync semanticCompact',
      'init-read-write',
      new Map([
        [semanticMatch.file, 0.95],
        [exactMatch.file, 0.3],
      ])
    );

    expect(ranked[0].symbol).toBe('checkStaleFiles');
    expect(ranked[0].scoreBreakdown.exactSymbolBoost).toBe(1);
  });

  it('extracts mini-bundle snippets around line-based jump targets', async () => {
    const { assembleMiniBundle } = require('../src/tools/localTools/miniBundleAssembler');
    const fs = require('fs');
    const filePath = path.join('src', 'target.ts');

    const content = Array.from({ length: 130 }, (_, index) => {
      const line = index + 1;
      if (line === 90) return 'export function targetFunction() {';
      if (line === 91) return '  return "target";';
      if (line === 92) return '}';
      return `const filler${line} = ${line};`;
    }).join('\n');
    fs.readFileSync.mockReturnValue(content);

    const bundle = await assembleMiniBundle(
      [
        {
          file: filePath,
          symbol: 'targetFunction',
          start: 90,
          end: 92,
          role: 'symbol',
          confidence: 1,
          why: ['symbol matches: targetFunction'],
        },
      ],
      [
        {
          absPath: filePath,
          relPath: 'target.ts',
          size: content.length,
          ext: '.ts',
          language: 'typescript',
        },
      ],
      1000
    );

    expect(bundle).toHaveLength(1);
    expect(bundle[0].snippet).toContain('targetFunction');
    expect(bundle[0].snippet).not.toContain('const filler1 = 1;');
  });
});
