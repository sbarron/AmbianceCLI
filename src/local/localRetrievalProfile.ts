import * as crypto from 'crypto';

export const QWEN_MODEL = 'Qwen/Qwen3-Embedding-0.6B';
export const QWEN_REVISION = 'c54f2e6e80b2d7b7de06f51cec4959f6b3e03418';
export const QWEN_QUERY_INSTRUCTION =
  'Given a coding question, retrieve relevant source code that helps answer it.';

/** Index identity includes every setting that changes document vectors or their codec. */
const specification = {
  version: 1,
  model: QWEN_MODEL,
  revision: QWEN_REVISION,
  dimensions: 512,
  maxLength: 512,
  pooling: 'last-token',
  normalize: true,
  input: 'contextual-o200k256-overlap4-v2-utf8',
  queryInstruction: QWEN_QUERY_INSTRUCTION,
  quantization: 'turbo4' as const,
  rotationSeed: 42,
};
const identity = JSON.stringify(specification);
const fingerprint = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16);

export function getLocalRetrievalProfile() {
  const selected = process.env.AMBIANCE_LOCAL_PROFILE?.trim().toLowerCase();
  if (!selected || selected === 'default') return undefined;
  if (selected !== 'qwen3') throw new Error('Unknown local profile. Use default or qwen3.');
  return {
    ...specification,
    name: 'qwen3' as const,
    identity,
    provider: `local-qwen3-${fingerprint}`,
    storageKey: `qwen3-${fingerprint}`,
  };
}
