/**
 * @fileOverview: Token Parameter Utilities for AI Tools
 * @module: TokenUtils
 * @keyFunctions:
 *   - determineTokenParameter: Choose between max_tokens (legacy), max_completion_tokens (modern), and max_output_tokens (reasoning)
 *   - buildApiRequest: Build API request with appropriate token parameter
 * @context: Handles compatibility between deprecated max_tokens, new max_completion_tokens, and reasoning-aware max_output_tokens
 */

import { logger } from '../../../utils/logger';

/**
 * Determine which token parameter to use based on the model
 */
export function determineTokenParameter(
  model: string
): 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens' {
  const normalizedModel = model.toLowerCase();

  if (normalizedModel.startsWith('gpt-5')) {
    return 'max_output_tokens';
  }

  // Legacy models that still use max_tokens
  const isLegacyModel =
    normalizedModel.includes('gpt-4.1') ||
    normalizedModel.includes('gpt-4o') ||
    normalizedModel.includes('gpt-4o-mini') ||
    normalizedModel.includes('gpt-3.5') ||
    normalizedModel.includes('text-') ||
    normalizedModel.includes('davinci') ||
    normalizedModel.includes('curie') ||
    normalizedModel.includes('babbage') ||
    normalizedModel.includes('ada') ||
    normalizedModel.includes('claude-') || // Anthropic models
    normalizedModel.includes('gemini-') || // Google models
    normalizedModel.includes('command-') || // Cohere models
    normalizedModel.includes('qwen-'); // Qwen models

  return isLegacyModel ? 'max_tokens' : 'max_completion_tokens';
}

/**
 * Build API request with appropriate token parameter
 */
export function buildApiRequest(
  model: string,
  messages: any[],
  maxTokens: number,
  temperature: number = 0.3,
  additionalParams: Record<string, any> = {}
): any {
  const tokenParam = determineTokenParameter(model);

  logger.info('🔍 Token parameter selection', {
    model,
    isLegacyModel: tokenParam === 'max_tokens',
    usingParameter: tokenParam,
    tokenValue: maxTokens,
  });

  const apiRequest: any = {
    model,
    messages,
    temperature,
    ...additionalParams,
  };

  // Add the appropriate token parameter
  apiRequest[tokenParam] = maxTokens;

  if (tokenParam === 'max_output_tokens' && 'temperature' in apiRequest) {
    logger.info('ℹ️ Reasoning models ignore temperature; relying on reasoning.effort instead', {
      model,
    });
    delete apiRequest.temperature;
  }

  return apiRequest;
}
