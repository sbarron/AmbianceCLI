/**
 * @fileOverview: System Map composer for local_context tool using shared retrieval
 * @module: SystemMapComposer
 * @context: Transforms retrieved chunks into a System Map with sections ordered by query facets
 */

import { ScoredChunk } from '../../shared/retrieval/types';
import { sharedRetriever } from '../../shared/retrieval/retriever';
import { logComposerTelemetry } from '../../shared/telemetry';
import { logger } from '../../utils/logger';
import { LocalEmbeddingStorage } from '../../local/embeddingStorage';
import { LocalEmbeddingGenerator } from '../../local/embeddingGenerator';

export interface SystemMapSection {
  title: string;
  items: SystemMapItem[];
  description?: string;
}

export interface SystemMapItem {
  title: string;
  content: string;
  location?: string;
  confidence?: number;
  signals?: string[];
}

export interface SystemMap {
  modalities: SystemMapSection;
  middlewareGuards: SystemMapSection;
  protectedRoutes: SystemMapSection;
  dbRls: SystemMapSection;
  configSecrets: SystemMapSection;
  keyFiles: SystemMapSection;
  flow: SystemMapSection;
  metadata: {
    queryFacets: string[];
    anchorsHit: string[];
    coveragePct: number;
    processingTimeMs: number;
    totalChunksUsed: number;
  };
}

export class SystemMapComposer {
  private useEmbeddingAssisted: boolean;

  constructor() {
    // Check for embedding-assisted mode with smart defaults
    this.useEmbeddingAssisted = this.shouldUseEmbeddingAssistedHints();
  }

  /**
   * Check if embedding-assisted hints should be used by default
   * Returns true if USE_LOCAL_EMBEDDINGS is enabled and embeddings are available
   * Can be overridden by explicit EMBEDDING_ASSISTED_HINTS setting
   */
  private shouldUseEmbeddingAssistedHints(): boolean {
    // Check explicit override first
    const explicitSetting = process.env.EMBEDDING_ASSISTED_HINTS;
    if (explicitSetting !== undefined) {
      return explicitSetting === '1' || explicitSetting === 'true';
    }

    // Default to true if local embeddings are enabled and embeddings are available
    const useLocalEmbeddings = process.env.USE_LOCAL_EMBEDDINGS === 'true';
    const embeddingsAvailable =
      LocalEmbeddingStorage.isEnabled() && LocalEmbeddingGenerator.isAvailable();

    return useLocalEmbeddings && embeddingsAvailable;
  }

  /**
   * Compose a System Map from retrieved chunks
   */
  async composeSystemMap(query: string, chunks: ScoredChunk[]): Promise<SystemMap> {
    const startTime = Date.now();

    try {
      // Analyze query to determine facet ordering
      const queryFacets = this.analyzeQueryFacets(query);

      // Group chunks by facets for section ordering
      const facetGroups = this.groupChunksByFacets(chunks, queryFacets);

      // Extract anchors hit
      const anchorsHit = this.extractAnchorsHit(chunks);

      // Calculate coverage
      const coveragePct = this.calculateCoverage(chunks);

      // Build each section
      const systemMap: SystemMap = {
        modalities: this.buildModalitiesSection(facetGroups.auth || []),
        middlewareGuards: this.buildMiddlewareGuardsSection(facetGroups.auth || []),
        protectedRoutes: this.buildProtectedRoutesSection(facetGroups.routing || []),
        dbRls: this.buildDbRlsSection(facetGroups.data || []),
        configSecrets: this.buildConfigSecretsSection(facetGroups.build_runtime || []),
        keyFiles: this.buildKeyFilesSection(chunks.slice(0, 10)),
        flow: this.buildFlowSection(chunks, queryFacets),
        metadata: {
          queryFacets,
          anchorsHit,
          coveragePct,
          processingTimeMs: Date.now() - startTime,
          totalChunksUsed: chunks.length,
        },
      };

      // Calculate section counts for telemetry
      const sectionCounts: Record<string, number> = {};
      Object.keys(systemMap).forEach(key => {
        if (key !== 'metadata' && 'items' in (systemMap as any)[key]) {
          sectionCounts[key] = (systemMap as any)[key].items.length;
        }
      });

      // Calculate confidence based on coverage and anchors
      const confidence = Math.min(1.0, coveragePct * 0.6 + (anchorsHit.length > 0 ? 0.3 : 0) + 0.1);

      // Log composer telemetry
      logComposerTelemetry(
        'system_map',
        `map_${Date.now()}`,
        coveragePct,
        confidence,
        sectionCounts,
        systemMap.metadata.processingTimeMs
      );

      logger.info('✅ System Map composed', {
        query: query.substring(0, 50) + '...',
        sections: Object.keys(systemMap).filter(k => k !== 'metadata').length,
        totalItems: Object.values(systemMap)
          .filter(section => 'items' in section)
          .reduce((sum, section: any) => sum + section.items.length, 0),
        facets: queryFacets,
        anchorsHit: anchorsHit.length,
        coveragePct: Math.round(coveragePct * 100) + '%',
        processingTimeMs: systemMap.metadata.processingTimeMs,
      });

      return systemMap;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Log failed composer telemetry
      logComposerTelemetry(
        'system_map',
        `map_${Date.now()}`,
        0,
        0,
        {},
        Date.now() - startTime,
        undefined,
        errorMsg
      );

      logger.warn('⚠️ Failed to compose System Map', {
        error: errorMsg,
        query: query.substring(0, 50),
      });

      // Return minimal fallback
      return this.createFallbackSystemMap(query);
    }
  }

  /**
   * Analyze query to determine relevant facets for section ordering
   */
  private analyzeQueryFacets(query: string): string[] {
    const queryLower = query.toLowerCase();
    const facets: string[] = [];

    // Auth-related keywords
    if (
      queryLower.includes('auth') ||
      queryLower.includes('login') ||
      queryLower.includes('token') ||
      queryLower.includes('user')
    ) {
      facets.push('auth');
    }

    // Routing keywords
    if (
      queryLower.includes('route') ||
      queryLower.includes('api') ||
      queryLower.includes('endpoint') ||
      queryLower.includes('handler')
    ) {
      facets.push('routing');
    }

    // Data keywords
    if (
      queryLower.includes('database') ||
      queryLower.includes('data') ||
      queryLower.includes('model') ||
      queryLower.includes('schema')
    ) {
      facets.push('data');
    }

    // Observability keywords
    if (
      queryLower.includes('log') ||
      queryLower.includes('error') ||
      queryLower.includes('monitor') ||
      queryLower.includes('trace')
    ) {
      facets.push('observability');
    }

    // Build/runtime keywords
    if (
      queryLower.includes('config') ||
      queryLower.includes('env') ||
      queryLower.includes('deploy') ||
      queryLower.includes('build')
    ) {
      facets.push('build_runtime');
    }

    // Default to auth if no specific facets detected
    if (facets.length === 0) {
      facets.push('auth');
    }

    return facets;
  }

  /**
   * Group chunks by their detected facets
   */
  private groupChunksByFacets(
    chunks: ScoredChunk[],
    queryFacets: string[]
  ): Record<string, ScoredChunk[]> {
    const groups: Record<string, ScoredChunk[]> = {};

    // Initialize groups
    queryFacets.forEach(facet => {
      groups[facet] = [];
    });

    // Group chunks by their facet tags
    chunks.forEach(chunk => {
      chunk.meta.facet_tags.forEach((facet: string) => {
        if (groups[facet]) {
          groups[facet].push(chunk);
        }
      });
    });

    // Sort each group by score
    Object.keys(groups).forEach(facet => {
      groups[facet].sort((a, b) => b.score - a.score);
    });

    return groups;
  }

  /**
   * Build Modalities section (JWT/API keys, issuance, storage)
   */
  private buildModalitiesSection(authChunks: ScoredChunk[]): SystemMapSection {
    const items: SystemMapItem[] = [];

    // Extract authentication modalities
    const modalityPatterns = [
      {
        pattern: /JWT|jwt/i,
        title: 'JWT Tokens',
        description: 'JSON Web Tokens for authentication',
      },
      { pattern: /API.?key|apikey/i, title: 'API Keys', description: 'API key authentication' },
      { pattern: /Bearer/i, title: 'Bearer Tokens', description: 'Bearer token authentication' },
      { pattern: /session/i, title: 'Session-based', description: 'Session cookie authentication' },
      { pattern: /OAuth|oauth/i, title: 'OAuth', description: 'OAuth 2.0 authentication' },
    ];

    modalityPatterns.forEach(({ pattern, title, description }) => {
      const relevantChunks = authChunks.filter(
        chunk =>
          pattern.test(chunk.text) &&
          (chunk.meta.symbol_kind === 'func' || chunk.meta.symbol_kind === 'class')
      );

      if (relevantChunks.length > 0) {
        const topChunk = relevantChunks[0];
        items.push({
          title,
          content: description,
          location: `${topChunk.meta.path}${topChunk.meta.startLine ? `:${topChunk.meta.startLine}` : ''}`,
          confidence: topChunk.score,
          signals: topChunk.meta.signals || [],
        });
      }
    });

    return {
      title: '🔐 Authentication Modalities',
      items,
      description: 'Supported authentication methods and token types',
    };
  }

  /**
   * Build Middleware/Guards section
   */
  private buildMiddlewareGuardsSection(authChunks: ScoredChunk[]): SystemMapSection {
    const items: SystemMapItem[] = [];

    // Look for middleware functions and guards
    const middlewarePatterns = [
      { pattern: /middleware|guard|interceptor/i, title: 'Auth Middleware' },
      { pattern: /verifyToken|verifyAuth|authenticate/i, title: 'Token Verification' },
      { pattern: /requireAuth|checkAuth|isAuthenticated/i, title: 'Auth Guards' },
      { pattern: /Authorization.*header|Bearer.*header/i, title: 'Header Parsing' },
    ];

    middlewarePatterns.forEach(({ pattern, title }) => {
      const relevantChunks = authChunks.filter(
        chunk => pattern.test(chunk.text) && chunk.meta.symbol_kind === 'func'
      );

      if (relevantChunks.length > 0) {
        const topChunk = relevantChunks[0];
        const excerpt = this.extractFunctionSignature(topChunk.text);

        items.push({
          title,
          content: excerpt,
          location: `${topChunk.meta.path}${topChunk.meta.startLine ? `:${topChunk.meta.startLine}` : ''}`,
          confidence: topChunk.score,
          signals: topChunk.meta.signals || [],
        });
      }
    });

    return {
      title: '🛡️ Middleware & Guards',
      items,
      description: 'Authentication middleware and guard functions',
    };
  }

  /**
   * Build Protected Routes section
   */
  private buildProtectedRoutesSection(routingChunks: ScoredChunk[]): SystemMapSection {
    const items: SystemMapItem[] = [];

    // Look for route handlers with auth requirements
    routingChunks
      .filter(
        chunk =>
          chunk.meta.symbol_kind === 'route' || /GET|POST|PUT|DELETE|router|app\./.test(chunk.text)
      )
      .slice(0, 6)
      .forEach(chunk => {
        const routeMatch = chunk.text.match(/(GET|POST|PUT|DELETE|PATCH)\s+['"]([^'"]+)['"]/);
        const route = routeMatch ? `${routeMatch[1]} ${routeMatch[2]}` : 'API Route';

        items.push({
          title: route,
          content: this.extractRouteHandler(chunk.text),
          location: `${chunk.meta.path}${chunk.meta.startLine ? `:${chunk.meta.startLine}` : ''}`,
          confidence: chunk.score,
          signals: chunk.meta.signals || [],
        });
      });

    return {
      title: '🛣️ Protected Routes',
      items,
      description: 'API endpoints with authentication requirements',
    };
  }

  /**
   * Build DB/RLS section
   */
  private buildDbRlsSection(dataChunks: ScoredChunk[]): SystemMapSection {
    const items: SystemMapItem[] = [];

    // Look for RLS policies and database rules
    dataChunks
      .filter(chunk => /RLS|policy|auth\.uid|role|tenant/i.test(chunk.text))
      .slice(0, 5)
      .forEach(chunk => {
        const policyMatch = chunk.text.match(/policy\s+"([^"]+)"/);
        const policyName = policyMatch ? policyMatch[1] : 'Database Policy';

        items.push({
          title: policyName,
          content: this.extractPolicyContent(chunk.text),
          location: `${chunk.meta.path}${chunk.meta.startLine ? `:${chunk.meta.startLine}` : ''}`,
          confidence: chunk.score,
          signals: chunk.meta.signals || [],
        });
      });

    return {
      title: '🗄️ Database & RLS',
      items,
      description: 'Row Level Security policies and data access controls',
    };
  }

  /**
   * Build Config/Secrets section
   */
  private buildConfigSecretsSection(configChunks: ScoredChunk[]): SystemMapSection {
    const items: SystemMapItem[] = [];

    // Look for environment variables and configuration
    const envVars = new Set<string>();

    configChunks.forEach(chunk => {
      const envMatches = chunk.text.match(/process\.env\.([A-Z_]+)/g);
      if (envMatches) {
        envMatches.forEach((match: string) => {
          const varName = match.replace('process.env.', '');
          envVars.add(varName);
        });
      }
    });

    Array.from(envVars)
      .slice(0, 8)
      .forEach(envVar => {
        items.push({
          title: envVar,
          content: 'Environment variable used in authentication',
          location: 'Environment configuration',
        });
      });

    return {
      title: '⚙️ Configuration & Secrets',
      items,
      description: 'Required environment variables and configuration settings',
    };
  }

  /**
   * Build Key Files section
   */
  private buildKeyFilesSection(chunks: ScoredChunk[]): SystemMapSection {
    const items: SystemMapItem[] = [];

    // Select most relevant files based on score and facet diversity
    const fileMap = new Map<string, ScoredChunk>();

    chunks.forEach(chunk => {
      const filePath = chunk.meta.path;
      const existing = fileMap.get(filePath);

      if (!existing || chunk.score > existing.score) {
        fileMap.set(filePath, chunk);
      }
    });

    Array.from(fileMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .forEach(chunk => {
        items.push({
          title: chunk.meta.path.split('/').pop() || chunk.meta.path,
          content: this.extractFileSummary(chunk.text),
          location: `${chunk.meta.path}${chunk.meta.startLine ? `:${chunk.meta.startLine}-${chunk.meta.endLine || chunk.meta.startLine}` : ''}`,
          confidence: chunk.score,
          signals: chunk.meta.signals || [],
        });
      });

    return {
      title: '📄 Key Files',
      items,
      description: 'Most relevant source files with authentication logic',
    };
  }

  /**
   * Build Flow section with login → request → DB sequence
   */
  private buildFlowSection(chunks: ScoredChunk[], facets: string[]): SystemMapSection {
    const items: SystemMapItem[] = [];

    // Create a logical flow based on the query facets
    const flowSteps = [
      {
        title: '🔐 Login/Authentication',
        patterns: ['login', 'authenticate', 'verifyToken', 'signIn'],
        description: 'User authentication and token issuance',
      },
      {
        title: '📨 Request Processing',
        patterns: ['middleware', 'guard', 'handler', 'route'],
        description: 'Incoming request validation and processing',
      },
      {
        title: '🗄️ Database Access',
        patterns: ['query', 'select', 'insert', 'auth.uid', 'policy'],
        description: 'Database queries with user context',
      },
      {
        title: '📤 Response',
        patterns: ['return', 'response', 'send', 'json'],
        description: 'Response generation and delivery',
      },
    ];

    flowSteps.forEach(step => {
      const relevantChunks = chunks.filter(chunk =>
        step.patterns.some(pattern => chunk.text.toLowerCase().includes(pattern.toLowerCase()))
      );

      if (relevantChunks.length > 0) {
        const topChunk = relevantChunks[0];
        items.push({
          title: step.title,
          content: step.description,
          location: `${topChunk.meta.path}${topChunk.meta.startLine ? `:${topChunk.meta.startLine}` : ''}`,
          confidence: topChunk.score,
        });
      }
    });

    return {
      title: '🔄 Authentication Flow',
      items,
      description: 'End-to-end authentication and authorization flow',
    };
  }

  /**
   * Extract function signature from code
   */
  private extractFunctionSignature(text: string): string {
    const lines = text.split('\n');
    const funcLine = lines.find(
      line => /function|const|let|async|export/.test(line) && /\([^)]*\)/.test(line)
    );

    if (funcLine) {
      return funcLine.trim().replace(/\s+/g, ' ');
    }

    return lines[0]?.trim() || 'Function definition';
  }

  /**
   * Extract route handler summary
   */
  private extractRouteHandler(text: string): string {
    const lines = text.split('\n').slice(0, 3);
    return lines.join(' ').trim().replace(/\s+/g, ' ');
  }

  /**
   * Extract policy content
   */
  private extractPolicyContent(text: string): string {
    const lines = text.split('\n').slice(0, 2);
    return lines.join(' ').trim().replace(/\s+/g, ' ');
  }

  /**
   * Extract file summary
   */
  private extractFileSummary(text: string): string {
    const firstLine = text.split('\n')[0]?.trim();
    return firstLine ? firstLine.substring(0, 100) : 'Source file';
  }

  /**
   * Calculate coverage percentage
   */
  private calculateCoverage(chunks: ScoredChunk[]): number {
    if (chunks.length === 0) return 0;

    const uniqueFiles = new Set(chunks.map(c => c.meta.path));
    const totalFiles = chunks.length;

    return Math.min(1.0, uniqueFiles.size / Math.max(totalFiles, 1));
  }

  /**
   * Extract anchors that were hit
   */
  private extractAnchorsHit(chunks: ScoredChunk[]): string[] {
    const anchorsHit = new Set<string>();

    chunks.forEach(chunk => {
      if (chunk.meta.signals) {
        chunk.meta.signals.forEach((signal: string) => {
          if (
            signal.includes('verifyAuth') ||
            signal.includes('RLS') ||
            signal.includes('Authorization') ||
            signal.includes('auth.uid')
          ) {
            anchorsHit.add(signal);
          }
        });
      }
    });

    return Array.from(anchorsHit);
  }

  /**
   * Create fallback System Map for error cases
   */
  private createFallbackSystemMap(query: string): SystemMap {
    return {
      modalities: {
        title: '🔐 Authentication Modalities',
        items: [
          {
            title: 'Fallback Mode',
            content:
              'Using basic analysis - enable embedding-assisted mode for detailed System Map',
          },
        ],
        description: 'Authentication methods (limited analysis)',
      },
      middlewareGuards: {
        title: '🛡️ Middleware & Guards',
        items: [],
        description: 'Authentication middleware',
      },
      protectedRoutes: {
        title: '🛣️ Protected Routes',
        items: [],
        description: 'Protected API endpoints',
      },
      dbRls: {
        title: '🗄️ Database & RLS',
        items: [],
        description: 'Database security policies',
      },
      configSecrets: {
        title: '⚙️ Configuration & Secrets',
        items: [],
        description: 'Environment configuration',
      },
      keyFiles: {
        title: '📄 Key Files',
        items: [],
        description: 'Relevant source files',
      },
      flow: {
        title: '🔄 Authentication Flow',
        items: [],
        description: 'Request processing flow',
      },
      metadata: {
        queryFacets: ['fallback'],
        anchorsHit: [],
        coveragePct: 0,
        processingTimeMs: 0,
        totalChunksUsed: 0,
      },
    };
  }
}

// Export singleton instance
export const systemMapComposer = new SystemMapComposer();

// Helper function to format System Map as markdown
export function formatSystemMapAsMarkdown(systemMap: SystemMap): string {
  const sections: string[] = ['# 🗺️ System Architecture Map\n'];

  // Add query info
  sections.push(`**Query Focus:** ${systemMap.metadata.queryFacets.join(', ')}\n`);
  sections.push(
    `**Analysis Coverage:** ${Math.round(systemMap.metadata.coveragePct * 100)}% | **Anchors Hit:** ${systemMap.metadata.anchorsHit.length}\n`
  );

  // Add each section
  const sectionKeys: (keyof SystemMap)[] = [
    'modalities',
    'middlewareGuards',
    'protectedRoutes',
    'dbRls',
    'configSecrets',
    'keyFiles',
    'flow',
  ];

  sectionKeys.forEach(key => {
    const section = systemMap[key] as SystemMapSection;

    sections.push(`## ${section.title}\n`);

    if (section.description) {
      sections.push(`${section.description}\n`);
    }

    if (section.items.length > 0) {
      section.items.forEach(item => {
        sections.push(`### ${item.title}`);
        sections.push(`${item.content}`);

        if (item.location) {
          sections.push(`📍 **Location:** ${item.location}`);
        }

        if (item.confidence) {
          sections.push(`🎯 **Confidence:** ${item.confidence.toFixed(3)}`);
        }

        if (item.signals && item.signals.length > 0) {
          sections.push(`🔗 **Signals:** ${item.signals.join(', ')}`);
        }

        sections.push('');
      });
    } else {
      sections.push('_No relevant items found_\n');
    }
  });

  return sections.join('\n');
}
