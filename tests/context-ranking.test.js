const path = require('path');

jest.mock('fs');

describe('context ranking and snippets', () => {
  it('scores relative route recency against its indexed project file instead of server cwd', async () => {
    const { rankCandidatesWithScoring } = require('../src/tools/localTools/candidateRanking');
    const fs = require('fs');
    const absolute = path.resolve('other-project', 'src', 'route.ts');
    fs.statSync.mockImplementation(file => {
      if (file !== absolute) throw Error('not the indexed project path');
      return { mtime: new Date() };
    });
    try {
      const ranked = await rankCandidatesWithScoring(
        [{ file: 'src/route.ts', symbol: 'launchRoute', start: 1, end: 2,
          kind: 'export', score: 0.85, reasons: ['api:route'], role: 'request handler' }],
        { files: [{ absPath: absolute, relPath: 'src/route.ts', ext: '.ts', size: 50 }],
          exports: [], imports: [], routes: [], env: [], systems: {} },
        'launchRoute', 'api-route'
      );
      expect(ranked[0].scoreBreakdown.recencyBoost).toBe(1);
      expect(fs.statSync).toHaveBeenCalledWith(absolute);
    } finally {
      fs.statSync.mockReset();
    }
  });

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

  it('reads relative route source from the indexed project when the server runs elsewhere', async () => {
    const { assembleMiniBundle } = require('../src/tools/localTools/miniBundleAssembler');
    const fs = require('fs');
    const absolute = path.resolve('other-project', 'app', 'api', 'run', 'route.ts');
    fs.readFileSync.mockImplementation(file => {
      if (file !== absolute) throw Error('not the indexed project path');
      return 'export async function POST() {\n  return launch();\n}';
    });
    try {
      const bundle = await assembleMiniBundle(
        [{ file: 'app/api/run/route.ts', symbol: 'POST /api/run', start: 1, end: 3,
          role: 'request handler', confidence: 0.85, why: ['api:route'] }],
        [{ absPath: absolute, relPath: 'app/api/run/route.ts', ext: '.ts', size: 60 }],
        6000
      );
      expect(bundle).toHaveLength(1);
      expect(bundle[0].file).toBe('app/api/run/route.ts');
      expect(bundle[0].snippet).toContain('return launch()');
      expect(fs.readFileSync).toHaveBeenCalledWith(absolute, 'utf8');
    } finally {
      fs.readFileSync.mockReset();
    }
  });
});
