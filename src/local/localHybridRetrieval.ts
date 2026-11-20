import * as crypto from 'crypto';
import type { EmbeddingChunk, LocalEmbeddingStorage } from './embeddingStorage';
import { getLocalRetrievalProfile } from './localRetrievalProfile';
import { isTurboQuantized } from './quantization';

const stop = new Set(
  'a an the of in to and or for is are do does what where how return report boolean string number with this that from on as by be it at all when if no not can has have'.split(
    ' '
  )
);
const words = (text: string) =>
  (
    text
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .match(/[a-z0-9]+/g) || []
  ).filter(word => !stop.has(word));
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const key = (chunk: EmbeddingChunk) =>
  `${chunk.filePath.replace(/\\/g, '/')}\0${String(chunk.chunkIndex).padStart(10, '0')}`;

/** Holds terms/postings and IDs, without retaining duplicate source or vector objects. */
export class CodeLexicalIndex {
  private postings = new Map<string, Array<{ id: string; frequency: number }>>();
  private lengths = new Map<string, number>();
  private keys = new Map<string, string>();
  private average: number;

  constructor(chunks: EmbeddingChunk[]) {
    for (const chunk of chunks) {
      const terms = words(chunk.filePath + '\n' + chunk.content);
      this.lengths.set(chunk.id, terms.length);
      this.keys.set(chunk.id, key(chunk));
      const counts = new Map<string, number>();
      for (const word of terms) counts.set(word, (counts.get(word) || 0) + 1);
      for (const [word, frequency] of counts) {
        const values = this.postings.get(word) || [];
        values.push({ id: chunk.id, frequency });
        this.postings.set(word, values);
      }
    }
    this.average =
      [...this.lengths.values()].reduce((sum, n) => sum + n, 0) / (chunks.length || 1) || 1;
  }

  search(query: string, limit = 50): Array<{ id: string; score: number }> {
    const scores = new Map<string, number>();
    for (const term of new Set(words(query))) {
      const values = this.postings.get(term) || [];
      const idf = Math.log(1 + (this.lengths.size - values.length + 0.5) / (values.length + 0.5));
      for (const { id, frequency } of values) {
        const score =
          (idf * frequency * 2.2) /
          (frequency + 1.2 * (0.25 + (0.75 * this.lengths.get(id)!) / this.average));
        scores.set(id, (scores.get(id) || 0) + score);
      }
    }
    return [...scores]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || compare(this.keys.get(a.id)!, this.keys.get(b.id)!))
      .slice(0, limit);
  }
}

const cache = new Map<string, CodeLexicalIndex>();

export async function retrieveLocalHybrid(
  storage: LocalEmbeddingStorage,
  projectId: string,
  query: string,
  vector: number[],
  eligible: (chunk: EmbeddingChunk) => boolean = () => true
) {
  const profile = getLocalRetrievalProfile();
  if (!profile) throw new Error('Hybrid quality retrieval requires the qwen3 profile.');
  const all = (await storage.getProjectEmbeddings(projectId)).filter(eligible);
  for (const chunk of all) {
    const value = chunk.embedding;
    if (
      chunk.metadata.embeddingProvider !== profile.provider ||
      !isTurboQuantized(value) ||
      value.dimensions !== 512 ||
      value.bits !== 4 ||
      value.rotationSeed !== 42
    ) {
      throw new Error(
        'The local quality index contains incompatible vectors. Rebuild this profile index.'
      );
    }
  }
  const lookup = new Map(all.map(chunk => [chunk.id, chunk]));
  const signature = crypto
    .createHash('sha256')
    .update(profile.identity)
    .update(
      JSON.stringify(
        all.map(chunk => [chunk.id, chunk.filePath, chunk.hash]).sort((a, b) => compare(a[0], b[0]))
      )
    )
    .digest('hex');
  let lexical = cache.get(signature);
  if (!lexical) {
    lexical = new CodeLexicalIndex(all);
    if (cache.size >= 4) cache.delete(cache.keys().next().value!);
    cache.set(signature, lexical);
  }
  const dense = (await storage.searchSimilarEmbeddings(projectId, vector, all.length, 0, all))
    .sort((a, b) => b.similarity - a.similarity || compare(key(a.chunk), key(b.chunk)))
    .slice(0, 50);
  const scores = new Map<string, number>();
  for (const ranking of [
    dense.map(item => item.chunk.id),
    lexical.search(query).map(item => item.id),
  ]) {
    ranking.forEach((id, i) => scores.set(id, (scores.get(id) || 0) + 1 / (60 + i + 1)));
  }
  const chunks = [...scores]
    .map(([id, score]) => ({ chunk: lookup.get(id)!, score }))
    .sort((a, b) => b.score - a.score || compare(key(a.chunk), key(b.chunk)))
    .slice(0, 50);
  return { chunks, totalChunks: all.length };
}
