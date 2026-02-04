/**
 * @fileOverview: AI-powered debug analysis tool
 * @module: AIDebug
 * @keyFunctions:
 *   - aiDebugTool: Tool definition for AI-powered debug analysis
 *   - handleAIDebug(): Handler for analyzing debug context and providing fix suggestions
 * @context: Provides intelligent debug analysis using AI to suggest fixes, root causes, and preventive measures
 */

import { logger } from '../../utils/logger';
import { createOpenAIService, OpenAIService, ProviderType } from '../../core/openaiService';
import { DebugContextReport } from './localDebugContext';

/**
 * Tool definition for AI Debug Analysis
 */
export const aiDebugTool = {
  name: 'ai_debug',
  description: `🤖 AI-powered debug analysis and fix suggestions

**When to use**:
- After gathering debug context with local_debug_context tool
- When you need intelligent analysis of complex error patterns
- When you want specific fix suggestions and root cause analysis
- When debugging issues that require understanding code relationships

**What this does**:
- Analyzes debug context using AI to understand error patterns
- Provides specific fix suggestions with code examples
- Identifies root causes and contributing factors
- Suggests preventive measures and code improvements
- Prioritizes fixes by impact and effort

**Input**: Debug context report from local_debug_context tool
**Output**: Comprehensive debug analysis with actionable fix suggestions

**Requirements**: Requires OPENAI_API_KEY environment variable
**Performance**: ~3-10 seconds depending on context complexity`,
  inputSchema: {
    type: 'object',
    properties: {
      debugContext: {
        type: 'object',
        description: 'Debug context report from local_debug_context tool',
        properties: {
          errors: {
            type: 'array',
            description: 'Parsed errors from log analysis',
          },
          matches: {
            type: 'array',
            description: 'Ranked symbol matches from codebase',
          },
          summary: {
            type: 'object',
            description: 'Summary statistics',
          },
        },
        required: ['errors', 'matches'],
      },
      analysisType: {
        type: 'string',
        enum: ['comprehensive', 'quick_fix', 'root_cause', 'prevention'],
        default: 'comprehensive',
        description: 'Type of analysis to perform',
      },
      includeCodeExamples: {
        type: 'boolean',
        default: true,
        description: 'Whether to include specific code examples in suggestions',
      },
      maxSuggestions: {
        type: 'number',
        default: 5,
        minimum: 1,
        maximum: 10,
        description: 'Maximum number of fix suggestions to provide',
      },
    },
    required: ['debugContext'],
  },
};

interface DebugAnalysis {
  summary: {
    primaryIssue: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    affectedFiles: string[];
  };
  rootCause: {
    description: string;
    contributingFactors: string[];
    codePatterns: string[];
  };
  fixSuggestions: Array<{
    priority: number;
    title: string;
    description: string;
    effort: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
    codeExample?: string;
    filesToModify: string[];
  }>;
  prevention: {
    bestPractices: string[];
    toolingSuggestions: string[];
    testingStrategies: string[];
  };
  nextSteps: string[];
}

/**
 * Create AI analysis prompt based on debug context and analysis type
 */
function createDebugAnalysisPrompt(
  debugContext: DebugContextReport,
  analysisType: string,
  includeCodeExamples: boolean,
  maxSuggestions: number
): string {
  const errorSummary = debugContext.errors
    .map(e => `${e.errorType || 'Error'} in ${e.filePath}:${e.line} - ${e.raw}`)
    .join('\\n');

  const topMatches = debugContext.matches
    .slice(0, 8)
    .map(
      m =>
        `Symbol: ${m.symbol} in ${m.filePath}:${m.line} (score: ${m.score})\\nContext:\\n${m.context}\\n`
    )
    .join('\\n---\\n');

  const analysisInstructions = {
    comprehensive:
      'Provide a complete analysis including root cause, fix suggestions, and prevention strategies.',
    quick_fix: 'Focus on immediate fixes that can resolve the issue quickly.',
    root_cause: 'Focus on identifying the underlying root cause and systemic issues.',
    prevention: 'Focus on preventive measures and best practices to avoid similar issues.',
  };

  return `You are an expert software debugger analyzing a codebase error. Based on the debug context below, provide a comprehensive analysis and fix suggestions.

## Error Summary
${errorSummary}

## Code Context (Top Matches)
${topMatches}

## Analysis Request
Type: ${analysisType}
Instructions: ${analysisInstructions[analysisType as keyof typeof analysisInstructions]}
Include code examples: ${includeCodeExamples}
Max suggestions: ${maxSuggestions}

## Analysis Framework
Please analyze this debugging context and provide a structured response in the following JSON format:

{
  "summary": {
    "primaryIssue": "Brief description of the main issue",
    "severity": "low|medium|high|critical",
    "confidence": 0.0-1.0,
    "affectedFiles": ["file1.ts", "file2.ts"]
  },
  "rootCause": {
    "description": "Detailed explanation of why this error occurs",
    "contributingFactors": ["factor1", "factor2"],
    "codePatterns": ["pattern1", "pattern2"]
  },
  "fixSuggestions": [
    {
      "priority": 1,
      "title": "Fix title",
      "description": "Detailed fix description",
      "effort": "low|medium|high",
      "impact": "low|medium|high", 
      "codeExample": "// Example code if requested",
      "filesToModify": ["file1.ts"]
    }
  ],
  "prevention": {
    "bestPractices": ["practice1", "practice2"],
    "toolingSuggestions": ["tool1", "tool2"],
    "testingStrategies": ["strategy1", "strategy2"]
  },
  "nextSteps": ["step1", "step2", "step3"]
}

## Analysis Guidelines
1. **Root Cause**: Look for patterns in the error context that reveal the underlying issue
2. **Fix Priority**: Order fixes by impact vs effort (high impact, low effort first)
3. **Code Examples**: ${includeCodeExamples ? 'Provide specific, actionable code examples' : 'Focus on conceptual fixes without code examples'}
4. **Prevention**: Suggest practices that would have prevented this issue
5. **Confidence**: Base confidence on clarity of error context and code patterns

Focus on providing actionable, specific guidance that developers can immediately implement.`;
}

/**
 * Main handler for AI debug analysis
 */
export async function handleAIDebug(args: any): Promise<DebugAnalysis> {
  const {
    debugContext,
    analysisType = 'comprehensive',
    includeCodeExamples = true,
    maxSuggestions = 5,
  } = args;

  if (!debugContext || typeof debugContext !== 'object') {
    throw new Error(
      '❌ debugContext is required and must be a debug context report object from local_debug_context tool.'
    );
  }

  if (!debugContext.errors || !debugContext.matches) {
    throw new Error('❌ Invalid debug context format. Must contain errors and matches arrays.');
  }

  // Check if OpenAI API key is available
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('❌ OPENAI_API_KEY environment variable is required for AI debug analysis.');
  }

  logger.info('🤖 Starting AI debug analysis', {
    errorCount: debugContext.errors.length,
    matchCount: debugContext.matches.length,
    analysisType,
    includeCodeExamples,
    maxSuggestions,
  });

  try {
    // Initialize OpenAI service
    const openai = createOpenAIService({
      apiKey,
      provider: detectProvider(apiKey),
      model: process.env.OPENAI_BASE_MODEL,
      miniModel: process.env.OPENAI_MINI_MODEL,
    });

    // Create analysis prompt
    const prompt = createDebugAnalysisPrompt(
      debugContext,
      analysisType,
      includeCodeExamples,
      maxSuggestions
    );

    // Use appropriate model for the analysis task
    const model = openai.getModelForTask('base');

    // Get AI analysis
    const response = await openai.createChatCompletion({
      model: model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert software debugger who provides clear, actionable analysis and fix suggestions. Always respond with valid JSON matching the requested format.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1, // Low temperature for consistent, focused analysis
    });

    const responseContent = response.choices[0].message.content;
    if (!responseContent) {
      throw new Error('Empty response from AI service');
    }

    // Parse AI response
    let analysis: DebugAnalysis;
    try {
      analysis = JSON.parse(responseContent);
    } catch (parseError) {
      logger.warn('⚠️ Failed to parse AI response as JSON, attempting to extract JSON');

      // Try to extract JSON from response if it's wrapped in text
      const jsonMatch = responseContent.match(/\\{[\\s\\S]*\\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI response as valid JSON');
      }
    }

    // Validate analysis structure
    if (!analysis.summary || !analysis.rootCause || !analysis.fixSuggestions) {
      throw new Error('AI response missing required analysis sections');
    }

    logger.info('✅ AI debug analysis completed', {
      primaryIssue: analysis.summary.primaryIssue,
      severity: analysis.summary.severity,
      confidence: analysis.summary.confidence,
      fixCount: analysis.fixSuggestions.length,
    });

    return analysis;
  } catch (error) {
    logger.error('❌ AI debug analysis failed', {
      error: (error as Error).message,
    });
    throw new Error(`AI debug analysis failed: ${(error as Error).message}`);
  }
}

/**
 * Detect AI provider based on API key format
 */
function detectProvider(apiKey: string): ProviderType {
  if (apiKey.startsWith('sk-')) {
    return 'openai';
  } else if (apiKey.startsWith('qwen-') || process.env.OPENAI_BASE_URL?.includes('dashscope')) {
    return 'qwen';
  } else if (process.env.AZURE_OPENAI_ENDPOINT) {
    return 'azure';
  } else {
    return 'custom' as ProviderType;
  }
}
