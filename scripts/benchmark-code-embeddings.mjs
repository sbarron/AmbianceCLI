import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  pipeline,
} from '@huggingface/transformers';

const projectPath = process.argv[2];
if (!projectPath) {
  throw new Error('Usage: node scripts/benchmark-code-embeddings.mjs <project-path>');
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORED_DIRECTORIES = new Set(['.git', '.next', 'dist', 'build', 'node_modules', 'tests']);
const CHUNK_SIZE = 1600;
const CHUNK_OVERLAP = 250;
const BATCH_SIZE = 8;
const RERANKER_MODEL = 'cross-encoder/ms-marco-MiniLM-L-6-v2';
const RERANK_FILE_COUNT = 20;

// Retrieval probes target this repository's own source tree. To benchmark
// against Ambiance itself, pass the repo root as <project-path>; adjust the
// probes when pointing the script at a different project.
const probes = [
  {
    query: 'where is semantic context compaction handled to build token-budgeted evidence bundles',
    required: 'src/runtime/context/semanticCompact.ts',
  },
  {
    query: 'how are embedding vectors quantized to 2-bit and 4-bit TurboQuant format',
    required: 'src/local/turboQuantization.ts',
  },
  {
    query: 'where are candidate code chunks ranked for relevance before assembling a mini bundle',
    required: 'src/tools/localTools/candidateRanking.ts',
  },
  {
    query: 'how does structural AST pattern search run ast-grep rules against project files',
    required: 'src/runtime/grep/astGrep.ts',
  },
  {
    query: 'where are Codex session JSONL transcripts normalized into portable handoff events',
    required: 'src/runtime/handoff/adapters/codexAdapter.ts',
  },
  {
    query: 'how are local embeddings persisted and loaded from SQLite storage',
    required: 'src/local/embeddingStorage.ts',
  },
];

async function findSourceFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : findSourceFiles(absolutePath, root);
    }
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [absolutePath] : [];
  }));
  return nested.flat();
}

function splitIntoChunks(filePath, relativePath, text) {
  const chunks = [];
  for (let start = 0; start < text.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
    const end = Math.min(text.length, start + CHUNK_SIZE);
    chunks.push({
      file: relativePath,
      text: `// File: ${relativePath}\n${text.slice(start, end)}`,
    });
    if (end === text.length) break;
  }
  return chunks;
}

async function encode(extractor, texts) {
  const vectors = [];
  for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
    const batch = texts.slice(offset, offset + BATCH_SIZE);
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    const dimensions = output.dims.at(-1);
    for (let index = 0; index < batch.length; index++) {
      vectors.push(output.data.slice(index * dimensions, (index + 1) * dimensions));
    }
  }
  return vectors;
}

function cosine(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index++) score += left[index] * right[index];
  return score;
}

function rankFiles(queryVector, chunks, chunkVectors) {
  const bestByFile = new Map();
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const score = cosine(queryVector, chunkVectors[chunkIndex]);
    const current = bestByFile.get(chunks[chunkIndex].file);
    if (!current || score > current.score) {
      bestByFile.set(chunks[chunkIndex].file, { ...chunks[chunkIndex], score, chunkIndex });
    }
  }
  return [...bestByFile.values()].sort((left, right) => right.score - left.score);
}

async function benchmark(model, chunks) {
  const loadStarted = performance.now();
  const extractor = await pipeline('feature-extraction', model);
  const loadMs = Math.round(performance.now() - loadStarted);

  const encodingStarted = performance.now();
  const chunkVectors = await encode(extractor, chunks.map(chunk => chunk.text));
  const queryVectors = await encode(extractor, probes.map(probe => probe.query));
  const encodeMs = Math.round(performance.now() - encodingStarted);

  const results = probes.map((probe, probeIndex) => {
    const ranked = rankFiles(queryVectors[probeIndex], chunks, chunkVectors)
      .slice(0, 5)
      .map(({ file, score }) => ({ file, score: Number(score.toFixed(4)) }));
    const rank = ranked.findIndex(result => result.file === probe.required);
    return {
      query: probe.query,
      required: probe.required,
      rank: rank === -1 ? null : rank + 1,
      top5: ranked,
    };
  });

  return {
    model,
    dimensions: chunkVectors[0]?.length ?? 0,
    loadMs,
    encodeMs,
    recallAt5: Number((results.filter(result => result.rank !== null).length / results.length).toFixed(3)),
    meanReciprocalRank: Number((results.reduce((total, result) => total + (result.rank ? 1 / result.rank : 0), 0) / results.length).toFixed(3)),
    results,
  };
}

async function benchmarkReranker(chunks) {
  const retrievalStarted = performance.now();
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const chunkVectors = await encode(extractor, chunks.map(chunk => chunk.text));
  const queryVectors = await encode(extractor, probes.map(probe => probe.query));
  const retrievalMs = Math.round(performance.now() - retrievalStarted);

  const loadStarted = performance.now();
  const tokenizer = await AutoTokenizer.from_pretrained(RERANKER_MODEL);
  const model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL);
  const loadMs = Math.round(performance.now() - loadStarted);

  const rerankStarted = performance.now();
  const results = [];
  for (let probeIndex = 0; probeIndex < probes.length; probeIndex++) {
    const probe = probes[probeIndex];
    const candidates = rankFiles(queryVectors[probeIndex], chunks, chunkVectors)
      .slice(0, RERANK_FILE_COUNT);
    const inputs = tokenizer(
      Array(candidates.length).fill(probe.query),
      {
        text_pair: candidates.map(candidate => candidate.text),
        padding: true,
        truncation: true,
        max_length: 512,
      }
    );
    const output = await model(inputs);
    const reranked = candidates.map((candidate, index) => ({
      file: candidate.file,
      score: output.logits.data[index],
    })).sort((left, right) => right.score - left.score);
    const top5 = reranked.slice(0, 5).map(target => ({
      file: target.file,
      score: Number(target.score.toFixed(4)),
    }));
    const rank = top5.findIndex(result => result.file === probe.required);
    results.push({
      query: probe.query,
      required: probe.required,
      candidateCount: candidates.length,
      requiredInCandidates: candidates.some(candidate => candidate.file === probe.required),
      rank: rank === -1 ? null : rank + 1,
      top5,
    });
  }

  return {
    model: RERANKER_MODEL,
    retrievalModel: 'Xenova/all-MiniLM-L6-v2',
    candidatesPerQuery: RERANK_FILE_COUNT,
    retrievalMs,
    loadMs,
    rerankMs: Math.round(performance.now() - rerankStarted),
    recallAt5: Number((results.filter(result => result.rank !== null).length / results.length).toFixed(3)),
    meanReciprocalRank: Number((results.reduce((total, result) => total + (result.rank ? 1 / result.rank : 0), 0) / results.length).toFixed(3)),
    results,
  };
}

const files = await findSourceFiles(projectPath);
const chunks = (await Promise.all(files.map(async file => {
  const relativePath = path.relative(projectPath, file).replaceAll('\\', '/');
  return splitIntoChunks(file, relativePath, await readFile(file, 'utf8'));
}))).flat();

const output = {
  projectPath,
  sourceFiles: files.length,
  chunks: chunks.length,
  chunkSize: CHUNK_SIZE,
  models: [],
};

if (process.env.RUN_ENCODER_BENCHMARKS !== 'false') {
  for (const model of ['Xenova/all-MiniLM-L6-v2', 'jinaai/jina-embeddings-v2-base-code']) {
    output.models.push(await benchmark(model, chunks));
  }
}
output.reranker = await benchmarkReranker(chunks);

const report = process.env.FULL_BENCHMARK_OUTPUT === 'true'
  ? output
  : {
      ...output,
      models: output.models.map(model => ({
        model: model.model,
        dimensions: model.dimensions,
        loadMs: model.loadMs,
        encodeMs: model.encodeMs,
        recallAt5: model.recallAt5,
        meanReciprocalRank: model.meanReciprocalRank,
        results: model.results.map(result => ({
          required: result.required,
          rank: result.rank,
          top5Files: result.top5.map(target => target.file),
        })),
      })),
      reranker: {
        model: output.reranker.model,
        retrievalModel: output.reranker.retrievalModel,
        candidatesPerQuery: output.reranker.candidatesPerQuery,
        retrievalMs: output.reranker.retrievalMs,
        loadMs: output.reranker.loadMs,
        rerankMs: output.reranker.rerankMs,
        recallAt5: output.reranker.recallAt5,
        meanReciprocalRank: output.reranker.meanReciprocalRank,
        results: output.reranker.results.map(result => ({
          required: result.required,
          requiredInCandidates: result.requiredInCandidates,
          rank: result.rank,
          top5Files: result.top5.map(target => target.file),
        })),
      },
    };

console.log(JSON.stringify(report, null, 2));
