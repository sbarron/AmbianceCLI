/**
 * @fileOverview: Utilities for running side-by-side model comparison prompts.
 * @module: MultiModelCompare
 * @context: Enables quick evaluation of multiple providers/models for the same prompt.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  createOpenAIService,
  ProviderType,
  PROVIDER_API_KEY_ENV,
  resolveProviderApiKey,
} from '../../core/openaiService';
import { logger } from '../../utils/logger';

export interface ModelTargetSpec {
  provider: ProviderType;
  model: string;
  label?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface MultiModelComparisonOptions {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  models: ModelTargetSpec[];
}

export interface ModelComparisonResult {
  provider: ProviderType;
  model: string;
  label: string;
  durationMs: number;
  responseText?: string;
  finishReason?: string | null;
  usage?: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
  metadata?: Record<string, unknown>;
  cacheStatus?: unknown;
  error?: string;
}

export interface MultiModelComparisonResult {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  startedAt: string;
  results: ModelComparisonResult[];
}

const DEFAULT_BASE_URLS: Record<ProviderType, string | undefined> = {
  openai: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  azure: process.env.AZURE_OPENAI_ENDPOINT,
  anthropic: 'https://api.anthropic.com/v1',
  together: 'https://api.together.xyz/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  grok: 'https://api.x.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  custom: process.env.OPENAI_BASE_URL,
};

export async function runMultiModelComparison(
  options: MultiModelComparisonOptions
): Promise<MultiModelComparisonResult> {
  if (!options.prompt || options.prompt.trim().length === 0) {
    throw new Error('A prompt is required to run model comparison.');
  }

  if (!options.models || options.models.length === 0) {
    throw new Error('At least one model specification is required.');
  }

  const startedAt = new Date().toISOString();
  const results: ModelComparisonResult[] = [];

  for (const spec of options.models) {
    const provider = spec.provider;
    const label = spec.label || `${provider}:${spec.model}`;
    const apiKey = spec.apiKey ?? resolveProviderApiKey(provider);

    if (!apiKey) {
      const expected = PROVIDER_API_KEY_ENV[provider] || ['OPENAI_API_KEY'];
      results.push({
        provider,
        model: spec.model,
        label,
        durationMs: 0,
        error: `Missing API key for provider "${provider}". Set one of: ${expected.join(', ')}`,
      });
      continue;
    }

    const explicitBaseUrl = spec.baseUrl ?? DEFAULT_BASE_URLS[provider];

    const service = createOpenAIService({
      apiKey,
      provider,
      model: spec.model,
      baseUrl: explicitBaseUrl,
    });

    const messages: ChatCompletionMessageParam[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: options.prompt });

    const payload: Record<string, unknown> = {
      model: spec.model,
      messages,
    };

    if (typeof options.temperature === 'number') {
      payload.temperature = options.temperature;
    }

    if (typeof options.maxTokens === 'number') {
      payload.max_tokens = options.maxTokens;
    }

    const started = Date.now();

    try {
      const completion = await service.createChatCompletion(
        payload as any // Parameters already validated above
      );

      const usage = completion.usage;
      const metadata = (completion as any).response_metadata as Record<string, unknown> | undefined;
      const cacheStatus =
        metadata && typeof (metadata as Record<string, any>).cache_status !== 'undefined'
          ? (metadata as Record<string, any>).cache_status
          : null;

      const durationMs = Date.now() - started;

      results.push({
        provider,
        model: spec.model,
        label,
        durationMs,
        responseText: completion.choices?.[0]?.message?.content ?? '',
        finishReason: completion.choices?.[0]?.finish_reason ?? null,
        usage: usage
          ? {
              promptTokens: usage.prompt_tokens ?? null,
              completionTokens: usage.completion_tokens ?? null,
              totalTokens: usage.total_tokens ?? null,
            }
          : undefined,
        metadata,
        cacheStatus,
      });
    } catch (error) {
      const durationMs = Date.now() - started;
      logger.error('Model comparison request failed', {
        provider,
        model: spec.model,
        error: error instanceof Error ? error.message : String(error),
      });

      results.push({
        provider,
        model: spec.model,
        label,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      try {
        await service.dispose();
      } catch {
        // Ignore disposal errors for transient clients
      }
    }
  }

  return {
    prompt: options.prompt,
    systemPrompt: options.systemPrompt,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    startedAt,
    results,
  };
}

export function formatComparisonResultMarkdown(result: MultiModelComparisonResult): string {
  const lines: string[] = [];
  lines.push('Model Comparison Results');
  lines.push('=======================');
  lines.push(`Prompt: ${result.prompt}`);
  if (result.systemPrompt) {
    lines.push(`System: ${result.systemPrompt}`);
  }
  if (typeof result.temperature === 'number') {
    lines.push(`Temperature: ${result.temperature}`);
  }
  if (typeof result.maxTokens === 'number') {
    lines.push(`Max Tokens: ${result.maxTokens}`);
  }
  lines.push('');

  if (result.results.length === 0) {
    lines.push('No results.');
    return lines.join('\n');
  }

  result.results.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.label}`);
    lines.push(`   Provider: ${entry.provider}`);
    lines.push(`   Model: ${entry.model}`);
    lines.push(`   Duration: ${(entry.durationMs / 1000).toFixed(2)}s`);

    if (entry.error) {
      lines.push(`   Error: ${entry.error}`);
    } else {
      if (entry.finishReason) {
        lines.push(`   Finish Reason: ${entry.finishReason}`);
      }
      if (entry.usage) {
        lines.push(
          `   Usage: prompt=${entry.usage.promptTokens ?? 'n/a'}, completion=${entry.usage.completionTokens ?? 'n/a'}, total=${entry.usage.totalTokens ?? 'n/a'}`
        );
      }
      if (entry.cacheStatus) {
        lines.push(`   Cache: ${JSON.stringify(entry.cacheStatus)}`);
      }
      if (entry.responseText) {
        lines.push('   Response:');
        entry.responseText.split('\n').forEach(line => {
          lines.push(`     ${line}`);
        });
      }
    }

    lines.push('');
  });

  return lines.join('\n');
}
