/**
 * @fileOverview: OpenAI service with provider-specific configurations and compatibility handling
 * @module: OpenAIService
 * @keyFunctions:
 *   - createChatCompletion(): Unified interface for chat completions across providers
 *   - getProviderConfig(): Get provider-specific configuration
 *   - normalizeParameters(): Normalize parameters for each provider
 * @dependencies:
 *   - openai: Official OpenAI SDK
 *   - logger: Logging utilities
 * @context: Handles differences between OpenAI-compatible providers (Qwen, Azure, etc.) with specific parameter requirements
 */

import OpenAI from 'openai';
import type { Response as ResponsesResponse } from 'openai/resources/responses/responses';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { logger } from '../utils/logger';
import { validateDynamicSignal, Message, ValidationError } from './validation';

// Provider types
export type ProviderType =
  | 'openai'
  | 'qwen'
  | 'azure'
  | 'anthropic'
  | 'together'
  | 'openrouter'
  | 'grok'
  | 'groq'
  | 'custom';

// Provider-specific configurations
interface ProviderConfig {
  name: string;
  requiresTemperatureOne?: boolean;
  maxTokensParam?: string; // 'max_tokens' for most, could be 'maxTokens' for some
  supportsStreaming?: boolean;
  defaultModel: string;
  defaultMiniModel: string;
  defaultEmbeddingsModel?: string;
  baseUrl?: string;
}

// Provider-specific API key environment variable priority
export const PROVIDER_API_KEY_ENV: Record<ProviderType, string[]> = {
  openai: ['OPENAI_API_KEY'],
  qwen: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'OPENAI_API_KEY'],
  azure: ['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
  together: ['TOGETHER_API_KEY', 'OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'],
  grok: ['XAI_API_KEY', 'GROK_API_KEY', 'OPENAI_API_KEY'],
  groq: ['GROQ_API_KEY', 'OPENAI_API_KEY'],
  custom: ['OPENAI_API_KEY'],
};

export function resolveProviderApiKey(provider: ProviderType): string | undefined {
  const envKeys = PROVIDER_API_KEY_ENV[provider] || PROVIDER_API_KEY_ENV.openai;
  for (const key of envKeys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

// Model configurations
interface ModelConfig {
  maxTokensLimit: number;
  supportsFunctions?: boolean;
  supportsTools?: boolean;
  disallowMaxTokens?: boolean;
  enforceTemperature?: number;
}

// Service configuration
interface OpenAIServiceConfig {
  apiKey: string;
  provider: ProviderType;
  model?: string;
  miniModel?: string;
  embeddingsModel?: string;
  baseUrl?: string;
  organization?: string;
}

export class OpenAIService {
  private client: OpenAI;
  private config: OpenAIServiceConfig;
  private providerConfig: ProviderConfig;
  private modelConfig: ModelConfig;

  constructor(config: OpenAIServiceConfig) {
    this.config = config;

    // Get provider-specific configuration
    this.providerConfig = this.getProviderConfig(config.provider);

    // Set base URL if provided, or use OPENAI_BASE_URL env var, or use provider default, or use OpenAI default
    const baseUrl =
      config.baseUrl ||
      process.env.OPENAI_BASE_URL ||
      this.providerConfig.baseUrl ||
      'https://api.openai.com/v1';

    // Resolve provider by base URL if using a custom endpoint
    const resolvedProvider = this.resolveProvider(config.provider, baseUrl);
    if (resolvedProvider !== config.provider) {
      this.providerConfig = this.getProviderConfig(resolvedProvider);
    }

    // Initialize OpenAI client
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: baseUrl,
      organization: config.organization,
      dangerouslyAllowBrowser: true, // For browser environments if needed
    });

    // Get model configuration
    const modelName = config.model || this.providerConfig.defaultModel;
    this.modelConfig = this.getModelConfig(modelName);

    logger.info('OpenAI Service initialized', {
      provider: this.providerConfig.name,
      model: modelName,
      miniModel: config.miniModel || this.providerConfig.defaultMiniModel,
      embeddingsModel: this.getEmbeddingsModel(),
      baseUrl,
    });
  }

  /**
   * Perform a minimal live connectivity probe to verify the API key and endpoint work.
   * Tries to list models; falls back to a tiny completion if listing isn't available.
   * Returns true on success within timeout, false on error/timeout.
   */
  async quickProbe(timeoutMs: number = 3000): Promise<boolean> {
    const timeout = new Promise<never>((_, reject) => {
      const id = setTimeout(
        () => {
          clearTimeout(id);
          reject(new Error('probe-timeout'));
        },
        Math.max(500, timeoutMs)
      );
    });

    const tryList = async () => {
      try {
        // Some OpenAI-compatible providers may not support listing models
        // If it throws 404/401, treat as failure and try completion fallback
        const res = await this.client.models.list();
        return !!res && Array.isArray((res as any).data);
      } catch {
        return false;
      }
    };

    const tryTinyCompletion = async () => {
      const probeModel = this.getModelForTask('mini');
      try {
        if (this.isReasoningModel(probeModel)) {
          await this.client.responses.create({
            model: probeModel,
            input: [
              {
                role: 'user',
                content: [{ type: 'input_text', text: 'ping' }],
              },
            ],
            reasoning: { effort: 'low' },
            max_output_tokens: 1,
          });
        } else {
          await this.client.chat.completions.create({
            model: probeModel,
            messages: [{ role: 'system', content: 'ping' }],
            max_tokens: 1,
            temperature: 1,
          } as any);
        }
        return true;
      } catch {
        return false;
      }
    };

    try {
      const ok = await Promise.race([
        (async () => (await tryList()) || (await tryTinyCompletion()))(),
        timeout,
      ] as [Promise<boolean>, Promise<never>]);
      return !!ok;
    } catch {
      return false;
    }
  }

  /**
   * Get provider-specific configuration
   */
  private getProviderConfig(provider: ProviderType): ProviderConfig {
    const configs: Record<ProviderType, ProviderConfig> = {
      openai: {
        name: 'OpenAI',
        supportsStreaming: true,
        defaultModel: process.env.OPENAI_BASE_MODEL || 'gpt-5',
        defaultMiniModel: process.env.OPENAI_MINI_MODEL || 'gpt-5-mini',
        defaultEmbeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-large',
        maxTokensParam: 'max_tokens',
        baseUrl: 'https://api.openai.com/v1',
      },
      qwen: {
        name: 'Qwen',
        requiresTemperatureOne: true,
        maxTokensParam: 'max_tokens',
        supportsStreaming: true,
        defaultModel: process.env.OPENAI_BASE_MODEL || 'qwen-plus',
        defaultMiniModel: process.env.OPENAI_MINI_MODEL || 'qwen-turbo',
        defaultEmbeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL, // override via env when using Qwen-compatible embeddings
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
      azure: {
        name: 'Azure OpenAI',
        supportsStreaming: true,
        defaultModel: process.env.OPENAI_BASE_MODEL || 'gpt-5',
        defaultMiniModel: process.env.OPENAI_MINI_MODEL || 'gpt-5-mini',
        defaultEmbeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-large',
        baseUrl: process.env.AZURE_OPENAI_ENDPOINT,
      },
      anthropic: {
        name: 'Anthropic',
        supportsStreaming: true,
        defaultModel: process.env.OPENAI_BASE_MODEL || 'claude-4-sonnet-latest',
        defaultMiniModel: process.env.OPENAI_MINI_MODEL || 'claude-4-haiku-20240307',
        defaultEmbeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL, // Anthropic does not provide embeddings; rely on env if proxying
        baseUrl: 'https://api.anthropic.com/v1',
      },
      together: {
        name: 'Together AI',
        supportsStreaming: true,
        defaultModel: process.env.OPENAI_BASE_MODEL || 'mistralai/Mixtral-8x7B-Instruct-v0.1',
        defaultMiniModel: process.env.OPENAI_MINI_MODEL || 'mistralai/Mistral-7B-Instruct-v0.2',
        defaultEmbeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL, // set for Together if applicable
        baseUrl: 'https://api.together.xyz/v1',
      },
      openrouter: {
        name: 'OpenRouter',
        supportsStreaming: true,
        defaultModel: process.env.OPENAI_BASE_MODEL || 'openrouter/auto',
        defaultMiniModel: process.env.OPENAI_MINI_MODEL || 'openrouter/auto-mini',
        defaultEmbeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL,
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      grok: {
        name: 'xAI Grok',
        supportsStreaming: true,
        defaultModel: process.env.OPENAI_BASE_MODEL || 'grok-2-latest',
        defaultMiniModel: process.env.OPENAI_MINI_MODEL || 'grok-2-mini',
        defaultEmbeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL,
        baseUrl: 'https://api.x.ai/v1',
      },
      groq: {
        name: 'Groq',
        supportsStreaming: true,
        defaultModel: process.env.OPENAI_BASE_MODEL || 'llama-3.1-70b-versatile',
        defaultMiniModel: process.env.OPENAI_MINI_MODEL || 'llama-3.1-8b-instant',
        defaultEmbeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL,
        baseUrl: 'https://api.groq.com/openai/v1',
      },
      custom: {
        name: 'Custom Provider',
        supportsStreaming: true,
        defaultModel: process.env.OPENAI_BASE_MODEL || 'gpt-5',
        defaultMiniModel: process.env.OPENAI_MINI_MODEL || 'gpt-5-mini',
        defaultEmbeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-large',
      },
    };

    return configs[provider];
  }

  /**
   * Resolve provider by base URL for common OpenAI-compatible services
   */
  private resolveProvider(provider: ProviderType, baseUrl?: string): ProviderType {
    if (!baseUrl) return provider;
    try {
      const host = new URL(baseUrl).host.toLowerCase();

      const shouldResolve = provider === 'custom' || provider === 'openai';

      if (!shouldResolve) {
        return provider;
      }

      if (host.includes('openrouter.ai')) return 'openrouter';
      if (host.includes('api.x.ai') || host.endsWith('.x.ai')) return 'grok';
      if (host.includes('groq.com')) return 'groq';
      if (host.includes('together.xyz')) return 'together';
      if (host.includes('aliyuncs.com') || host.includes('qwen')) return 'qwen';
      if (host.includes('anthropic.com')) return 'anthropic';
      if (host.includes('azure')) return 'azure';
      if (host.includes('openai.com')) return 'openai';
      return provider;
    } catch {
      return provider;
    }
  }

  /**
   * Get model-specific configuration
   */
  private getModelConfig(model: string): ModelConfig {
    // This would typically be more comprehensive
    const modelConfigs: Record<string, ModelConfig> = {
      'gpt-5': {
        maxTokensLimit: 16384,
        supportsFunctions: true,
        supportsTools: true,
        disallowMaxTokens: true,
        enforceTemperature: 1,
      },
      'gpt-5-mini': {
        maxTokensLimit: 16384,
        supportsFunctions: true,
        supportsTools: true,
        disallowMaxTokens: true,
        enforceTemperature: 1,
      },
      'gpt-5-nano': {
        maxTokensLimit: 16384,
        supportsFunctions: true,
        supportsTools: true,
        disallowMaxTokens: true,
        enforceTemperature: 1,
      },
      'gpt-4.1': {
        maxTokensLimit: 128000,
        supportsFunctions: true,
        supportsTools: true,
      },
      'gpt-4.1-mini': {
        maxTokensLimit: 128000,
        supportsFunctions: true,
        supportsTools: true,
      },
      'gpt-4': { maxTokensLimit: 8192, supportsFunctions: true, supportsTools: true },
      'gpt-4o': { maxTokensLimit: 16384, supportsFunctions: true, supportsTools: true },
      'gpt-4o-mini': { maxTokensLimit: 16384, supportsFunctions: true, supportsTools: true },
      'gpt-3.5-turbo': { maxTokensLimit: 4096, supportsFunctions: true, supportsTools: true },
      'qwen-plus': { maxTokensLimit: 32768, supportsFunctions: true, supportsTools: true },
      'qwen-turbo': { maxTokensLimit: 16384, supportsFunctions: true, supportsTools: true },
      'qwen-max': { maxTokensLimit: 32768, supportsFunctions: true, supportsTools: true },
      'claude-3-5-sonnet-latest': {
        maxTokensLimit: 200000,
        supportsFunctions: false,
        supportsTools: true,
      },
      'claude-3-haiku-20240307': {
        maxTokensLimit: 200000,
        supportsFunctions: false,
        supportsTools: true,
      },
      'mistralai/Mixtral-8x7B-Instruct-v0.1': {
        maxTokensLimit: 32768,
        supportsFunctions: true,
        supportsTools: true,
      },
      'mistralai/Mistral-7B-Instruct-v0.2': {
        maxTokensLimit: 32768,
        supportsFunctions: true,
        supportsTools: true,
      },
      'openrouter/auto': {
        maxTokensLimit: 128000,
        supportsFunctions: true,
        supportsTools: true,
      },
      'openrouter/auto-mini': {
        maxTokensLimit: 64000,
        supportsFunctions: true,
        supportsTools: true,
      },
      'grok-2-latest': {
        maxTokensLimit: 32768,
        supportsFunctions: true,
        supportsTools: true,
      },
      'grok-2-mini': {
        maxTokensLimit: 16384,
        supportsFunctions: true,
        supportsTools: true,
      },
      'llama-3.1-70b-versatile': {
        maxTokensLimit: 8192,
        supportsFunctions: true,
        supportsTools: true,
      },
      'llama-3.1-8b-instant': {
        maxTokensLimit: 8192,
        supportsFunctions: true,
        supportsTools: true,
      },
    };

    // Return specific config or default
    return (
      modelConfigs[model] || { maxTokensLimit: 4096, supportsFunctions: true, supportsTools: true }
    );
  }

  /**
   * Detect whether a model should use the Responses API (reasoning models like GPT-5)
   */
  private isReasoningModel(model?: string): boolean {
    if (!model) return false;
    const normalized = model.toLowerCase();
    return normalized.startsWith('gpt-5');
  }

  /**
   * Normalize chat message content into Responses API content blocks
   */
  private normalizeResponseContent(
    content: ChatCompletionMessageParam['content']
  ): Array<Record<string, any>> {
    if (content === null || content === undefined) {
      return [{ type: 'input_text', text: '' }];
    }

    if (typeof content === 'string') {
      return [{ type: 'input_text', text: content }];
    }

    if (Array.isArray(content)) {
      const parts = content
        .map(part => {
          if (typeof part === 'string') {
            return { type: 'input_text', text: part };
          }

          if (part && typeof part === 'object') {
            if ('type' in part) {
              if ((part as any).type === 'input_text' && 'text' in part) {
                return { type: 'input_text', text: (part as any).text ?? '' };
              }
              if ((part as any).type === 'text' && 'text' in part) {
                return { type: 'input_text', text: (part as any).text ?? '' };
              }
              if (
                ['input_text', 'input_image', 'input_file'].includes((part as any).type as string)
              ) {
                return { ...part };
              }
              return { type: 'input_text', text: JSON.stringify(part) };
            }

            if ('text' in part) {
              return { type: 'input_text', text: (part as any).text ?? '' };
            }

            return { type: 'input_text', text: JSON.stringify(part) };
          }

          return null;
        })
        .filter(Boolean) as Array<Record<string, any>>;

      return parts.length ? parts : [{ type: 'input_text', text: '' }];
    }

    if (content && typeof content === 'object') {
      const block = content as Record<string, any>;
      if ('type' in block) {
        if (block.type === 'input_text') {
          return [{ type: 'input_text', text: block.text ?? '' }];
        }
        if (block.type === 'text') {
          return [{ type: 'input_text', text: block.text ?? '' }];
        }
        if (['input_text', 'input_image', 'input_file'].includes(block.type)) {
          return [{ ...block }];
        }
        return [{ type: 'input_text', text: JSON.stringify(block) }];
      }

      if ('text' in block) {
        return [{ type: 'input_text', text: block.text ?? '' }];
      }

      return [{ type: 'input_text', text: JSON.stringify(block) }];
    }

    return [{ type: 'input_text', text: String(content) }];
  }

  /**
   * Convert Chat Completions message array into Responses API input format
   */
  private transformMessagesToResponseInput(
    messages: ChatCompletionMessageParam[]
  ): Array<Record<string, any>> {
    return messages.map(message => {
      const converted: Record<string, any> = {
        role: (message as any).role,
        content: this.normalizeResponseContent(message.content ?? ''),
      };

      if ((message as any).name) {
        converted.name = (message as any).name;
      }

      if ((message as any).tool_call_id) {
        converted.tool_call_id = (message as any).tool_call_id;
      }

      if ((message as any).metadata) {
        converted.metadata = (message as any).metadata;
      }

      if (!converted.content || converted.content.length === 0) {
        converted.content = [{ type: 'input_text', text: '' }];
      }

      return converted;
    });
  }

  /**
   * Derive a reasoning effort value, preferring explicit settings and falling back to temperature
   */
  private resolveReasoningEffort(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  ): 'low' | 'medium' | 'high' {
    const explicit = (params as any).reasoning;
    if (explicit && typeof explicit === 'object' && typeof explicit.effort === 'string') {
      return explicit.effort as 'low' | 'medium' | 'high';
    }

    const temperature = typeof params.temperature === 'number' ? params.temperature : null;
    if (temperature !== null) {
      if (temperature <= 0.2) return 'low';
      if (temperature >= 0.8) return 'high';
    }

    return 'medium';
  }

  /**
   * Extract and cap max_output_tokens for reasoning models
   */
  private extractMaxOutputTokens(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    modelConfig: ModelConfig
  ): number | undefined {
    const candidateValues = [
      (params as any).max_output_tokens,
      (params as any).max_completion_tokens,
      params.max_tokens,
    ];

    const firstDefined = candidateValues.find(
      value => typeof value === 'number' && Number.isFinite(value)
    ) as number | undefined;

    if (firstDefined === undefined) {
      return undefined;
    }

    const capped = Math.min(firstDefined, modelConfig.maxTokensLimit);
    if (capped !== firstDefined) {
      logger.warn(
        `max_output_tokens (${firstDefined}) exceeds model limit (${modelConfig.maxTokensLimit}), capping value`
      );
    }

    return capped;
  }

  /**
   * Convert a Responses API result into a Chat Completions-compatible payload
   */
  private adaptResponseToChatCompletion(
    response: ResponsesResponse
  ): OpenAI.Chat.Completions.ChatCompletion {
    const textSegments: string[] = [];

    const outputItems = Array.isArray((response as any).output)
      ? ((response as any).output as Array<Record<string, any>>)
      : [];

    for (const item of outputItems) {
      if (!item || typeof item !== 'object') continue;
      if (item.type !== 'message') continue;

      const contentBlocks = Array.isArray(item.content) ? item.content : [];
      for (const block of contentBlocks) {
        if (block && typeof block === 'object' && 'text' in block) {
          const textValue = (block as any).text;
          if (typeof textValue === 'string') {
            textSegments.push(textValue);
          }
        } else if (typeof block === 'string') {
          textSegments.push(block);
        }
      }
    }

    const aggregatedText =
      typeof (response as any).output_text === 'string'
        ? (response as any).output_text
        : textSegments.join('');

    const responseStatus = (response as any).status;
    const incompleteReason = (response as any).incomplete_details?.reason;

    const originalFinishReason =
      outputItems.find(item => item?.stop_reason)?.stop_reason ||
      outputItems.find(item => item?.finish_reason)?.finish_reason ||
      null;

    let finishReason = originalFinishReason || 'stop';
    let truncated = false;

    if (incompleteReason === 'max_output_tokens') {
      truncated = true;
      finishReason = 'length';
    } else if (incompleteReason === 'content_filter') {
      finishReason = 'content_filter';
    } else if (finishReason === 'max_output_tokens') {
      truncated = true;
      finishReason = 'length';
    } else if (finishReason === 'length') {
      truncated = true;
    }

    if (responseStatus === 'incomplete' && !truncated && finishReason === 'stop') {
      truncated = true;
      finishReason = 'length';
    }

    if (truncated) {
      logger.warn('Reasoning response truncated', {
        model: response.model,
        status: responseStatus,
        incompleteReason,
        originalFinishReason,
      });
    } else if (incompleteReason === 'content_filter') {
      logger.warn('Reasoning response blocked by content filter', {
        model: response.model,
        status: responseStatus,
      });
    }

    const promptTokens =
      (response as any).usage?.prompt_tokens ?? (response as any).usage?.input_tokens ?? 0;
    const completionTokens =
      (response as any).usage?.completion_tokens ?? (response as any).usage?.output_tokens ?? 0;
    const totalTokens =
      (response as any).usage?.total_tokens ?? (promptTokens || 0) + (completionTokens || 0);

    const completion: OpenAI.Chat.Completions.ChatCompletion = {
      id: response.id,
      object: 'chat.completion',
      created: (response as any).created ?? Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          finish_reason: finishReason || 'stop',
          logprobs: null,
          message: {
            role: 'assistant',
            content: aggregatedText,
            refusal: null,
          },
        },
      ],
      usage: (response as any).usage
        ? {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
          }
        : undefined,
    };

    (completion as any).response_metadata = {
      status: responseStatus ?? 'completed',
      incomplete_reason: incompleteReason ?? null,
      original_finish_reason: originalFinishReason,
      truncated,
      cache_status:
        ((response as any).metadata &&
          typeof (response as any).metadata === 'object' &&
          'response_cache' in (response as any).metadata &&
          (response as any).metadata?.response_cache) ||
        (response as any).response_cache ||
        null,
    };

    const providerMetadata = (response as any).metadata;
    if (providerMetadata && typeof providerMetadata === 'object') {
      (completion as any).response_metadata.provider_metadata = providerMetadata;
    }

    return completion;
  }

  /**
   * Handle GPT-5 style reasoning models via the Responses API while returning a chat-like payload
   */
  private async createReasoningCompletion(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const targetModel = params.model || this.getModelForTask('base');
    const runtimeModelConfig = this.getModelConfig(targetModel);

    let maxOutputTokens = this.extractMaxOutputTokens(params, runtimeModelConfig);
    const initialMaxOutputTokens = maxOutputTokens;

    if (typeof params.temperature === 'number') {
      logger.info('Reasoning models ignore temperature; using reasoning.effort instead', {
        model: targetModel,
        providedTemperature: params.temperature,
      });
    }

    const initialReasoningEffort = this.resolveReasoningEffort(params);
    let reasoningEffort: 'low' | 'medium' | 'high' = initialReasoningEffort;

    const baseMessages = this.transformMessagesToResponseInput(
      (params.messages as ChatCompletionMessageParam[]) || []
    );
    const baseMessagesJson = JSON.stringify(baseMessages);

    const baseToolsJson = (params as any).tools ? JSON.stringify((params as any).tools) : null;
    const baseToolChoiceJson = (params as any).tool_choice
      ? JSON.stringify((params as any).tool_choice)
      : null;

    const baseReasoning =
      (params as any).reasoning && typeof (params as any).reasoning === 'object'
        ? { ...(params as any).reasoning }
        : {};

    const passthroughKeys: Array<keyof typeof params> = ['metadata', 'response_format', 'user'];
    const passthroughJson: Record<string, string> = {};
    for (const key of passthroughKeys) {
      const value = (params as any)[key];
      if (value !== undefined) {
        passthroughJson[key] = JSON.stringify(value);
      }
    }

    const buildRequest = (): Record<string, any> => {
      const request: Record<string, any> = {
        model: targetModel,
        input: JSON.parse(baseMessagesJson),
        reasoning: {
          ...baseReasoning,
          effort: reasoningEffort,
        },
      };

      if (maxOutputTokens !== undefined) {
        request.max_output_tokens = maxOutputTokens;
      }

      for (const key of passthroughKeys) {
        if (passthroughJson[key]) {
          request[key] = JSON.parse(passthroughJson[key]);
        }
      }

      if (baseToolsJson) {
        request.tools = JSON.parse(baseToolsJson);
      }

      if (baseToolChoiceJson) {
        request.tool_choice = JSON.parse(baseToolChoiceJson);
      }

      return request;
    };

    const maxAttempts = 3;
    let attempt = 0;
    let response: ResponsesResponse | null = null;
    let lastStatus: string | undefined;
    let lastIncompleteReason: string | undefined;
    let lastRequestMaxOutputTokens: number | undefined;
    let lastRequestReasoningEffort: 'low' | 'medium' | 'high' = reasoningEffort;
    const adjustments = {
      increasedMaxOutputTokens: false,
      loweredReasoningEffort: false,
    };

    const fallbackBaseMax = Math.min(4096, runtimeModelConfig.maxTokensLimit);

    try {
      while (attempt < maxAttempts) {
        attempt += 1;
        const request = buildRequest();
        lastRequestMaxOutputTokens = request.max_output_tokens;
        lastRequestReasoningEffort = request.reasoning?.effort as 'low' | 'medium' | 'high';

        logger.info('Creating reasoning response via Responses API', {
          model: targetModel,
          attempt,
          maxOutputTokens: request.max_output_tokens,
          reasoningEffort: request.reasoning?.effort,
        });

        response = await this.client.responses.create(request);

        lastStatus = (response as any).status;
        lastIncompleteReason = (response as any).incomplete_details?.reason;

        const truncatedByTokens =
          lastStatus === 'incomplete' && lastIncompleteReason === 'max_output_tokens';

        if (truncatedByTokens) {
          logger.warn('Reasoning response truncated by max_output_tokens', {
            model: targetModel,
            attempt,
            requestedMaxOutputTokens: request.max_output_tokens,
            reasoningEffort: request.reasoning?.effort,
          });

          if (!adjustments.increasedMaxOutputTokens) {
            const current = maxOutputTokens ?? 0;
            const candidateBase = current === 0 ? fallbackBaseMax : current;
            const boosted = Math.min(
              runtimeModelConfig.maxTokensLimit,
              Math.max(candidateBase + 512, Math.ceil(candidateBase * 1.5))
            );

            if (boosted > candidateBase) {
              maxOutputTokens = boosted;
              adjustments.increasedMaxOutputTokens = true;
              logger.info('Retrying reasoning response with increased max_output_tokens', {
                model: targetModel,
                newMaxOutputTokens: maxOutputTokens,
              });
              continue;
            }
          }

          if (!adjustments.loweredReasoningEffort && reasoningEffort !== 'low') {
            const nextEffort = reasoningEffort === 'high' ? 'medium' : 'low';
            reasoningEffort = nextEffort;
            adjustments.loweredReasoningEffort = true;
            logger.info('Retrying reasoning response with reduced reasoning effort', {
              model: targetModel,
              reasoningEffort,
            });
            continue;
          }
        }

        // Either successful or cannot adjust further
        break;
      }

      if (!response) {
        throw new Error('Failed to obtain response from reasoning model');
      }

      logger.info('Reasoning response received', {
        model: targetModel,
        status: (response as any).status,
        usage: (response as any).usage,
        attempts: attempt,
      });

      const completion = this.adaptResponseToChatCompletion(response);
      const metadata = ((completion as any).response_metadata ?? {}) as Record<string, any>;

      metadata.attempts = attempt;
      metadata.initial_max_output_tokens = initialMaxOutputTokens ?? null;
      metadata.used_max_output_tokens = lastRequestMaxOutputTokens ?? null;
      metadata.initial_reasoning_effort = initialReasoningEffort;
      metadata.reasoning_effort = lastRequestReasoningEffort;
      metadata.adjustments = {
        increased_max_output_tokens: adjustments.increasedMaxOutputTokens,
        lowered_reasoning_effort: adjustments.loweredReasoningEffort,
      };

      if (metadata.cache_status) {
        logger.info('Reasoning response cache metadata', {
          model: targetModel,
          cache: metadata.cache_status,
        });
      }

      const truncatedResult =
        metadata.truncated === true && lastIncompleteReason === 'max_output_tokens';

      if (truncatedResult) {
        metadata.need_more_budget = true;
        metadata.partial_response = completion.choices?.[0]?.message?.content ?? '';

        if (
          lastRequestMaxOutputTokens &&
          lastRequestMaxOutputTokens < runtimeModelConfig.maxTokensLimit
        ) {
          const suggested = Math.min(
            runtimeModelConfig.maxTokensLimit,
            Math.max(lastRequestMaxOutputTokens + 512, Math.ceil(lastRequestMaxOutputTokens * 1.5))
          );
          metadata.suggested_max_output_tokens = suggested;
        }

        if (lastRequestReasoningEffort !== 'low') {
          metadata.suggested_reasoning_effort =
            lastRequestReasoningEffort === 'high' ? 'medium' : 'low';
        }

        logger.warn('Reasoning response requires additional token budget', {
          model: targetModel,
          status: lastStatus,
          incompleteReason: lastIncompleteReason,
          attempts: attempt,
        });
      }

      (completion as any).response_metadata = metadata;

      return completion;
    } catch (error) {
      logger.error('Reasoning response failed', {
        model: targetModel,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Normalize parameters for the specific provider
   */
  private normalizeParameters(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  ): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
    const normalizedParams = { ...params };

    // Handle temperature requirement for Qwen
    if (this.providerConfig.requiresTemperatureOne && normalizedParams.temperature !== 1) {
      logger.warn(
        `Provider ${this.providerConfig.name} requires temperature=1, overriding provided value`,
        {
          originalTemperature: normalizedParams.temperature,
          forcedTemperature: 1,
        }
      );
      normalizedParams.temperature = 1;
    }

    // Map max_completion_tokens (modern) to max_tokens for legacy chat completions
    if (
      (normalizedParams as any).max_completion_tokens !== undefined &&
      (normalizedParams as any).max_tokens === undefined
    ) {
      (normalizedParams as any).max_tokens = (normalizedParams as any).max_completion_tokens;
      delete (normalizedParams as any).max_completion_tokens;
    }

    // Handle provider-specific max tokens parameter name (future-proofing)
    if (this.providerConfig.maxTokensParam && this.providerConfig.maxTokensParam !== 'max_tokens') {
      // Most providers we target accept 'max_tokens'; adapter left as-is for compatibility.
    }

    // Model-specific enforced temperature
    if (
      this.modelConfig.enforceTemperature !== undefined &&
      normalizedParams.temperature !== this.modelConfig.enforceTemperature
    ) {
      logger.warn(
        `Model ${normalizedParams.model} enforces temperature=${this.modelConfig.enforceTemperature}, overriding provided value`,
        {
          originalTemperature: normalizedParams.temperature,
          forcedTemperature: this.modelConfig.enforceTemperature,
        }
      );
      normalizedParams.temperature = this.modelConfig.enforceTemperature;
    }

    // Model-specific disallow max_tokens
    if (this.modelConfig.disallowMaxTokens && 'max_tokens' in normalizedParams) {
      logger.warn(`Model ${normalizedParams.model} does not allow max_tokens, removing parameter`);
      delete (normalizedParams as any).max_tokens;
    }

    // Ensure max_tokens doesn't exceed model limit
    if (
      normalizedParams.max_tokens &&
      normalizedParams.max_tokens > this.modelConfig.maxTokensLimit
    ) {
      logger.warn(
        `max_tokens (${normalizedParams.max_tokens}) exceeds model limit (${this.modelConfig.maxTokensLimit}), capping value`
      );
      normalizedParams.max_tokens = this.modelConfig.maxTokensLimit;
    }

    // Handle streaming support
    if (normalizedParams.stream && !this.providerConfig.supportsStreaming) {
      logger.warn(
        `Provider ${this.providerConfig.name} doesn't support streaming, disabling stream mode`
      );
      normalizedParams.stream = false;
    }

    return normalizedParams;
  }

  /**
   * Create a chat completion with provider-specific handling
   */
  async createChatCompletion(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const targetModel = params.model || this.getModelForTask('base');
    const paramsWithModel = {
      ...params,
      model: targetModel,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
    const wantsReasoningModel = this.isReasoningModel(targetModel);

    try {
      // Validate context before making API call
      try {
        validateDynamicSignal(paramsWithModel.messages as Message[]);
        logger.debug('✅ Context validation passed', {
          messageCount: paramsWithModel.messages.length,
          provider: this.providerConfig.name,
        });
      } catch (validationError) {
        if (validationError instanceof ValidationError) {
          logger.warn('🚫 Context validation failed, blocking API call', {
            error: validationError.message,
            code: validationError.structured.code,
            context: validationError.structured.context,
            suggestion: validationError.structured.suggestion,
          });

          throw new Error(
            `INSUFFICIENT_CONTEXT: ${validationError.message}. ${validationError.structured.suggestion || ''}`
          );
        }
        throw validationError;
      }

      if (wantsReasoningModel) {
        logger.info('Routing reasoning-capable model through Responses API', {
          provider: this.providerConfig.name,
          model: targetModel,
        });
        return await this.createReasoningCompletion(paramsWithModel);
      }

      // Normalize parameters for the provider
      const normalizedParams = this.normalizeParameters(paramsWithModel);

      logger.info('Creating chat completion', {
        provider: this.providerConfig.name,
        model: normalizedParams.model,
        messagesCount: normalizedParams.messages.length,
        maxTokens: normalizedParams.max_tokens,
        temperature: normalizedParams.temperature,
      });

      // Make the API call
      const response = await this.client.chat.completions.create(normalizedParams);

      logger.info('Chat completion successful', {
        provider: this.providerConfig.name,
        model: normalizedParams.model,
        usage: 'usage' in response ? response.usage : undefined,
      });

      const truncatedChoices = response.choices.filter(choice => choice.finish_reason === 'length');

      if (truncatedChoices.length > 0) {
        const usedMaxTokens = (normalizedParams as any).max_tokens ?? null;
        const modelConfig = this.getModelConfig(normalizedParams.model);
        const suggestedMaxTokens =
          usedMaxTokens && modelConfig?.maxTokensLimit
            ? Math.min(
                modelConfig.maxTokensLimit,
                Math.max(usedMaxTokens + 512, Math.ceil(usedMaxTokens * 1.5))
              )
            : null;

        logger.warn('Chat completion truncated by max_tokens', {
          provider: this.providerConfig.name,
          model: normalizedParams.model,
          usedMaxTokens,
          suggestedMaxTokens,
        });

        const metadata = ((response as any).response_metadata ?? {}) as Record<string, any>;
        metadata.status = metadata.status ?? 'completed';
        metadata.truncated = true;
        metadata.incomplete_reason = 'max_tokens';
        metadata.original_finish_reasons = response.choices.map(choice => choice.finish_reason);
        metadata.need_more_budget = true;
        metadata.partial_response = response.choices[0]?.message?.content ?? '';
        metadata.used_max_tokens = usedMaxTokens;
        metadata.suggested_max_tokens = suggestedMaxTokens;

        (response as any).response_metadata = metadata;
      }

      return response;
    } catch (error) {
      logger.error('Chat completion failed', {
        provider: this.providerConfig.name,
        model: targetModel,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Create a streaming chat completion
   */
  async createChatCompletionStream(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
  ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const targetModel = params.model || this.getModelForTask('base');
    const paramsWithModel = {
      ...params,
      model: targetModel,
      stream: true,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
    const wantsReasoningModel = this.isReasoningModel(targetModel);

    try {
      if (wantsReasoningModel) {
        logger.info('Routing reasoning-capable model through Responses API (stream fallback)', {
          provider: this.providerConfig.name,
          model: targetModel,
        });
      } else {
        logger.info('Creating streaming chat completion', {
          provider: this.providerConfig.name,
          model: paramsWithModel.model,
          messagesCount: paramsWithModel.messages.length,
        });
      }

      // Validate context before making streaming API call
      try {
        validateDynamicSignal(paramsWithModel.messages as Message[]);
        logger.debug('✅ Streaming context validation passed', {
          messageCount: paramsWithModel.messages.length,
          provider: this.providerConfig.name,
        });
      } catch (validationError) {
        if (validationError instanceof ValidationError) {
          logger.warn('🚫 Streaming context validation failed, blocking API call', {
            error: validationError.message,
            code: validationError.structured.code,
            context: validationError.structured.context,
            suggestion: validationError.structured.suggestion,
          });

          throw new Error(
            `INSUFFICIENT_CONTEXT: ${validationError.message}. ${validationError.structured.suggestion || ''}`
          );
        }
        throw validationError;
      }

      if (wantsReasoningModel) {
        const nonStreamingParams = {
          ...paramsWithModel,
          stream: false,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

        const completion = await this.createReasoningCompletion(nonStreamingParams);

        async function* singleChunkStream(): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
          for (const choice of completion.choices) {
            yield {
              id: `${completion.id}-chunk-${choice.index}`,
              object: 'chat.completion.chunk',
              created: completion.created,
              model: completion.model,
              choices: [
                {
                  index: choice.index,
                  delta: choice.message,
                  finish_reason: choice.finish_reason,
                },
              ],
            } as OpenAI.Chat.Completions.ChatCompletionChunk;
          }
        }

        return singleChunkStream();
      }

      // Make the streaming API call for standard chat models
      return await this.client.chat.completions.create(paramsWithModel);
    } catch (error) {
      logger.error('Streaming chat completion failed', {
        provider: this.providerConfig.name,
        model: targetModel,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Get current provider information
   */
  getProviderInfo(): {
    provider: string;
    model: string;
    miniModel: string;
    supportsStreaming: boolean;
  } {
    return {
      provider: this.providerConfig.name,
      model: this.config.model || this.providerConfig.defaultModel,
      miniModel: this.config.miniModel || this.providerConfig.defaultMiniModel,
      supportsStreaming: this.providerConfig.supportsStreaming || false,
    };
  }

  /**
   * Get the appropriate model based on complexity needs
   */
  getModelForTask(task: 'base' | 'mini' = 'base'): string {
    if (task === 'base') {
      return this.config.model || this.providerConfig.defaultModel;
    } else {
      return this.config.miniModel || this.providerConfig.defaultMiniModel;
    }
  }

  /**
   * Get embeddings model name
   */
  getEmbeddingsModel(): string {
    return (
      this.config.embeddingsModel ||
      process.env.OPENAI_EMBEDDINGS_MODEL ||
      this.providerConfig.defaultEmbeddingsModel ||
      'text-embedding-3-large'
    );
  }

  /**
   * Validate if the current configuration is ready for use
   */
  isReady(): boolean {
    return !!this.client && !!this.config.apiKey;
  }

  /**
   * Get the underlying OpenAI client
   */
  getClient(): OpenAI | null {
    return this.isReady() ? this.client : null;
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    // Close any open connections
    (this.client as any) = undefined;
    logger.info('OpenAI Service disposed');
  }
}

// Factory function for easier instantiation
export function createOpenAIService(config: OpenAIServiceConfig): OpenAIService {
  return new OpenAIService(config);
}

// Lazy-loaded singleton instance
let _openaiServiceInstance: OpenAIService | null = null;

/**
 * Get the OpenAI service instance, creating it lazily if needed
 */
export function getOpenAIService(): OpenAIService {
  if (!_openaiServiceInstance) {
    _openaiServiceInstance = new OpenAIService({
      apiKey: process.env.OPENAI_API_KEY || '',
      provider: (process.env.OPENAI_PROVIDER as ProviderType) || 'openai',
      model: process.env.OPENAI_BASE_MODEL,
      miniModel: process.env.OPENAI_MINI_MODEL,
      embeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL,
      baseUrl: process.env.OPENAI_BASE_URL,
    });
  }
  return _openaiServiceInstance;
}

/**
 * Reset the OpenAI service instance (useful for testing)
 */
export function resetOpenAIService(): void {
  _openaiServiceInstance = null;
}

// Export the service getter for backward compatibility
export const openaiService = {
  get instance() {
    return getOpenAIService();
  },
  // Delegate all methods to the lazy-loaded instance
  createChatCompletion: (...args: Parameters<OpenAIService['createChatCompletion']>) =>
    getOpenAIService().createChatCompletion(...args),
  createChatCompletionStream: (...args: Parameters<OpenAIService['createChatCompletionStream']>) =>
    getOpenAIService().createChatCompletionStream(...args),
  getProviderInfo: () => getOpenAIService().getProviderInfo(),
  getModelForTask: (...args: Parameters<OpenAIService['getModelForTask']>) =>
    getOpenAIService().getModelForTask(...args),
  getEmbeddingsModel: () => getOpenAIService().getEmbeddingsModel(),
  isReady: () => getOpenAIService().isReady(),
  getClient: () => getOpenAIService().getClient(),
  quickProbe: (...args: Parameters<OpenAIService['quickProbe']>) =>
    getOpenAIService().quickProbe(...args),
  dispose: () => getOpenAIService().dispose(),
};

export default OpenAIService;
