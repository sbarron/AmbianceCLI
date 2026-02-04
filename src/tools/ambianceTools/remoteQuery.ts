/**
 * @fileOverview: Ambiance remote query tool for direct cloud API access
 * @module: RemoteQuery
 * @keyFunctions:
 *   - handleRemoteQuery(): Direct query to Ambiance cloud service by projectId
 * @dependencies:
 *   - apiClient: Cloud service communication
 * @context: Provides direct access to cloud-indexed project data
 */

import { logger } from '../../utils/logger';
import { apiClient } from '../../client/apiClient';

export const ambianceRemoteQueryTool = {
  name: 'ambiance_remote_query',
  description: 'Remote query by projectId using the Ambiance cloud retrieval service.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        minLength: 1,
        description: 'Project ID in the Ambiance cloud system',
      },
      query: {
        type: 'string',
        minLength: 3,
        description: 'Query to search within the specified project',
      },
      maxTokens: {
        type: 'number',
        minimum: 500,
        maximum: 16000,
        default: 8000,
        description: 'Maximum tokens to return in response',
      },
      includeFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional file hints to focus the query',
      },
    },
    required: ['projectId', 'query'],
  },
};

export async function handleRemoteQuery(args: any): Promise<any> {
  const { projectId, query, maxTokens = 8000, includeFiles = [] } = args;

  logger.info('🌐 Remote query', { projectId, q: query.substring(0, 80) });

  try {
    const resp = await apiClient.post('/v1/context/generate', {
      projectId,
      query,
      maxTokens,
      includeFiles,
    });

    return {
      success: true,
      prompt: resp.prompt || resp.data?.prompt,
      citations: resp.citations || resp.data?.citations,
      tokenCount: resp.tokenCount || resp.data?.tokenCount,
    };
  } catch (error) {
    logger.error('❌ Remote query failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
