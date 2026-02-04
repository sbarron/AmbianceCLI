/**
 * Mock API server for integration testing
 * Simulates Ambiance API endpoints for testing
 */

import express from 'express';
import { Server } from 'http';

export interface MockApiConfig {
  port: number;
  validKeys: string[];
  simulateErrors?: boolean;
}

export class MockApiServer {
  private app: express.Application;
  private server: Server | null = null;
  private config: MockApiConfig;

  constructor(config: MockApiConfig) {
    this.config = config;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes() {
    this.app.use(express.json());

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No authorization header' });
      }

      const token = authHeader.replace('Bearer ', '');
      if (this.config.validKeys.includes(token)) {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
      } else {
        res.status(401).json({ error: 'Invalid API key' });
      }
    });

    // Embeddings endpoint
    this.app.post('/embeddings/generate', (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No authorization header' });
      }

      const token = authHeader.replace('Bearer ', '');
      if (!this.config.validKeys.includes(token)) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      if (this.config.simulateErrors) {
        return res.status(500).json({ error: 'Simulated server error' });
      }

      const { texts, input_type, model } = req.body;
      const dimensions = model === (process.env.VOYAGEAI_MODEL || 'voyageai-model') ? 1024 : 768;

      // Generate mock embeddings
      const embeddings = texts.map(() =>
        Array.from({ length: dimensions }, () => Math.random() - 0.5)
      );

      res.json({
        embeddings,
        model: model || process.env.VOYAGEAI_MODEL || 'voyageai-model',
        dimensions,
        input_type: input_type || 'document',
        encoding_format: 'float32',
        total_tokens: texts.join(' ').split(' ').length,
        processing_time_ms: Math.floor(Math.random() * 100) + 50,
        provider: 'voyageai',
      });
    });

    // Context search endpoint
    this.app.post('/v1/context/search', (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No authorization header' });
      }

      const token = authHeader.replace('Bearer ', '');
      if (!this.config.validKeys.includes(token)) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      if (this.config.simulateErrors) {
        return res.status(500).json({ error: 'Simulated server error' });
      }

      res.json([
        {
          id: 'test-result-1',
          body: 'This is a test search result',
          source: 'cloud',
          meta: {
            language: 'typescript',
            path: 'src/test.ts',
            startLine: 1,
            endLine: 10,
          },
          score: 0.95,
          path: 'src/test.ts',
          startLine: 1,
          endLine: 10,
        },
      ]);
    });

    // Context bundle endpoint
    this.app.post('/v1/context/bundle', (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No authorization header' });
      }

      const token = authHeader.replace('Bearer ', '');
      if (!this.config.validKeys.includes(token)) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      if (this.config.simulateErrors) {
        return res.status(500).json({ error: 'Simulated server error' });
      }

      res.json({
        snippets: [
          {
            id: 'test-snippet-1',
            body: 'Test code snippet',
            source: 'cloud',
            meta: {
              language: 'typescript',
              path: 'src/test.ts',
              startLine: 1,
              endLine: 10,
            },
            score: 0.9,
            path: 'src/test.ts',
            startLine: 1,
            endLine: 10,
          },
        ],
        budget: {
          requested: 4000,
          used: 150,
          remaining: 3850,
        },
        metadata: {
          query: req.body.query || 'test query',
          repos: ['test-repo'],
          timestamp: new Date().toISOString(),
        },
      });
    });
  }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, 'localhost', () => {
          const address = `http://localhost:${this.config.port}`;
          resolve(address);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise(resolve => {
      if (this.server) {
        this.server.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getBaseUrl(): string {
    return `http://localhost:${this.config.port}`;
  }
}
