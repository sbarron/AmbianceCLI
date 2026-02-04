import { AmbianceAPIClient, SearchResult, ContextBundle } from '../client/apiClient';
import { logger } from '../utils/logger';

let apiClient: AmbianceAPIClient | null = null;

function getAPIClient(): AmbianceAPIClient {
  if (!apiClient) {
    const apiKey = process.env.AMBIANCE_API_KEY;
    const apiURL =
      process.env.AMBIANCE_API_URL ||
      process.env.AMBIANCE_API_BASE_URL ||
      'https://api.ambiance.dev';

    if (!apiKey) {
      throw new Error('AMBIANCE_API_KEY environment variable is required');
    }

    apiClient = new AmbianceAPIClient(apiKey, apiURL);
  }

  return apiClient;
}

export async function handleSearchContext(args: {
  query: string;
  repo?: string;
  branch?: string;
  k?: number;
}): Promise<SearchResult[]> {
  try {
    logger.info('🔍 Cloud search context called with:', {
      query: args.query,
      repo: args.repo,
      k: args.k,
    });

    const client = getAPIClient();

    // Test API connectivity first
    const isHealthy = await client.healthCheck();
    if (!isHealthy) {
      throw new Error('Ambiance API is not accessible');
    }

    const results = await client.searchContext({
      query: args.query,
      repo: args.repo,
      branch: args.branch || 'main',
      k: args.k || 12,
    });

    logger.info(`✅ Cloud search completed. Found ${results.length} results`);
    if (results.length > 0) {
      logger.info('📋 Sample results:');
      results.slice(0, 2).forEach((result, i) => {
        logger.info(
          `  ${i + 1}. ${result.path}:${result.startLine}-${result.endLine} (score: ${result.score})`
        );
      });
    }

    return results;
  } catch (error) {
    logger.error('❌ Error in cloud search context:', {
      error: error instanceof Error ? error.message : String(error),
    });

    // Provide helpful error context
    if (error instanceof Error) {
      if (error.message.includes('API_KEY')) {
        throw new Error(
          'Ambiance API key not configured. Set AMBIANCE_API_KEY environment variable.'
        );
      } else if (error.message.includes('Network error')) {
        throw new Error('Cannot reach Ambiance cloud service. Check your internet connection.');
      } else {
        throw new Error(`Cloud search failed: ${error.message}`);
      }
    } else {
      throw new Error('Unknown error occurred during cloud search');
    }
  }
}

export async function handleGetContextBundle(args: {
  query: string;
  hints?: string[];
  token_budget?: number;
  repo?: string;
  branch?: string;
}): Promise<ContextBundle> {
  try {
    logger.info('📦 Cloud context bundle called with:', {
      query: args.query,
      repo: args.repo,
      token_budget: args.token_budget,
    });

    const client = getAPIClient();

    const bundle = await client.getContextBundle({
      query: args.query,
      hints: args.hints,
      token_budget: args.token_budget || 4000,
      repo: args.repo,
      branch: args.branch || 'main',
    });

    logger.info(`✅ Context bundle received with ${bundle.snippets.length} snippets`);
    logger.info(
      `💰 Token usage: ${bundle.budget.used}/${bundle.budget.requested} (${bundle.budget.remaining} remaining)`
    );

    return bundle;
  } catch (error) {
    logger.error('❌ Error getting context bundle:', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Utility function to get available repositories
export async function getRepositories(): Promise<any[]> {
  try {
    const client = getAPIClient();
    return await client.getRepositories();
  } catch (error) {
    logger.error('❌ Error fetching repositories:', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function handleListRepositories(): Promise<any[]> {
  return getRepositories();
}

// Utility function to get security alerts
export async function getAlerts(repoId?: string, since?: string): Promise<any[]> {
  try {
    const client = getAPIClient();
    return await client.getAlerts(repoId, since);
  } catch (error) {
    logger.error('❌ Error fetching alerts:', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
