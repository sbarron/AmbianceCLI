const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { contextRequestKey } = require('../dist/src/runtime/context/requestKey');

describe('supported adapter runtime', () => {
  test('import is silent and does not load providers or register process handlers', () => {
    const probe = spawnSync(
      process.execPath,
      [
        '-e',
        `
      const before = process.listenerCount('SIGINT');
      const r = require('./dist/src/runtime/api.js');
      if (process.listenerCount('SIGINT') !== before) throw Error('signal handler');
      if (Object.keys(require.cache).some(p => /embeddingGenerator|localEmbeddingProvider|cli\\.js$/.test(p))) throw Error('eager runtime');
      process.stdout.write(JSON.stringify({api:r.runtimeApiVersion, version:r.runtimeVersion}));
    `,
      ],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }
    );
    expect(probe.status).toBe(0);
    expect(probe.stderr).toBe('');
    expect(JSON.parse(probe.stdout)).toEqual({
      api: 1,
      version: require('../package.json').version,
    });
  });

  test.each([
    ['maxTokens', 3000],
    ['taskType', 'test'],
    ['excludePatterns', ['src/**']],
    ['astQueries', [{ pattern: 'call()' }]],
    ['embeddingSimilarityThreshold', 0.8],
    ['maxSimilarChunks', 40],
    ['useProjectHintsCache', false],
    ['autoSyncBatchSize', 25],
    ['query', 'q'.repeat(200) + 'different'],
  ])('isolates %s in concurrent request keys', (name, value) => {
    const args = { query: 'q'.repeat(200), taskType: 'understand', maxTokens: 1000 };
    expect(contextRequestKey(args, '/one')).not.toBe(
      contextRequestKey({ ...args, [name]: value }, '/one')
    );
  });

  test('canonicalizes property order and isolates project paths', () => {
    expect(contextRequestKey({ query: 'a', maxTokens: 1000 }, '/one')).toBe(
      contextRequestKey({ maxTokens: 1000, query: 'a' }, '/one')
    );
    expect(contextRequestKey({ query: 'a' }, '/one')).not.toBe(
      contextRequestKey({ query: 'a' }, '/two')
    );
  });

  test('real concurrent retrieval preserves task, budget, and project isolation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-runtime-'));
    try {
      for (const project of ['one', 'two']) {
        fs.mkdirSync(path.join(root, project));
        fs.writeFileSync(path.join(root, project, 'package.json'), '{"name":"fixture"}');
        fs.writeFileSync(
          path.join(root, project, 'source.ts'),
          `export function ${project}Anchor() { return '${project}'; }\n`
        );
      }
      const probe = spawnSync(
        process.execPath,
        [
          '-e',
          `
        const assert = require('assert/strict');
        const path = require('path');
        const {executeRuntime} = require('./dist/src/runtime/api.js');
        const base = {projectPath:path.join(process.env.RUNTIME_FIXTURE, 'one'),query:'oneAnchor',useEmbeddings:false};
        (async () => {
          const [small,big,other] = await Promise.all([
            executeRuntime('context',{...base,maxTokens:1000,taskType:'understand'}),
            executeRuntime('context',{...base,maxTokens:3000,taskType:'test'}),
            executeRuntime('context',{...base,projectPath:path.join(process.env.RUNTIME_FIXTURE,'two'),query:'twoAnchor',maxTokens:1000})
          ]);
          assert.notStrictEqual(small,big);
          for (const [r,anchor] of [[small,'oneAnchor'],[big,'oneAnchor'],[other,'twoAnchor']]) {
            assert.notEqual(r.success,false);
            assert.ok(r.content.includes(anchor), JSON.stringify(r));
            assert.equal(r.embeddingSync.enabled,false);
          }
          assert.ok(small.metadata.bundleTokens <= 1000);
          assert.ok(big.metadata.bundleTokens <= 3000);
          const cancelled = new AbortController(); cancelled.abort();
          await assert.rejects(executeRuntime('context',base,{signal:cancelled.signal}),{name:'AbortError'});
          process.stdout.write(JSON.stringify({success:true}));
        })().catch(e=>{console.error(e);process.exitCode=1;});
      `,
        ],
        {
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf8',
          timeout: 30000,
          env: {
            ...process.env,
            RUNTIME_FIXTURE: root,
            USE_LOCAL_EMBEDDINGS: 'false',
            LOG_LEVEL: 'silent',
            AMBIANCE_HOME: path.join(root, 'home'),
            NODE_ENV: 'production',
          },
        }
      );
      expect(probe.error).toBeUndefined();
      expect(probe.status).toBe(0);
      expect(JSON.parse(probe.stdout)).toEqual({ success: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 35000);
});
