export async function getCurrentModelConfiguration(): Promise<{
  provider: string;
  model: string;
  dimensions: number;
  format: 'int8' | 'float32';
}> {
  let localConfig = {
    provider: 'local',
    model: 'transformers.js',
    dimensions: 384,
    format: 'float32' as const,
  };

  try {
    const { getDefaultLocalProvider } = await import('../../local/localEmbeddingProvider');
    const localProvider = getDefaultLocalProvider();
    const localModelInfo = localProvider.getModelInfo();

    localConfig = {
      provider: 'local',
      model: localModelInfo.name,
      dimensions: localModelInfo.dimensions,
      format: 'float32',
    };
  } catch {
    // Fallback stays as default local configuration
  }

  if (process.env.OPENAI_API_KEY && process.env.USE_OPENAI_EMBEDDINGS === 'true') {
    const currentModel = process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-large';
    const modelDimensions =
      currentModel === 'text-embedding-3-large'
        ? 3072
        : currentModel === 'text-embedding-3-small'
          ? 1536
          : currentModel === 'text-embedding-ada-002'
            ? 1536
            : 3072;

    return {
      provider: 'openai',
      model: currentModel,
      dimensions: modelDimensions,
      format: 'float32',
    };
  }

  return localConfig;
}
