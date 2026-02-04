/**
 * Local embedding provider using Transformers.js for offline embedding generation
 * Provides fallback when OpenAI API key is not available
 */

import { logger } from '../utils/logger';

// Dynamic import for ESM-only transformers package
let transformersModule: any = null;

async function initializeTransformers() {
  if (!transformersModule) {
    try {
      transformersModule = await import('@xenova/transformers');
      logger.debug('✅ @xenova/transformers loaded successfully');
    } catch (error) {
      logger.warn('⚠️ @xenova/transformers not available, local embeddings disabled', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        'Local embeddings not available: @xenova/transformers package could not be loaded'
      );
    }
  }
  return transformersModule;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface LocalEmbeddingConfig {
  model?:
    | 'all-MiniLM-L6-v2'
    | 'multilingual-e5-large'
    | 'all-mpnet-base-v2'
    | 'advanced-neural-dense';
  maxLength?: number;
  normalize?: boolean;
  pooling?: 'mean' | 'cls';
}

export class LocalEmbeddingProvider {
  private pipeline: any | null = null;
  private model: string;
  private dimensions: number;
  private config: Required<LocalEmbeddingConfig>;

  constructor(config: LocalEmbeddingConfig = {}) {
    this.config = {
      model: config.model || this.getDefaultModel(),
      maxLength: config.maxLength || 512,
      normalize: config.normalize ?? true,
      pooling: config.pooling || 'mean',
    };

    this.model = `Xenova/${this.mapModelName(this.config.model)}`;
    this.dimensions = this.getModelDimensions();
  }

  private getModelDimensions(): number {
    switch (this.config.model) {
      case 'all-MiniLM-L6-v2':
        return 384; // Standard expected dimensions
      case 'all-mpnet-base-v2':
      case 'advanced-neural-dense':
        return 768; // Standard expected dimensions
      case 'multilingual-e5-large':
        return 1024; // Actual dimensions returned by Xenova/multilingual-e5-large
      default:
        return 384;
    }
  }

  /**
   * Get the default model based on environment variable or fallback
   */
  private getDefaultModel():
    | 'all-MiniLM-L6-v2'
    | 'multilingual-e5-large'
    | 'all-mpnet-base-v2'
    | 'advanced-neural-dense' {
    const envModel = process.env.LOCAL_EMBEDDING_MODEL;
    if (envModel) {
      // Validate the environment variable value
      switch (envModel.toLowerCase()) {
        case 'all-minilm-l6-v2':
          return 'all-MiniLM-L6-v2';
        case 'multilingual-e5-large':
          return 'multilingual-e5-large';
        case 'all-mpnet-base-v2':
          return 'all-mpnet-base-v2';
        case 'advanced-neural-dense':
          return 'advanced-neural-dense';
        default:
          logger.warn(
            `⚠️ Unknown LOCAL_EMBEDDING_MODEL value: ${envModel}, using all-MiniLM-L6-v2`
          );
          return 'all-MiniLM-L6-v2';
      }
    }
    return 'all-MiniLM-L6-v2'; // Default fallback
  }

  /**
   * Map our model names to Xenova/Transformers model names
   */
  private mapModelName(model: string): string {
    switch (model) {
      case 'advanced-neural-dense':
        return 'all-mpnet-base-v2'; // Advanced Neural Dense Retrieval model
      default:
        return model;
    }
  }

  /**
   * Initialize the embedding pipeline (lazy loading)
   */
  private async initializePipeline(): Promise<void> {
    if (this.pipeline) {
      return;
    }

    try {
      logger.info('🤖 Initializing local embedding model', {
        model: this.model,
        dimensions: this.dimensions,
      });

      // Dynamically import transformers if not already loaded
      const transformers = await initializeTransformers();

      // Load the feature extraction pipeline
      this.pipeline = await transformers.pipeline('feature-extraction', this.model, {
        // Use local cache to avoid re-downloading models
        local_files_only: false,
        revision: 'main',
      });

      logger.info('✅ Local embedding model loaded successfully', {
        model: this.config.model,
      });
    } catch (error) {
      logger.error('❌ Failed to load local embedding model', {
        model: this.config.model,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to initialize local embedding model: ${error}`);
    }
  }

  /**
   * Generate embeddings for text chunks
   */
  async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) {
      return [];
    }

    // Filter out empty or whitespace-only strings
    const validTexts = texts.filter(text => text && text.trim().length > 0);

    if (validTexts.length === 0) {
      logger.warn('⚠️ No valid texts provided for embedding generation');
      return [];
    }

    // Log input validation
    logger.debug('🔍 Input validation for embeddings', {
      originalCount: texts.length,
      validCount: validTexts.length,
      avgLength: Math.round(
        validTexts.reduce((sum, text) => sum + text.length, 0) / validTexts.length
      ),
      sampleText: validTexts[0]?.substring(0, 100) + (validTexts[0]?.length > 100 ? '...' : ''),
    });

    await this.initializePipeline();

    if (!this.pipeline) {
      throw new Error('Failed to initialize embedding pipeline');
    }

    try {
      logger.debug('🔄 Generating embeddings with local model', {
        model: this.config.model,
        textCount: validTexts.length,
        avgLength: Math.round(
          validTexts.reduce((sum, text) => sum + text.length, 0) / validTexts.length
        ),
      });

      // Truncate texts that are too long
      const truncatedTexts = validTexts.map(text =>
        text.length > this.config.maxLength * 4 // Rough char to token ratio
          ? text.substring(0, this.config.maxLength * 4)
          : text
      );

      // Generate embeddings - try batch processing first, fallback to individual
      let embeddings: any;

      // Try batch processing first for better performance
      logger.debug('🔄 Attempting batch processing for better performance', {
        textCount: truncatedTexts.length,
        model: this.config.model,
      });

      try {
        embeddings = await this.pipeline(truncatedTexts, {
          pooling: this.config.pooling,
          normalize: this.config.normalize,
        });

        logger.debug('✅ Batch processing successful', {
          inputCount: truncatedTexts.length,
          outputType: typeof embeddings,
          isArray: Array.isArray(embeddings),
        });
      } catch (batchError) {
        logger.warn('⚠️ Batch processing failed, falling back to individual processing', {
          error: batchError instanceof Error ? batchError.message : String(batchError),
          model: this.config.model,
          textCount: truncatedTexts.length,
        });

        // Fallback to individual processing
        const individualResults = [];
        for (let textIdx = 0; textIdx < truncatedTexts.length; textIdx++) {
          const text = truncatedTexts[textIdx];
          try {
            const singleResult = await this.pipeline(text, {
              pooling: this.config.pooling,
              normalize: this.config.normalize,
            });

            // Validate the single result structure
            if (!singleResult) {
              logger.warn('⚠️ Null result from pipeline for individual text', {
                textIndex: textIdx,
                model: this.config.model,
              });
              continue;
            }

            // Check if result has the expected data property
            if (singleResult && typeof singleResult === 'object' && 'data' in singleResult) {
              // Validate dimensions before accepting
              const embedding = Array.from(singleResult.data as Float32Array);
              if (embedding.length !== this.getModelDimensions()) {
                logger.warn('⚠️ Individual result has unexpected dimensions, rejecting', {
                  expected: this.getModelDimensions(),
                  actual: embedding.length,
                  textIndex: textIdx,
                  model: this.config.model,
                });
                continue;
              }
              individualResults.push(singleResult);
            } else if (
              Array.isArray(singleResult) &&
              singleResult.length > 0 &&
              typeof singleResult[0] === 'object' &&
              'data' in singleResult[0]
            ) {
              // If wrapped in array, unwrap it
              const embedding = Array.from(singleResult[0].data as Float32Array);
              if (embedding.length !== this.getModelDimensions()) {
                logger.warn('⚠️ Individual result has unexpected dimensions, rejecting', {
                  expected: this.getModelDimensions(),
                  actual: embedding.length,
                  textIndex: textIdx,
                  model: this.config.model,
                });
                continue;
              }
              individualResults.push(singleResult[0]);
            } else {
              logger.warn('⚠️ Unexpected single result format', {
                resultType: typeof singleResult,
                isArray: Array.isArray(singleResult),
                hasData: singleResult && typeof singleResult === 'object' && 'data' in singleResult,
                textIndex: textIdx,
                model: this.config.model,
              });
              continue;
            }
          } catch (singleTextError) {
            logger.warn('⚠️ Failed to process individual text', {
              error:
                singleTextError instanceof Error
                  ? singleTextError.message
                  : String(singleTextError),
              textIndex: textIdx,
              model: this.config.model,
            });
            continue;
          }
        }

        if (individualResults.length === 0) {
          throw new Error('No texts could be processed successfully');
        }

        embeddings = individualResults;
        logger.info('📝 Successfully processed texts individually as fallback', {
          processedCount: individualResults.length,
          inputCount: truncatedTexts.length,
        });
      }

      // For individual processing, we need to adjust the validation
      // since we're now processing texts individually, the result should have the right count
      logger.debug('🔍 Pipeline returned:', {
        type: typeof embeddings,
        isArray: Array.isArray(embeddings),
        length: Array.isArray(embeddings) ? embeddings.length : 'N/A',
        constructor: embeddings?.constructor?.name,
        firstItem:
          Array.isArray(embeddings) && embeddings.length > 0
            ? {
                type: typeof embeddings[0],
                keys: embeddings[0] ? Object.keys(embeddings[0]) : 'null/undefined',
                hasData: embeddings[0] && 'data' in embeddings[0],
                dataType: embeddings[0]?.data ? typeof embeddings[0].data : 'N/A',
                dataLength: embeddings[0]?.data ? embeddings[0].data.length : 'N/A',
                // Check if it's a tensor or other complex object
                isTensor: embeddings[0]?.data?.constructor?.name,
              }
            : 'no items',
        truncatedTextsCount: truncatedTexts.length,
        model: this.config.model,
      });

      // Handle different response formats
      let embeddingArray: any[];

      if (!Array.isArray(embeddings)) {
        // If it's not an array, it might be a single result
        if (embeddings && typeof embeddings === 'object' && 'data' in embeddings) {
          logger.debug('📝 Single embedding result detected, wrapping in array');
          embeddingArray = [embeddings];
        } else {
          throw new Error(
            `Pipeline returned invalid embeddings: expected array or object with data, got ${typeof embeddings}`
          );
        }
      } else {
        // embeddings is already an array
        embeddingArray = embeddings;
      }

      // Detect and handle concatenated batch results
      // When transformers.js processes a batch, it sometimes returns a single concatenated tensor
      if (embeddingArray.length === 1 && embeddingArray[0]?.data) {
        const dataLength = embeddingArray[0].data.length;
        const expectedDim = this.getModelDimensions();
        const inputCount = validTexts.length;

        // Check if this looks like a concatenated result
        if (dataLength === expectedDim * inputCount) {
          logger.info('🔧 Detected concatenated batch result, splitting...', {
            totalDimensions: dataLength,
            perItemDimensions: expectedDim,
            expectedCount: inputCount,
            model: this.config.model,
          });

          // Split the concatenated tensor into individual embeddings
          const splitResults = [];
          const fullData = Array.from(embeddingArray[0].data as Float32Array);

          for (let i = 0; i < inputCount; i++) {
            const start = i * expectedDim;
            const end = (i + 1) * expectedDim;
            const embedding = fullData.slice(start, end);

            splitResults.push({
              data: new Float32Array(embedding),
            });
          }

          embeddingArray = splitResults;
          logger.info('✅ Successfully split concatenated result', {
            originalCount: 1,
            splitCount: splitResults.length,
            model: this.config.model,
          });
        } else if (dataLength !== expectedDim) {
          logger.warn(`⚠️ Result 0 has unexpected dimensions`, {
            expected: expectedDim,
            actual: dataLength,
            inputCount,
            possibleConcatenation: dataLength % expectedDim === 0,
            model: this.config.model,
          });
        }
      }

      // Ensure each result has the expected format
      for (let i = 0; i < embeddingArray.length; i++) {
        const result = embeddingArray[i];
        if (result && result.data && result.data.length !== this.getModelDimensions()) {
          logger.warn(`⚠️ Result ${i} has unexpected dimensions`, {
            expected: this.getModelDimensions(),
            actual: result.data.length,
            model: this.config.model,
          });
        }
      }

      // Validate embeddings response
      if (embeddingArray.length === 0) {
        throw new Error('Pipeline returned empty embeddings array');
      }

      if (embeddingArray.length !== validTexts.length) {
        logger.warn('⚠️ Result count mismatch', {
          expected: validTexts.length,
          actual: embeddingArray.length,
          model: this.config.model,
        });

        // If we have more results than expected, truncate
        if (embeddingArray.length > validTexts.length) {
          embeddingArray = embeddingArray.slice(0, validTexts.length);
        }
        // If we have fewer results than expected, this indicates processing errors
        // but continue with what we have rather than failing completely
      }

      // Convert to our standard format
      const results: EmbeddingResult[] = [];

      for (let i = 0; i < embeddingArray.length; i++) {
        if (!embeddingArray[i]) {
          throw new Error(`Invalid embedding result at index ${i}: null/undefined`);
        }

        if (!embeddingArray[i].data) {
          logger.warn('⚠️ Embedding result missing data property, checking for direct array', {
            index: i,
            embeddingType: typeof embeddingArray[i],
            embeddingKeys: Object.keys(embeddingArray[i] || {}),
          });

          // Try to handle different response formats
          if (Array.isArray(embeddingArray[i])) {
            // If it's directly an array, use it as the embedding
            const embedding = Array.from(embeddingArray[i] as number[]);
            if (embedding.length === 0) {
              throw new Error(`Invalid embedding result at index ${i}: empty embedding array`);
            }
            results.push({
              embedding,
              model: this.config.model,
              dimensions: embedding.length,
            });
            continue;
          }

          throw new Error(
            `Invalid embedding result at index ${i}: missing data property and not a direct array`
          );
        }

        const embedding = Array.from(embeddingArray[i].data as Float32Array);
        if (!embedding || embedding.length === 0) {
          throw new Error(`Invalid embedding result at index ${i}: empty embedding`);
        }

        results.push({
          embedding,
          model: this.config.model,
          dimensions: embedding.length,
        });
      }

      logger.debug('✅ Local embeddings generated successfully', {
        model: this.config.model,
        count: results.length,
        dimensions: results[0]?.dimensions,
      });

      return results;
    } catch (error) {
      logger.error('❌ Failed to generate local embeddings', {
        model: this.config.model,
        textCount: texts.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const results = await this.generateEmbeddings([text]);
    if (results.length === 0) {
      throw new Error('Failed to generate embedding');
    }
    return results[0];
  }

  /**
   * Get model information
   */
  getModelInfo() {
    return {
      name: this.config.model, // Return plain model name without Xenova prefix for tests
      provider: 'transformers.js',
      dimensions: this.dimensions,
      maxLength: this.config.maxLength,
      offline: true,
    };
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.pipeline) {
      // Transformers.js handles cleanup automatically
      this.pipeline = null;
      logger.debug('🧹 Local embedding pipeline disposed');
    }
  }
}

// Singleton instance for global use
let defaultProvider: LocalEmbeddingProvider | null = null;

export function getDefaultLocalProvider(config?: LocalEmbeddingConfig): LocalEmbeddingProvider {
  if (!defaultProvider) {
    // If no config provided and we have LOCAL_EMBEDDING_MODEL set, use it
    if (!config && process.env.LOCAL_EMBEDDING_MODEL) {
      const envModel = process.env.LOCAL_EMBEDDING_MODEL.toLowerCase();
      let modelName:
        | 'all-MiniLM-L6-v2'
        | 'multilingual-e5-large'
        | 'all-mpnet-base-v2'
        | 'advanced-neural-dense' = 'all-MiniLM-L6-v2';

      switch (envModel) {
        case 'all-minilm-l6-v2':
          modelName = 'all-MiniLM-L6-v2';
          break;
        case 'multilingual-e5-large':
          modelName = 'multilingual-e5-large';
          break;
        case 'all-mpnet-base-v2':
          modelName = 'all-mpnet-base-v2';
          break;
        case 'advanced-neural-dense':
          modelName = 'advanced-neural-dense';
          break;
        default:
          logger.warn(
            `⚠️ Unknown LOCAL_EMBEDDING_MODEL value: ${process.env.LOCAL_EMBEDDING_MODEL}, using all-MiniLM-L6-v2`
          );
      }

      defaultProvider = new LocalEmbeddingProvider({ model: modelName });
      logger.info('🤖 Local embedding provider initialized from environment variable', {
        model: modelName,
        envVar: process.env.LOCAL_EMBEDDING_MODEL,
      });
    } else {
      defaultProvider = new LocalEmbeddingProvider(config);
    }
  }
  return defaultProvider;
}

export async function disposeDefaultProvider(): Promise<void> {
  if (defaultProvider) {
    await defaultProvider.dispose();
    defaultProvider = null;
  }
}
