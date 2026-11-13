// Test-only observer for the installed package. Normal runs use real inference.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pkg = process.env.RC_PACKAGE_ROOT;
const usage = { inferenceInputs: 0, interrupted: false };
process.on('exit', () => fs.writeFileSync(process.env.RC_USAGE_FILE, JSON.stringify(usage)));
const { LocalEmbeddingProvider } = require(
  path.join(pkg, 'dist/src/local/localEmbeddingProvider.js')
);
const initialize = LocalEmbeddingProvider.prototype.initializePipeline;
LocalEmbeddingProvider.prototype.initializePipeline = async function () {
  const tf = await import(
    pathToFileURL(require.resolve('@huggingface/transformers', { paths: [pkg] })).href
  );
  tf.env.cacheDir = process.env.RC_MODEL_CACHE;
  tf.env.allowRemoteModels = process.env.RC_OFFLINE !== '1';
  await initialize.call(this);
  if (this.__rcObserved) return;
  const tokenizer = this.pipeline.tokenizer;
  this.pipeline.tokenizer = new Proxy(tokenizer, {
    apply(target, receiver, args) {
      const count = value => {
        usage.inferenceInputs += Number(value.attention_mask?.dims?.[0] || 1);
        return value;
      };
      const result = Reflect.apply(target, receiver, args);
      return result instanceof Promise ? result.then(count) : count(result);
    },
  });
  this.__rcObserved = true;
};
if (process.env.RC_FAIL_INFERENCE === '1' || process.env.RC_FAIL_INFERENCE_FILE) {
  const generate = LocalEmbeddingProvider.prototype.generateEmbeddings;
  LocalEmbeddingProvider.prototype.generateEmbeddings = async function (texts, ...args) {
    if (
      process.env.RC_FAIL_INFERENCE === '1' ||
      texts.some(text =>
        text.replace(/\\/g, '/').startsWith('File: ' + process.env.RC_FAIL_INFERENCE_FILE + '\n')
      )
    ) {
      throw new Error('Acceptance injected inference failure');
    }
    return generate.call(this, texts, ...args);
  };
}
if (process.env.RC_INTERRUPT_FILE) {
  const { LocalEmbeddingStorage } = require(path.join(pkg, 'dist/src/local/embeddingStorage.js'));
  const remove = LocalEmbeddingStorage.prototype.deleteEmbeddingsByFile;
  LocalEmbeddingStorage.prototype.deleteEmbeddingsByFile = async function (id) {
    const file = await this.getFileMetadata(id);
    const result = await remove.call(this, id);
    if (file?.path.replace(/\\/g, '/') === process.env.RC_INTERRUPT_FILE) {
      usage.interrupted = true;
      process.exit(86); // Persisted incomplete revision must be repaired by the next process.
    }
    return result;
  };
}
