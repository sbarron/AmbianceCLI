import * as fs from 'fs';
import * as path from 'path';
import { LocalEmbeddingStorage } from '../../local/embeddingStorage';
import { embeddingGenerator } from '../../local/embeddingGenerator';
import { getDefaultLocalProvider } from '../../local/localEmbeddingProvider';
import { QwenEmbeddingProvider } from '../../local/qwenEmbeddingProvider';
import { getLocalRetrievalProfile } from '../../local/localRetrievalProfile';
import { retrieveLocalHybrid } from '../../local/localHybridRetrieval';
import { compileExcludePatterns, isExcludedPath } from '../../tools/utils/toolHelpers';
import { ProjectIdentifier } from '../../local/projectIdentifier';

export async function localQualityContext(
  projectPath: string,
  query: string,
  maxTokens: number,
  excludePatterns: string[]
) {
  const profile = getLocalRetrievalProfile()!;
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 50000)
    throw new Error('maxTokens must be an integer from 256 to 50000.');
  const storage = new LocalEmbeddingStorage();
  try {
    const project = await ProjectIdentifier.getInstance().identifyProject(projectPath);
    const vector = await embeddingGenerator.generateQueryEmbedding(query, project.id);
    const excludes = compileExcludePatterns(excludePatterns);
    const result = await retrieveLocalHybrid(
      storage,
      project.id,
      query,
      vector,
      chunk => !isExcludedPath(chunk.filePath.replace(/\\/g, '/'), excludes)
    );
    const root = fs.realpathSync(projectPath);
    const files = new Map<string, string[] | null>();
    const chunks = [];
    for (const { chunk } of result.chunks) {
      const file = chunk.filePath.replace(/\\/g, '/');
      if (!files.has(file)) {
        try {
          const absolute = fs.realpathSync(path.resolve(root, file));
          const relative = path.relative(root, absolute);
          if (relative.startsWith('..') || path.isAbsolute(relative))
            throw new Error('Source is outside the project.');
          files.set(file, fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n').split('\n'));
        } catch {
          files.set(file, null);
        }
      }
      const lines = files.get(file);
      const start = chunk.metadata.startLine!,
        end = chunk.metadata.endLine!;
      if (
        !lines ||
        !Number.isInteger(start) ||
        start < 1 ||
        !Number.isInteger(end) ||
        end < start ||
        end > lines.length ||
        lines.slice(start - 1, end).join('\n') !== chunk.content.replace(/\r\n/g, '\n')
      )
        continue;
      chunks.push({
        file,
        content: chunk.content,
        startLine: start,
        symbol: chunk.metadata.symbols?.[0] || path.basename(file),
      });
    }
    if (!chunks.length)
      throw new Error('No current source evidence is available in the local quality index.');
    const provider = getDefaultLocalProvider() as QwenEmbeddingProvider;
    const envelope = {
      success: true,
      command: 'context',
      exitCode: 0,
      version: 2,
      responseMode: 'compact',
      enhanced: true,
      embeddingsUsed: true,
      metadata: {
        localProfile: profile.name,
        model: profile.model,
        dimensions: 512,
        quantization: 'turbo4',
        retrievalStrategy: 'qwen-contextual-bm25-rrf',
        totalChunks: result.totalChunks,
        currentSourceCandidates: chunks.length,
        staleCandidatesSkipped: result.chunks.length - chunks.length,
        budget: { tokenizer: 'o200k_base', scope: 'whole-json', maxTokens, usedTokens: 0 },
      },
    };
    const packed: any = await provider.request('pack', { query, maxTokens, chunks, envelope });
    if (!packed.jumpTargets.length)
      throw new Error('No source evidence fits this token budget. Increase maxTokens.');
    for (let i = 0; i < 8; i++) {
      const count = await provider.request<number>('count', {
        text: JSON.stringify(packed, null, 2),
      });
      if (count > maxTokens) throw new Error('Local response exceeded its token budget.');
      if (packed.metadata.budget.usedTokens === count) return packed;
      packed.metadata.budget.usedTokens = count;
    }
    throw new Error('Unable to stabilize the local response token receipt.');
  } finally {
    await storage.close();
  }
}
