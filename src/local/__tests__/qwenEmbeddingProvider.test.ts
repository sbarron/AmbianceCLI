import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'stream';
import { spawn } from 'child_process';
import { QwenEmbeddingProvider, getQwenIdleTimeoutMs } from '../qwenEmbeddingProvider';
import { QWEN_REVISION, getLocalRetrievalProfile } from '../localRetrievalProfile';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

describe('shared bounded local encoder transport', () => {
  const original = { ...process.env };
  let provider: QwenEmbeddingProvider;
  let child: any;
  let requests: any[];
  let respond: (request: any) => any;
  beforeEach(() => {
    process.env.AMBIANCE_LOCAL_PROFILE = 'qwen3';
    delete process.env.AMBIANCE_QWEN_IDLE_MS;
    requests = [];
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.ref = jest.fn();
    child.unref = jest.fn();
    child.kill = jest.fn();
    respond = () => ({ vectors: [Array(512).fill(1 / Math.sqrt(512))], revision: QWEN_REVISION });
    child.stdin = new Writable({
      write(buffer, _encoding, done) {
        const request = JSON.parse(buffer.toString());
        requests.push(request);
        setTimeout(() => {
          const result = respond(request);
          if (result !== undefined)
            child.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
        }, 1);
        done();
      },
    });
    (spawn as jest.Mock).mockReset().mockReturnValue(child);
    provider = new QwenEmbeddingProvider();
  });

  test('construction does not start Python or load the model', () => {
    expect(spawn).not.toHaveBeenCalled();
  });

  test('the shared CLI profile remains lightweight unless explicitly selected', () => {
    delete process.env.AMBIANCE_LOCAL_PROFILE;
    expect(getLocalRetrievalProfile()).toBeUndefined();
    process.env.AMBIANCE_LOCAL_PROFILE = 'default';
    expect(getLocalRetrievalProfile()).toBeUndefined();
    process.env.AMBIANCE_LOCAL_PROFILE = 'qwen3';
    expect(getLocalRetrievalProfile()?.name).toBe('qwen3');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('validates explicit idle policy while preserving the CLI default', () => {
    expect(getQwenIdleTimeoutMs({})).toBe(60000);
    expect(getQwenIdleTimeoutMs({ AMBIANCE_QWEN_IDLE_MS: '300000' })).toBe(300000);
    expect(getQwenIdleTimeoutMs({ AMBIANCE_QWEN_IDLE_MS: '0' })).toBe(0);
    for (const value of ['', ' ', 'NaN', '-1', '1.5', '3600001'])
      expect(() => getQwenIdleTimeoutMs({ AMBIANCE_QWEN_IDLE_MS: value })).toThrow(
        'AMBIANCE_QWEN_IDLE_MS'
      );
  });

  test('unloads after the configured idle interval', async () => {
    await provider.dispose();
    process.env.AMBIANCE_QWEN_IDLE_MS = '2000';
    provider = new QwenEmbeddingProvider();
    jest.useFakeTimers();
    const result = provider.generateQueryEmbedding('question');
    await jest.advanceTimersByTimeAsync(5);
    await result;
    await jest.advanceTimersByTimeAsync(1990);
    expect(child.kill).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(10);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  test('explicit zero idle interval keeps the worker resident until disposal', async () => {
    await provider.dispose();
    process.env.AMBIANCE_QWEN_IDLE_MS = '0';
    provider = new QwenEmbeddingProvider();
    jest.useFakeTimers();
    const result = provider.generateQueryEmbedding('question');
    await jest.advanceTimersByTimeAsync(5);
    await result;
    await jest.advanceTimersByTimeAsync(3600001);
    expect(child.kill).not.toHaveBeenCalled();
    await provider.dispose();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
  afterEach(async () => {
    await provider.dispose();
    process.env = { ...original };
    jest.useRealTimers();
  });

  test('serializes document and instructed-query requests through one worker', async () => {
    const pending = [
      provider.generateEmbedding('source text'),
      provider.generateQueryEmbedding('coding question'),
    ];
    const result = await Promise.all(pending);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect((spawn as jest.Mock).mock.calls[0][2].env).toEqual(
      expect.objectContaining({ PYTHONIOENCODING: 'utf-8:strict', PYTHONUTF8: '1' })
    );
    expect(requests.map(value => value.query)).toEqual([false, true]);
    expect(result.every(value => value.dimensions === 512)).toBe(true);
  });

  test('rejects another checkpoint or incompatible vector dimensions', async () => {
    respond = () => ({ vectors: [Array(384).fill(0.1)], revision: QWEN_REVISION });
    await expect(provider.generateQueryEmbedding('question')).rejects.toThrow(
      'incompatible vectors'
    );
  });

  test('terminates its own stalled worker at the request deadline', async () => {
    jest.useFakeTimers();
    process.env.AMBIANCE_QWEN_TIMEOUT_MS = '1000';
    respond = () => undefined;
    const assertion = expect(provider.generateQueryEmbedding('question')).rejects.toThrow(
      'exceeded 1000 ms'
    );
    await jest.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
