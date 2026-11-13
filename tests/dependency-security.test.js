const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const merge = require(
  require.resolve('deepmerge', {
    paths: [path.dirname(require.resolve('jest-config/package.json'))],
  })
);

describe('dependency security boundaries', () => {
  const payload = () => JSON.parse('{"__proto__":{"isAdmin":true}}');
  test.each([
    ['null prototype', () => Object.create(null)],
    ['null placeholder', () => JSON.parse('{"__proto__":null}')],
    ['own data key', () => JSON.parse('{"__proto__":{"prior":true}}')],
  ])('merge result keeps its prototype with %s target', (label, target) => {
    const result = merge(target(), payload());
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.isAdmin).toBeUndefined();
    expect({}.isAdmin).toBeUndefined();
  });
  test('target copies and nested merges cannot install attacker prototypes', () => {
    const target = payload();
    target.nested = payload();
    const result = merge(target, { other: 1 });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(result.nested)).toBe(Object.prototype);
    expect(result.nested.isAdmin).toBeUndefined();
  });
  test('ordinary config merges retain symbols and custom array merge options', () => {
    const symbol = Symbol('config');
    const result = merge(
      { nested: { a: 1 }, values: [1], [symbol]: 'retained' },
      { nested: { b: 2 }, values: [2] },
      { arrayMerge: (left, right) => right }
    );
    expect(result.nested).toEqual({ a: 1, b: 2 });
    expect(result.values).toEqual([2]);
    expect(result[symbol]).toBe('retained');
    expect(merge.all([{ a: 1 }, { b: 2 }])).toEqual({ a: 1, b: 2 });
  });
  test('cross-realm custom credential headers are stripped on cross-origin redirect', async () => {
    let received;
    const destination = http.createServer((request, response) => {
      received = request.headers;
      response.end('ok');
    });
    const redirect = http.createServer((request, response) => {
      response.writeHead(302, { Location: `http://127.0.0.1:${destination.address().port}/` });
      response.end();
    });
    const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const close = server =>
      new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
      });
    try {
      await listen(destination);
      await listen(redirect);
      await new Promise((resolve, reject) => {
        require('follow-redirects')
          .http.get(
            `http://localhost:${redirect.address().port}/`,
            {
              family: 4,
              headers: { 'X-RC-Secret': 'fixture-secret', 'X-RC-Trace': 'kept' },
              sensitiveHeaders: vm.runInNewContext('["x-rc-secret"]'),
            },
            response => {
              response.resume();
              response.on('end', resolve);
            }
          )
          .on('error', reject);
      });
      expect(received['x-rc-secret']).toBeUndefined();
      expect(received['x-rc-trace']).toBe('kept');
    } finally {
      await close(redirect);
      await close(destination);
    }
  });
  test('glob stops directory traversal when cancellation occurs during the first read', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-glob-abort-'));
    try {
      for (let i = 0; i < 4; i++) {
        fs.mkdirSync(path.join(root, String(i), 'nested'), { recursive: true });
        fs.writeFileSync(path.join(root, String(i), 'nested', 'file.txt'), 'fixture');
      }
      const controller = new AbortController();
      let reads = 0;
      const observedFs = {
        ...fs,
        readdir(...args) {
          reads++;
          const callback = args.pop();
          fs.readdir(...args, (error, entries) => {
            if (!controller.signal.aborted) controller.abort(new Error('Stop traversal'));
            callback(error, entries);
          });
        },
      };
      const { glob } = require(
        require.resolve('glob', {
          paths: [path.dirname(require.resolve('@jest/reporters/package.json'))],
        })
      );
      await expect(
        glob('**/*', { cwd: root, signal: controller.signal, fs: observedFs })
      ).rejects.toThrow('Stop traversal');
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(reads).toBe(1);
    } finally {
      if (
        path.dirname(root) !== os.tmpdir() ||
        !path.basename(root).startsWith('ambiance-glob-abort-')
      )
        throw new Error('Unexpected fixture');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
