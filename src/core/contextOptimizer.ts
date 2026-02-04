/**
 * @fileOverview: Intelligent context optimization using AI to analyze queries and gather relevant context
 * @module: ContextOptimizer
 * @keyFunctions:
 *   - optimizeContext(): Main entry point for intelligent context optimization
 *   - analyzeContextNeeds(): Use AI to determine what context is needed
 *   - gatherMissingContext(): Recursively collect required context based on analysis
 *   - structureOptimalPrompt(): Create research-backed prompt structure
 * @dependencies:
 *   - OpenAIService: Unified AI service for different providers
 *   - SemanticCompactor: Code compression and analysis
 *   - AutomaticIndexer: Local project indexing
 *   - logger: Logging utilities
 * @context: Key differentiator that uses AI to curate and structure context based on latest prompt engineering research instead of dumping raw code
 */

import { logger } from '../utils/logger';
import { SemanticCompactor } from './compactor/semanticCompactor';
import { AutomaticIndexer } from '../local/automaticIndexer';
import { createOpenAIService, OpenAIService } from './openaiService';

interface ContextNeed {
  type:
    | 'symbol_definition'
    | 'usage_examples'
    | 'dependency_flow'
    | 'test_examples'
    | 'related_files'
    | 'error_context'
    | 'implementation_details';
  priority: 'critical' | 'important' | 'optional';
  description: string;
  symbol?: string;
  pattern?: string;
  from?: string;
  to?: string;
  component?: string;
}

interface OptimizationAnalysis {
  taskType: string;
  missingContext: ContextNeed[];
  tokenBudgetAllocation: {
    overview: number;
    coreContext: number;
    examples: number;
    dependencies: number;
    buffer: number;
  };
  structuralRecommendations: string[];
}

interface ContextSection {
  type: 'overview' | 'core_code' | 'examples' | 'dependencies' | 'tests' | 'documentation';
  priority: number;
  content: string;
  tokens: number;
  metadata: Record<string, any>;
}

/**
 * Intelligent context optimizer using AI to analyze queries and recursively
 * gather the most relevant context for optimal model performance.
 *
 * This is the key differentiator - instead of dumping raw code, we use AI
 * to curate and structure context based on latest prompt engineering research.
 */
export class ContextOptimizer {
  private openai: OpenAIService;
  private compactor: SemanticCompactor;
  private indexer: AutomaticIndexer;

  constructor() {
    // Initialize OpenAI service with environment-based configuration
    this.openai = createOpenAIService({
      apiKey: process.env.OPENAI_API_KEY || '',
      provider: this.detectProvider(),
      model: process.env.OPENAI_BASE_MODEL,
      miniModel: process.env.OPENAI_MINI_MODEL,
    });

    this.compactor = new SemanticCompactor(process.cwd());
    this.indexer = AutomaticIndexer.getInstance();
  }

  /**
   * Detect provider based on environment variables and API key
   */
  private detectProvider(): any {
    const apiKey = process.env.OPENAI_API_KEY || '';

    if (apiKey.startsWith('sk-')) {
      return 'openai';
    } else if (apiKey.startsWith('qwen-') || process.env.OPENAI_BASE_URL?.includes('dashscope')) {
      return 'qwen';
    } else if (process.env.AZURE_OPENAI_ENDPOINT) {
      return 'azure';
    } else {
      // Default to custom if no specific provider detected
      return 'custom';
    }
  }

  /**
   * Main optimization entry point - analyzes query and builds optimal context
   */
  async optimizeContext(
    query: string,
    taskType: string = 'understand',
    maxTokens: number = 8000,
    projectPath: string = process.cwd()
  ): Promise<string> {
    logger.info('🧠 Starting intelligent context optimization', {
      query: query.substring(0, 100),
      taskType,
      maxTokens,
    });

    try {
      // Step 1: Get initial project context
      const initialContext = await this.gatherInitialContext(projectPath);

      // Step 2: Analyze what's needed using AI
      const analysis = await this.analyzeContextNeeds(query, taskType, initialContext);

      // Step 3: Recursively gather missing context
      const enrichedContext = await this.gatherMissingContext(
        analysis,
        initialContext,
        projectPath
      );

      // Step 4: Structure optimal prompt using research-backed techniques
      const optimizedPrompt = await this.structureOptimalPrompt(
        query,
        taskType,
        enrichedContext,
        analysis,
        maxTokens
      );

      logger.info('✅ Context optimization completed', {
        finalTokens: this.estimateTokens(optimizedPrompt),
        sectionsIncluded: enrichedContext.length,
      });

      return optimizedPrompt;
    } catch (error) {
      logger.error('❌ Context optimization failed:', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback to basic context
      return this.getFallbackContext(query, projectPath);
    }
  }

  /**
   * Analyze what context is needed using AI
   */
  private async analyzeContextNeeds(
    query: string,
    taskType: string,
    initialContext: any
  ): Promise<OptimizationAnalysis> {
    // Task-specific analysis approaches
    const taskSpecificInstructions = {
      understand: `For UNDERSTANDING tasks, prioritize:
- Comprehensive architectural context
- Well-documented symbols with clear explanations
- Component relationships and data flow
- Thorough overview sections with deeper explanations
- More generous token allocation for thorough analysis`,

      implement: `For IMPLEMENTATION tasks, prioritize:
- Specific entry points and modifiable code sections
- Concrete examples and implementation patterns
- Clear action items and next steps
- Focused token allocation on actionable content
- Practical code examples over explanations`,

      debug: `For DEBUGGING tasks, prioritize:
- Error handling and exception patterns
- Testing examples and validation code
- Problem-specific context and edge cases
- Diagnostic information and logging
- Issue reproduction and solution patterns`,
    };

    const taskInstruction =
      taskSpecificInstructions[taskType as keyof typeof taskSpecificInstructions] ||
      taskSpecificInstructions.implement;

    const analysisPrompt = `You are an expert at analyzing coding queries to determine what context an AI model needs to provide the best answer.

QUERY: "${query}"
TASK TYPE: ${taskType}

AVAILABLE CONTEXT OVERVIEW:
- Files: ${initialContext.files?.length || 0}
- Symbols: ${initialContext.symbols?.length || 0}  
- Key patterns: ${initialContext.patterns?.join(', ') || 'none'}

${taskInstruction}

Based on latest research on AI model performance, analyze what SPECIFIC context this query needs.

Consider these context types and their importance for ${taskType} tasks:
- symbol_definition: Function/class definitions and their signatures
- usage_examples: Real usage patterns and examples
- dependency_flow: How components connect and data flows
- test_examples: Related tests that show expected behavior  
- related_files: Files that interact with the target code
- error_context: Error handling and edge cases
- implementation_details: Internal logic and algorithms

Respond in JSON format:
{
  "taskType": "${taskType}",
  "missingContext": [
    {
      "type": "symbol_definition",
      "priority": "critical",
      "description": "Need definition of X function",
      "symbol": "functionName"
    }
  ],
  "tokenBudgetAllocation": {
    "overview": 500,
    "coreContext": 4000,
    "examples": 2000, 
    "dependencies": 1000,
    "buffer": 500
  },
  "structuralRecommendations": [
    "Start with high-level overview",
    "Show concrete examples before abstract concepts"
  ]
}`;

    // Use appropriate model based on task complexity
    const model = this.openai.getModelForTask('mini');

    const response = await this.openai.createChatCompletion({
      model: model,
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 1.0,
    });

    try {
      const analysis = JSON.parse(response.choices[0].message.content || '{}');
      logger.info('📊 Context analysis completed', {
        missingContextItems: analysis.missingContext?.length || 0,
        totalBudget: Object.values(analysis.tokenBudgetAllocation || {}).reduce(
          (a: number, b: any) => a + (b as number),
          0
        ),
      });
      return analysis;
    } catch (parseError) {
      logger.warn('⚠️ Failed to parse analysis, using defaults');
      return this.getDefaultAnalysis(taskType);
    }
  }

  /**
   * Recursively gather missing context based on analysis
   */
  private async gatherMissingContext(
    analysis: OptimizationAnalysis,
    initialContext: any,
    projectPath: string
  ): Promise<ContextSection[]> {
    const sections: ContextSection[] = [];

    // Start with overview section
    sections.push({
      type: 'overview',
      priority: 1,
      content: await this.generateProjectOverview(initialContext),
      tokens: analysis.tokenBudgetAllocation.overview,
      metadata: { source: 'project_analysis' },
    });

    // Gather context for each identified need
    for (const need of analysis.missingContext) {
      try {
        const contextSection = await this.gatherContextForNeed(need, projectPath);
        if (contextSection) {
          sections.push(contextSection);
        }
      } catch (error) {
        logger.warn(`⚠️ Failed to gather context for ${need.type}:`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Sort by priority and fit within token budget
    return this.prioritizeAndTrimSections(sections, analysis.tokenBudgetAllocation);
  }

  /**
   * Gather specific context based on identified need
   */
  private async gatherContextForNeed(
    need: ContextNeed,
    projectPath: string
  ): Promise<ContextSection | null> {
    switch (need.type) {
      case 'symbol_definition':
        return await this.getSymbolDefinition(need.symbol!, projectPath);

      case 'usage_examples':
        return await this.getUsageExamples(need.pattern!, projectPath);

      case 'dependency_flow':
        return await this.getDependencyFlow(need.from!, need.to, projectPath);

      case 'test_examples':
        return await this.getTestExamples(need.component!, projectPath);

      case 'related_files':
        return await this.getRelatedFiles(need.pattern!, projectPath);

      case 'error_context':
        return await this.getErrorContext(need.pattern!, projectPath);

      case 'implementation_details':
        return await this.getImplementationDetails(need.symbol!, projectPath);

      default:
        logger.warn(`Unknown context need type: ${need.type}`);
        return null;
    }
  }

  /**
   * Structure the final optimal prompt using research-backed techniques
   */
  private async structureOptimalPrompt(
    query: string,
    taskType: string,
    sections: ContextSection[],
    analysis: OptimizationAnalysis,
    maxTokens: number
  ): Promise<string> {
    const structuringPrompt = `You are an expert at structuring code context for optimal AI model performance.

ORIGINAL QUERY: "${query}"
TASK TYPE: ${taskType}

CONTEXT SECTIONS TO STRUCTURE:
${sections.map((s, i) => `${i + 1}. ${s.type} (${s.tokens} tokens): ${s.content.substring(0, 200)}...`).join('\n')}

STRUCTURAL RECOMMENDATIONS:
${analysis.structuralRecommendations.join('\n')}

Structure this into the optimal prompt format based on latest research:
- Use hierarchical organization (overview → specifics → examples)
- Include explicit relationships between components
- Frame for ${taskType} task specifically
- Optimize token efficiency with semantic compression
- Include relevant examples inline with explanations

The final prompt should be ready for an AI model to provide the best possible response to: "${query}"

TOKEN BUDGET: ${maxTokens}`;

    // Use appropriate model based on task complexity
    const model = this.openai.getModelForTask('mini');

    const response = await this.openai.createChatCompletion({
      model: model,
      messages: [{ role: 'user', content: structuringPrompt }],
      temperature: 1.0,
    });

    return response.choices[0].message.content || this.buildFallbackStructure(query, sections);
  }

  // Helper methods for gathering specific context types

  private async getSymbolDefinition(symbol: string, projectPath: string): Promise<ContextSection> {
    // Use semantic compactor to find and extract symbol definition
    const results = await this.compactor.findSymbolContext(symbol, projectPath);
    return {
      type: 'core_code',
      priority: 10,
      content: results.definition + '\n\n' + results.documentation,
      tokens: this.estimateTokens(results.definition),
      metadata: { symbol, source: 'ast_analysis' },
    };
  }

  private async getUsageExamples(pattern: string, projectPath: string): Promise<ContextSection> {
    const examples = await this.compactor.findUsagePatterns(pattern, projectPath, { limit: 3 });
    return {
      type: 'examples',
      priority: 8,
      content: examples.map((ex: any) => `// Example usage:\n${ex.code}\n`).join('\n'),
      tokens: this.estimateTokens(examples.map((ex: any) => ex.code).join('\n')),
      metadata: { pattern, examples: examples.length },
    };
  }

  private async getDependencyFlow(
    from: string,
    to: string | undefined,
    projectPath: string
  ): Promise<ContextSection> {
    const flow = await this.compactor.traceDependencyFlow(from, to, projectPath);
    return {
      type: 'dependencies',
      priority: 6,
      content: `Dependency flow from ${from}${to ? ` to ${to}` : ''}:\n${flow.description}`,
      tokens: this.estimateTokens(flow.description),
      metadata: { from, to, steps: flow.steps },
    };
  }

  private async getTestExamples(component: string, projectPath: string): Promise<ContextSection> {
    const tests = await this.compactor.findRelatedTests(component, projectPath);
    return {
      type: 'tests',
      priority: 7,
      content: tests.map((test: any) => `// Test: ${test.name}\n${test.code}`).join('\n\n'),
      tokens: this.estimateTokens(tests.map((t: any) => t.code).join('\n')),
      metadata: { component, testCount: tests.length },
    };
  }

  private async getRelatedFiles(pattern: string, projectPath: string): Promise<ContextSection> {
    const files = await this.compactor.findRelatedFiles(pattern, projectPath);
    const summaries = await Promise.all(
      files.slice(0, 3).map((f: any) => this.compactor.generateFileSummary(f.path, 'understand'))
    );

    return {
      type: 'core_code',
      priority: 5,
      content: summaries
        .map((s: any) => `// File: ${s.filePath}\n${s.summary}\n\n${s.keySymbols}`)
        .join('\n'),
      tokens: summaries.reduce((acc: number, s: any) => acc + this.estimateTokens(s.summary), 0),
      metadata: { pattern, fileCount: files.length },
    };
  }

  private async getErrorContext(pattern: string, projectPath: string): Promise<ContextSection> {
    const errorHandling = await this.compactor.findErrorHandling(pattern, projectPath);
    return {
      type: 'core_code',
      priority: 9,
      content: `Error handling for ${pattern}:\n${errorHandling.code}\n\n// Common error cases:\n${errorHandling.cases.join('\n')}`,
      tokens: this.estimateTokens(errorHandling.code + errorHandling.cases.join('\n')),
      metadata: { pattern, errorTypes: errorHandling.types },
    };
  }

  private async getImplementationDetails(
    symbol: string,
    projectPath: string
  ): Promise<ContextSection> {
    const details = await this.compactor.getImplementationDetails(symbol, projectPath);
    return {
      type: 'core_code',
      priority: 8,
      content: `Implementation of ${symbol}:\n${details.code}\n\n// Key algorithms:\n${details.algorithms.join('\n')}`,
      tokens: this.estimateTokens(details.code),
      metadata: { symbol, complexity: details.complexity },
    };
  }

  // Utility methods

  private async gatherInitialContext(projectPath: string): Promise<any> {
    // Use existing tools to get project overview
    const compactorResult = await this.compactor.compactProject(projectPath, {
      maxTokens: 2000,
      includeTests: false,
      taskType: 'overview',
    });

    return {
      files: compactorResult.files,
      symbols: compactorResult.symbols,
      patterns: compactorResult.patterns,
    };
  }

  private async generateProjectOverview(context: any): Promise<string> {
    return `Project Overview:
- ${context.files?.length || 0} source files analyzed
- Key components: ${context.symbols?.slice(0, 5).join(', ') || 'none'}  
- Architecture patterns: ${context.patterns?.join(', ') || 'standard'}

This codebase appears to be a ${this.inferProjectType(context)} project.`;
  }

  private prioritizeAndTrimSections(sections: ContextSection[], budget: any): ContextSection[] {
    // Sort by priority (higher is more important)
    const sorted = sections.sort((a, b) => b.priority - a.priority);

    // Trim to fit budget
    let totalTokens = 0;
    const maxTokens = Object.values(budget).reduce((a: number, b: any) => a + (b as number), 0);

    return sorted.filter(section => {
      if (totalTokens + section.tokens <= maxTokens) {
        totalTokens += section.tokens;
        return true;
      }
      return false;
    });
  }

  private getDefaultAnalysis(taskType: string): OptimizationAnalysis {
    // Task-specific default configurations
    const defaultConfigs = {
      understand: {
        missingContext: [
          {
            type: 'symbol_definition' as const,
            priority: 'critical' as const,
            description: 'Need comprehensive symbol definitions with documentation',
          },
          {
            type: 'dependency_flow' as const,
            priority: 'important' as const,
            description: 'Need component relationships and architecture overview',
          },
          {
            type: 'related_files' as const,
            priority: 'important' as const,
            description: 'Need related files for complete context',
          },
        ],
        tokenBudgetAllocation: {
          overview: 1200, // More comprehensive overview
          coreContext: 4500, // More detailed code context
          examples: 1500, // Moderate examples
          dependencies: 1200, // More dependency context
          buffer: 600,
        },
        structuralRecommendations: [
          'Start with comprehensive overview and architecture explanation',
          'Include detailed component relationships',
          'Provide thorough explanations of key concepts',
          'Focus on building complete mental models',
        ],
      },

      implement: {
        missingContext: [
          {
            type: 'symbol_definition' as const,
            priority: 'critical' as const,
            description: 'Need specific entry points and modifiable code',
          },
          {
            type: 'usage_examples' as const,
            priority: 'critical' as const,
            description: 'Need concrete implementation examples',
          },
          {
            type: 'implementation_details' as const,
            priority: 'important' as const,
            description: 'Need specific implementation patterns',
          },
        ],
        tokenBudgetAllocation: {
          overview: 600, // Concise overview
          coreContext: 3500, // Focused code context
          examples: 2500, // More examples for implementation
          dependencies: 800, // Focused dependencies
          buffer: 600,
        },
        structuralRecommendations: [
          'Start with actionable overview',
          'Focus on concrete implementation steps',
          'Include specific code examples and patterns',
          'Prioritize immediate next actions',
        ],
      },

      debug: {
        missingContext: [
          {
            type: 'error_context' as const,
            priority: 'critical' as const,
            description: 'Need error handling and edge cases',
          },
          {
            type: 'test_examples' as const,
            priority: 'important' as const,
            description: 'Need test cases and validation examples',
          },
          {
            type: 'symbol_definition' as const,
            priority: 'important' as const,
            description: 'Need problematic code definitions',
          },
        ],
        tokenBudgetAllocation: {
          overview: 700,
          coreContext: 3800,
          examples: 2000,
          dependencies: 900,
          buffer: 600,
        },
        structuralRecommendations: [
          'Start with error analysis and problem identification',
          'Include debugging strategies and diagnostic steps',
          'Focus on systematic problem-solving approach',
          'Provide concrete fixes and validation steps',
        ],
      },
    };

    const config =
      defaultConfigs[taskType as keyof typeof defaultConfigs] || defaultConfigs.implement;

    return {
      taskType,
      missingContext: config.missingContext,
      tokenBudgetAllocation: config.tokenBudgetAllocation,
      structuralRecommendations: config.structuralRecommendations,
    };
  }

  private buildFallbackStructure(query: string, sections: ContextSection[]): string {
    return `# Context for: ${query}

## Overview
${sections.find(s => s.type === 'overview')?.content || 'Project context'}

## Core Code
${sections
  .filter(s => s.type === 'core_code')
  .map(s => s.content)
  .join('\n\n')}

## Examples  
${sections
  .filter(s => s.type === 'examples')
  .map(s => s.content)
  .join('\n\n')}

## Dependencies
${sections
  .filter(s => s.type === 'dependencies')
  .map(s => s.content)
  .join('\n\n')}`;
  }

  private async getFallbackContext(query: string, projectPath: string): Promise<string> {
    // Simple fallback using existing compactor
    const result = await this.compactor.compactProject(projectPath, {
      maxTokens: 6000,
      taskType: 'understand',
    });

    return `# Context for: ${query}\n\n${result.compactedContent}`;
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private inferProjectType(context: any): string {
    const patterns = context.patterns || [];
    if (patterns.includes('react')) return 'React';
    if (patterns.includes('express')) return 'Express.js';
    if (patterns.includes('fastify')) return 'Fastify';
    return 'JavaScript/TypeScript';
  }
}
