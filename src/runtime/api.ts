/** Supported, lazy library boundary for adapters. Importing this module does no work. */
import type { HandoffCommandArgs } from './handoff/service';

export const runtimeApiVersion = 1;
export const runtimeCapabilities = {
  localRetrievalProfiles: ['default', 'qwen3'] as const,
  lazyEmbeddingProviders: true,
  configurableQwenIdleTimeout: true,
};
export const runtimeVersion: string = require('@jackjackstudios/ambiance-cli/package.json').version;

/** Release runtime-owned model workers when the host adapter shuts down. */
export async function disposeRuntime(): Promise<void> {
  const { disposeDefaultProvider } = await import('../local/localEmbeddingProvider');
  await disposeDefaultProvider();
}

export type RuntimeOperation =
  | 'context'
  | 'explore'
  | 'hints'
  | 'summary'
  | 'debug'
  | 'grep'
  | 'frontend'
  | 'embeddings'
  | 'manifest'
  | 'doctor'
  | 'handoff'
  | 'ai_context'
  | 'ai_explanation'
  | 'ai_insights'
  | 'ai_debug'
  | 'cloud_search'
  | 'cloud_list'
  | 'cloud_context'
  | 'cloud_unified'
  | 'cloud_graph';

export interface RuntimeRequestOptions {
  signal?: AbortSignal;
}

/** Cancellation stops waiting; handlers already running may finish their work. */
export async function executeRuntime(
  operation: RuntimeOperation,
  input: Record<string, any> = {},
  options: RuntimeRequestOptions = {}
): Promise<any> {
  const { signal } = options;
  if (signal?.aborted) throw cancellationError();
  let onAbort: (() => void) | undefined;
  const work = dispatch(operation, { ...input });
  try {
    if (!signal) return await work;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(cancellationError());
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    return await Promise.race([work, cancelled]);
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

function cancellationError(): Error {
  const error = new Error('Request cancelled. Work already started may still complete.');
  error.name = 'AbortError';
  return error;
}

async function dispatch(operation: RuntimeOperation, args: Record<string, any>): Promise<any> {
  // Resolve against an explicit workspace without mutating cwd or process.env per request.
  const path = await import('path');
  const projectPath = path.resolve(
    args.projectPath || process.env.WORKSPACE_FOLDER || process.cwd()
  );
  args.projectPath = projectPath;
  const embeddingsDisabled =
    args.disableEmbeddings === true ||
    args.useEmbeddings === false ||
    (args.useEmbeddings !== true && process.env.USE_LOCAL_EMBEDDINGS === 'false');
  switch (operation) {
    case 'explore':
      return (await import('./context/explore')).handleExplore(args as any);
    case 'context': {
      const { handleSemanticCompact } = await import('./context/semanticCompact');
      return handleSemanticCompact({
        format: 'index',
        ...args,
        ...(embeddingsDisabled ? { disableEmbeddings: true } : {}),
      });
    }
    case 'hints':
      return (await import('./hints/projectHints')).handleProjectHints({ useAI: false, ...args });
    case 'summary':
      if (typeof args.filePath !== 'string' || !args.filePath.trim())
        throw new Error('filePath is required');
      return (await import('./summary/fileSummary')).handleFileSummary({
        ...args,
        filePath: path.resolve(projectPath, args.filePath),
      });
    case 'debug':
      return (await import('./debug/localDebugContext')).handleLocalDebugContext({
        ...args,
        ...(embeddingsDisabled ? { useEmbeddings: false } : {}),
      });
    case 'grep':
      return (await import('./grep/astGrep')).handleAstGrep(args);
    case 'frontend':
      return (await import('./frontend/frontendInsights')).handleFrontendInsights({
        ...args,
        ...(embeddingsDisabled ? { useEmbeddings: false } : {}),
      });
    case 'embeddings':
      return (await import('./embeddings/manageEmbeddings')).handleManageEmbeddings(args);
    case 'manifest':
      return (await import('./manifest/projectManifest')).handleProjectManifest(args as any);
    case 'doctor':
      return (await import('./doctor')).runDoctor({ detectedProjectPath: projectPath });
    case 'handoff':
      return (await import('./handoff/service')).handleHandoffCommand({
        compact: true,
        ...args,
      } as HandoffCommandArgs);
    case 'ai_context':
      return (await import('../tools/aiTools')).handleAISemanticCompact(args);
    case 'ai_explanation':
      return (await import('../tools/aiTools')).handleAICodeExplanation({
        ...args,
        ...(args.filePath ? { filePath: path.resolve(projectPath, args.filePath) } : {}),
      });
    case 'ai_insights':
      return (await import('../tools/aiTools')).handleAIProjectInsights(args);
    case 'ai_debug':
      return (await import('../tools/debug/aiDebug')).handleAIDebug(args);
    case 'cloud_search':
      return (await import('../tools/cloudTools')).handleSearchGithubRepos(args as any);
    case 'cloud_list':
      return (await import('../tools/cloudTools')).handleListGithubRepos();
    case 'cloud_context':
      return (await import('../tools/cloudTools')).handleGetGithubContextBundle(args as any);
    case 'cloud_unified':
      return (await import('../tools/cloudTools')).handleGetUnifiedContext(args as any);
    case 'cloud_graph':
      return (await import('../tools/cloudTools')).handleGetGraphContext(args as any);
    default:
      throw new Error(`Unknown runtime operation: ${operation}`);
  }
}
