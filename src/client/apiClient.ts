/** DEPRECATED - TEST FOR REMOVAL
 * @fileOverview: HTTP client for Ambiance API (Cloud) with semantic search and context retrieval capabilities
 * @module: AmbianceAPIClient
 * @keyFunctions:
 *   - searchCode(): Perform intelligent code searches across repositories
 *   - getContextBundle(): Create comprehensive context packages for LLM consumption
 *   - handleError(): Robust error handling with retry logic and logging
 * @dependencies:
 *   - axios: HTTP client with retry and timeout configuration
 *   - logger: Logging utilities for debugging and monitoring
 *   - SearchRequest/ContextBundleRequest: Type definitions for API requests
 * @context: Provides reliable API communication for semantic code analysis, handling authentication, error recovery, and response validation
 */

import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { logger } from '../utils/logger';

export interface SearchRequest {
  query: string;
  repo?: string;
  branch?: string;
  k?: number;
}

export interface ContextBundleRequest {
  query: string;
  hints?: string[];
  token_budget?: number;
  repo?: string;
  branch?: string;
}

export interface GraphContextRequest {
  query: string;
  github_repos?: string[];
  github_repo?: string;
  branch?: string;
  max_nodes?: number;
  max_tokens?: number;
  include_related_files?: boolean;
  focus_areas?: string[];
}

export interface GraphContextResponse {
  context: string;
  nodes: Array<{
    id: string;
    name: string;
    kind: string;
    path: string;
    startLine: number;
    endLine: number;
    relationships?: string[];
  }>;
  relationships: Array<{
    source: string;
    target: string;
    type: string;
    strength: number;
  }>;
  metadata: {
    query: string;
    repositories: string[];
    nodeCount: number;
    tokenCount: number;
    timestamp: string;
    embeddingProvider?: string;
    processingTime?: number;
  };
  budget: {
    requested: number;
    used: number;
    remaining: number;
  };
}

export interface EmbeddingUploadRequest {
  repo_id: string;
  chunks: Array<{
    file_path: string;
    content: string;
    start_line: number;
    end_line: number;
    token_estimate: number;
    content_hash: string;
    symbol_id?: string;
  }>;
  embeddings: Array<{
    chunk_index: number;
    vector: number[];
    model: string;
  }>;
  session_id?: string;
}

export interface EmbeddingGenerationRequest {
  texts: string[];
  input_type?: 'document' | 'query';
  model?: string;
  encoding_format?: 'float32' | 'int8';
  include_context?: boolean;
  context_window?: number;
}

export interface EmbeddingGenerationResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
  input_type: 'document' | 'query';
  encoding_format: 'float32' | 'int8';
  total_tokens: number;
  processing_time_ms: number;
  provider: string; // 'voyageai' | 'openai' | 'local'
}

export interface SearchResult {
  id: string;
  body: string;
  source: 'cloud';
  meta: {
    language?: string;
    path: string;
    startLine: number;
    endLine: number;
    sha?: string;
  };
  score: number;
  path: string;
  startLine: number;
  endLine: number;
}

export interface ContextBundle {
  snippets: SearchResult[];
  budget: {
    requested: number;
    used: number;
    remaining: number;
  };
  metadata: {
    query: string;
    repos: string[];
    timestamp: string;
  };
}

export class AmbianceAPIClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL: string = 'https://api.ambiance.dev') {
    this.apiKey = apiKey;

    // Support local server override
    if (process.env.USING_LOCAL_SERVER_URL) {
      this.baseURL = process.env.USING_LOCAL_SERVER_URL;
    } else {
      this.baseURL = baseURL;
    }

    // Prepare headers - API key is optional for local servers
    const headers: any = {
      'Content-Type': 'application/json',
      'User-Agent': 'ambiance-cli-proxy/0.0.1',
    };

    // Only add Authorization header if API key is provided
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      headers,
      // Match typical Fastify defaults but allow larger bodies when needed
      timeout: 30000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error: AxiosError | any) => {
        if (error.response) {
          // API returned an error response
          const { status, data } = error.response;
          throw new Error(`API Error ${status}: ${data.error || data.message || 'Unknown error'}`);
        } else if (error.request) {
          // Network error
          throw new Error('Network error: Unable to reach Ambiance API');
        } else {
          // Other error
          throw new Error(`Request error: ${error.message}`);
        }
      }
    );
  }

  private sanitizeForLog(value: any): any {
    try {
      if (Array.isArray(value)) {
        return value.slice(0, 5).map(v => this.sanitizeForLog(v));
      }
      if (value && typeof value === 'object') {
        const out: any = {};
        for (const [k, v] of Object.entries(value)) {
          const keyLower = k.toLowerCase();
          if (keyLower === 'contentgzipbase64') {
            if (typeof v === 'string') out[k] = `<base64 len=${v.length}>`;
            else out[k] = '<base64>';
          } else if (
            keyLower.includes('authorization') ||
            keyLower.includes('key') ||
            keyLower.includes('secret') ||
            keyLower.includes('token')
          ) {
            out[k] = '<redacted>';
          } else {
            out[k] = this.sanitizeForLog(v);
          }
        }
        return out;
      }
      if (typeof value === 'string' && value.length > 200) {
        return value.slice(0, 200) + '…';
      }
      return value;
    } catch {
      return '<unloggable>';
    }
  }

  private toSnippet(obj: any, limit: number = 200): string {
    try {
      const safe = this.sanitizeForLog(obj);
      const s = JSON.stringify(safe);
      return s.length > limit ? s.slice(0, limit) + '…' : s;
    } catch {
      return '<unserializable>';
    }
  }

  async searchContext(request: SearchRequest): Promise<SearchResult[]> {
    try {
      logger.info('Searching cloud API', {
        query: request.query,
        repo: request.repo,
        branch: request.branch,
      });

      const response = await this.client.post('/v1/context/search', {
        query: request.query,
        repo: request.repo,
        branch: request.branch || 'main',
        k: request.k || 12,
      });

      const results = response.data.map(
        (item: any): SearchResult => ({
          id: item.id || `${item.path}:${item.start_line}-${item.end_line}`,
          body: item.body || item.content,
          source: 'cloud' as const,
          meta: {
            language: item.lang || item.language,
            path: item.path,
            startLine: item.start_line || item.startLine,
            endLine: item.end_line || item.endLine,
            sha: item.sha || item.commit_sha,
          },
          score: item.score || 0,
          path: item.path,
          startLine: item.start_line || item.startLine,
          endLine: item.end_line || item.endLine,
        })
      );

      logger.info('Cloud API search completed', {
        resultCount: results.length,
        query: request.query,
      });
      return results;
    } catch (error) {
      logger.error('Cloud API search failed', {
        query: request.query,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async getContextBundle(request: ContextBundleRequest): Promise<ContextBundle> {
    try {
      logger.info('Requesting context bundle', {
        query: request.query,
        tokenBudget: request.token_budget,
        repo: request.repo,
        branch: request.branch,
      });

      const response = await this.client.post('/v1/context/bundle', {
        query: request.query,
        hints: request.hints,
        tokenBudget: request.token_budget || 4000,
        projectId: request.repo,
        branch: request.branch || 'main',
      });

      const bundle: ContextBundle = {
        snippets: (response.data.contextBundle?.snippets || response.data.snippets || []).map(
          (item: any): SearchResult => ({
            id: item.id || `${item.path}:${item.start_line}-${item.end_line}`,
            body: item.body || item.content,
            source: 'cloud' as const,
            meta: {
              language: item.lang || item.language,
              path: item.path,
              startLine: item.start_line || item.startLine,
              endLine: item.end_line || item.endLine,
              sha: item.sha || item.commit_sha,
            },
            score: item.score || 0,
            path: item.path,
            startLine: item.start_line || item.startLine,
            endLine: item.end_line || item.endLine,
          })
        ),
        budget: response.data.contextBundle?.budget ||
          response.data.budget || {
            requested: request.token_budget || 4000,
            used: 0,
            remaining: request.token_budget || 4000,
          },
        metadata: response.data.contextBundle?.metadata ||
          response.data.metadata || {
            query: request.query,
            repos: request.repo ? [request.repo] : [],
            timestamp: new Date().toISOString(),
          },
      };

      logger.info('Context bundle received', {
        snippetCount: bundle.snippets.length,
        query: request.query,
        budgetUsed: bundle.budget.used,
      });
      return bundle;
    } catch (error) {
      logger.error('Context bundle request failed', {
        query: request.query,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async getGraphContext(request: GraphContextRequest): Promise<GraphContextResponse> {
    try {
      logger.info('Requesting graph context', {
        query: request.query,
        maxNodes: request.max_nodes,
        maxTokens: request.max_tokens,
        repos: request.github_repos || (request.github_repo ? [request.github_repo] : []),
        branch: request.branch,
      });

      // Build the request payload to match the API expectations
      const payload: any = {
        query: request.query,
        maxNodes: request.max_nodes || 20,
        maxTokens: request.max_tokens || 8000,
        includeRelatedFiles: request.include_related_files !== false,
        branch: request.branch || 'main',
      };

      // Handle repository specification - support both single and multiple repos
      if (request.github_repos && request.github_repos.length > 0) {
        payload.projectIds = request.github_repos;
      } else if (request.github_repo) {
        payload.projectId = request.github_repo;
      }

      if (request.focus_areas && request.focus_areas.length > 0) {
        payload.focusAreas = request.focus_areas;
      }

      const response = await this.client.post('/v1/context/graph', payload);

      const graphResponse: GraphContextResponse = {
        context: response.data.context || '',
        nodes: (response.data.nodes || []).map((node: any) => ({
          id: node.id,
          name: node.name,
          kind: node.kind,
          path: node.path,
          startLine: node.startLine || node.start_line,
          endLine: node.endLine || node.end_line,
          relationships: node.relationships || [],
        })),
        relationships: (response.data.relationships || []).map((rel: any) => ({
          source: rel.source,
          target: rel.target,
          type: rel.type,
          strength: rel.strength || 1.0,
        })),
        metadata: {
          query: request.query,
          repositories:
            response.data.metadata?.repositories ||
            request.github_repos ||
            (request.github_repo ? [request.github_repo] : []),
          nodeCount: response.data.metadata?.nodeCount || (response.data.nodes || []).length,
          tokenCount: response.data.metadata?.tokenCount || 0,
          timestamp: response.data.metadata?.timestamp || new Date().toISOString(),
          embeddingProvider: response.data.metadata?.embeddingProvider,
          processingTime: response.data.metadata?.processingTime,
        },
        budget: response.data.budget || {
          requested: request.max_tokens || 8000,
          used: response.data.metadata?.tokenCount || 0,
          remaining: (request.max_tokens || 8000) - (response.data.metadata?.tokenCount || 0),
        },
      };

      logger.info('Graph context received', {
        nodeCount: graphResponse.nodes.length,
        relationshipCount: graphResponse.relationships.length,
        query: request.query,
        tokenCount: graphResponse.metadata.tokenCount,
        embeddingProvider: graphResponse.metadata.embeddingProvider,
      });

      return graphResponse;
    } catch (error) {
      logger.error('Graph context request failed', {
        query: request.query,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async getRepositories(): Promise<any[]> {
    try {
      const response = await this.client.get('/v1/repos/github');
      // API returns { repositories: [...] } not direct array
      return response.data.repositories || [];
    } catch (error) {
      logger.error('Failed to fetch repositories', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async getAlerts(repoId?: string, since?: string): Promise<any[]> {
    try {
      const params = new URLSearchParams();
      if (repoId) params.append('repo_id', repoId);
      if (since) params.append('since', since);

      const response = await this.client.get(`/v1/alerts?${params}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch alerts', {
        repoId,
        since,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Allow skipping the health check when local routes are down or during offline dev
      if (process.env.SKIP_AMBIANCE_PROBE === 'true') {
        logger.warn('⏭️ Skipping Ambiance API health check due to SKIP_AMBIANCE_PROBE=true');
        return false;
      }
      await this.client.get('/health');
      return true;
    } catch (error) {
      // Demote to warn to avoid noisy logs when the cloud/local API is intentionally offline
      logger.warn('Health check failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }
  }

  async get(endpoint: string): Promise<any> {
    try {
      logger.info(`➡️ GET ${endpoint}`);
      const response = await this.client.get(endpoint);
      logger.info(`⬅️ GET ${endpoint} response: ${this.toSnippet(response.data)}`);
      return response.data;
    } catch (error) {
      logger.error('GET request failed', {
        endpoint,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async post(endpoint: string, data: any): Promise<any> {
    try {
      logger.info(`➡️ POST ${endpoint} body: ${this.toSnippet(data)}`);
      const response = await this.client.post(endpoint, data);
      logger.info(`⬅️ POST ${endpoint} response: ${this.toSnippet(response.data)}`);
      return response.data;
    } catch (error) {
      logger.error('POST request failed', {
        endpoint,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async put(endpoint: string, data: any): Promise<any> {
    try {
      logger.info(`➡️ PUT ${endpoint} body: ${this.toSnippet(data)}`);
      const response = await this.client.put(endpoint, data);
      logger.info(`⬅️ PUT ${endpoint} response: ${this.toSnippet(response.data)}`);
      return response.data;
    } catch (error) {
      logger.error('PUT request failed', {
        endpoint,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async delete(endpoint: string): Promise<any> {
    try {
      logger.info(`➡️ DELETE ${endpoint}`);
      const response = await this.client.delete(endpoint);
      logger.info(`⬅️ DELETE ${endpoint} response: ${this.toSnippet(response.data)}`);
      return response.data;
    } catch (error) {
      logger.error('DELETE request failed', {
        endpoint,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async uploadEmbeddings(request: EmbeddingUploadRequest): Promise<any> {
    try {
      logger.info('Uploading embeddings to cloud', {
        repoId: request.repo_id,
        chunkCount: request.chunks.length,
        embeddingCount: request.embeddings.length,
      });

      const response = await this.client.post('/v1/embeddings/upload', {
        repo_id: request.repo_id,
        chunks: request.chunks,
        embeddings: request.embeddings,
        session_id: request.session_id,
      });

      logger.info('Embedding upload completed', {
        repoId: request.repo_id,
        uploadedChunks: response.data?.uploaded_chunks || 0,
        uploadedEmbeddings: response.data?.uploaded_embeddings || 0,
      });
      return response.data;
    } catch (error) {
      logger.error('Embedding upload failed', {
        repoId: request.repo_id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Generate embeddings for text chunks using Ambiance API
   */
  async generateEmbeddings(
    request: EmbeddingGenerationRequest
  ): Promise<EmbeddingGenerationResponse> {
    try {
      logger.info('🚀 Generating embeddings via Ambiance API', {
        textCount: request.texts.length,
        inputType: request.input_type || 'document',
        model: request.model || process.env.VOYAGEAI_MODEL || 'voyageai-model',
        encodingFormat: request.encoding_format || 'float32',
      });

      const response = await this.client.post<EmbeddingGenerationResponse>(
        '/embeddings/generate',
        request
      );

      logger.info('✅ Embeddings generated successfully', {
        textCount: request.texts.length,
        provider: response.data.provider,
        model: response.data.model,
        dimensions: response.data.dimensions,
        totalTokens: response.data.total_tokens,
        processingTimeMs: response.data.processing_time_ms,
      });

      return response.data;
    } catch (error) {
      logger.error('❌ Embedding generation failed', {
        textCount: request.texts.length,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
}

// Create and export a default instance with lazy initialization
let _apiClient: AmbianceAPIClient | null = null;

export const apiClient = {
  get client(): AmbianceAPIClient {
    if (!_apiClient) {
      const API_KEY = process.env.AMBIANCE_API_KEY || '';
      const API_URL =
        process.env.USING_LOCAL_SERVER_URL ||
        process.env.AMBIANCE_API_URL ||
        'https://api.ambiance.dev';
      _apiClient = new AmbianceAPIClient(API_KEY, API_URL);
    }
    return _apiClient;
  },

  // Proxy methods to maintain the same API
  async searchContext(request: SearchRequest) {
    return this.client.searchContext(request);
  },
  async getContextBundle(request: ContextBundleRequest) {
    return this.client.getContextBundle(request);
  },
  async getGraphContext(request: GraphContextRequest) {
    return this.client.getGraphContext(request);
  },
  async getRepositories() {
    return this.client.getRepositories();
  },
  async getAlerts(repoId?: string, since?: string) {
    return this.client.getAlerts(repoId, since);
  },
  async healthCheck() {
    return this.client.healthCheck();
  },
  async get(endpoint: string) {
    return this.client.get(endpoint);
  },
  async post(endpoint: string, data: any) {
    return this.client.post(endpoint, data);
  },
  async put(endpoint: string, data: any) {
    return this.client.put(endpoint, data);
  },
  async delete(endpoint: string) {
    return this.client.delete(endpoint);
  },
  async uploadEmbeddings(request: EmbeddingUploadRequest) {
    return this.client.uploadEmbeddings(request);
  },
  async generateEmbeddings(request: EmbeddingGenerationRequest) {
    return this.client.generateEmbeddings(request);
  },
};

// The EmbeddingUploadRequest interface is already exported above
