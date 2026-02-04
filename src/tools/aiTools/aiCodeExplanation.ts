/**
 * @fileOverview: AI-Powered Code Explanation Tool
 * @module: AICodeExplanation
 * @keyFunctions:
 *   - aiCodeExplanationTool: Tool definition for code explanation
 *   - handleAICodeExplanation: Handler with natural language explanations
 * @dependencies:
 *   - OpenAIService: Direct OpenAI API integration
 *   - SemanticCompactor: Project context analysis
 * @context: Provides detailed explanations of complex code sections with context awareness
 */

import { SemanticCompactor } from '../../core/compactor/semanticCompactor';
import { validateAndResolvePath } from '../utils/pathUtils';
import { logger } from '../../utils/logger';
import { getOpenAIService } from './aiSemanticCompact';
import {
  createExplanationSystemPrompt,
  createExplanationUserPrompt,
} from './prompts/explanationPrompts';
import { getLanguageFromPath } from './utils/languageUtils';
import { buildApiRequest } from './utils/tokenUtils';
import * as path from 'path';

export const aiCodeExplanationTool = {
  name: 'ai_code_explanation',
  description: `📚 AI-POWERED CODE EXPLANATION AND DOCUMENTATION

Accepts absolute paths or relative paths (when workspace can be detected).

**When to use**:
- When you need detailed explanations of complex code sections
- For generating documentation for existing code
- When onboarding new developers to understand codebase architecture
- For code review and knowledge transfer

**Features**:
- Natural language explanations of code functionality
- Architecture pattern identification
- Dependency relationship analysis
- Best practices and improvement suggestions
- Context-aware explanations based on surrounding code

**Performance**: 10-60 seconds depending on code complexity, model type, and context size (configurable via AI_CODE_EXPLANATION_TIMEOUT_MS)`,
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Code snippet to explain (required if no filePath provided)',
      },
      filePath: {
        type: 'string',
        description: 'File path to explain. Can be absolute or relative to workspace.',
      },
      projectPath: {
        type: 'string',
        description: 'Project directory path. Can be absolute or relative to workspace.',
      },
      focus: {
        type: 'string',
        description:
          'Specific aspect to focus on (e.g., "error handling", "performance", "security")',
      },
      audience: {
        type: 'string',
        enum: ['beginner', 'intermediate', 'expert'],
        default: 'intermediate',
        description: 'Target audience for explanation complexity',
      },
      includeImprovement: {
        type: 'boolean',
        default: true,
        description: 'Include suggestions for improvement',
      },
      language: {
        type: 'string',
        description: 'Programming language (auto-detected if not provided)',
      },
    },
  },
};

export async function handleAICodeExplanation(args: any): Promise<any> {
  const startTime = Date.now();
  let baseTimeoutMs = 60000; // Default value

  try {
    const {
      code,
      filePath,
      projectPath,
      focus,
      audience = 'intermediate',
      includeImprovement = true,
      language,
    } = args;

    if (!code && !filePath) {
      return {
        success: false,
        error: 'Either code or filePath must be provided',
        duration: Date.now() - startTime,
      };
    }

    // Validate absolute paths if provided
    let validatedFilePath: string | undefined;
    let validatedProjectPath: string | undefined;

    if (filePath) {
      validatedFilePath = validateAndResolvePath(filePath);
    }

    if (projectPath) {
      validatedProjectPath = validateAndResolvePath(projectPath);
    }

    logger.info('Starting AI code explanation', {
      hasCode: !!code,
      filePath,
      focus,
      audience,
    });

    const openai = getOpenAIService();

    // Get code content
    let codeContent = code;
    let detectedLanguage = language;

    if (filePath) {
      const fs = await import('fs');
      const fullPath = validatedFilePath || path.resolve(validatedProjectPath || '.', filePath);
      codeContent = fs.readFileSync(fullPath, 'utf8');
      detectedLanguage = language || getLanguageFromPath(filePath);
    }

    // Get project context if available
    let projectContext = '';
    if (validatedProjectPath) {
      try {
        const compactor = new SemanticCompactor(validatedProjectPath);
        const compactedProject = await compactor.compact();
        projectContext = `Project Overview: ${compactedProject.summary.architecture} with ${compactedProject.files.length} files. Main patterns: ${compactedProject.patterns.join(', ')}.`;
      } catch {
        // Project context is optional
      }
    }

    // Create explanation prompt
    const systemPrompt = createExplanationSystemPrompt(audience, includeImprovement, focus);
    const userPrompt = createExplanationUserPrompt(
      codeContent,
      detectedLanguage,
      projectContext,
      focus
    );

    // Calculate timeout based on code length and model type
    baseTimeoutMs = parseInt(process.env.AI_CODE_EXPLANATION_TIMEOUT_MS || '60000', 10); // 60 seconds base (configurable)
    const codeMultiplier = Math.max(1, Math.floor(codeContent.length / 5000)); // +1 per 5KB of code
    const thinkingModelMultiplier = openai.getProviderInfo().model.includes('thinking') ? 3 : 1; // 3x for thinking models
    const dynamicTimeoutMs = Math.min(
      600000,
      baseTimeoutMs * codeMultiplier * thinkingModelMultiplier
    ); // Max 10 minutes

    logger.info('⏱️ Code explanation timeout calculated', {
      codeLength: codeContent.length,
      model: openai.getProviderInfo().model,
      isThinkingModel: openai.getProviderInfo().model.includes('thinking'),
      codeMultiplier,
      thinkingModelMultiplier,
      baseTimeout: `${baseTimeoutMs / 1000}s`,
      finalTimeout: `${dynamicTimeoutMs / 1000}s`,
      maxTimeout: '10 minutes',
    });

    // Get AI explanation with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Code explanation timed out after ${dynamicTimeoutMs / 1000}s. ` +
              `Current timeout: ${baseTimeoutMs / 1000}s base × ${codeMultiplier} (code size) × ${thinkingModelMultiplier} (model type)`
          )
        );
      }, dynamicTimeoutMs);
    });

    // Build API request with appropriate token parameter
    const model = openai.getModelForTask('base');
    const apiRequest = buildApiRequest(
      model,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      3000, // max completion tokens
      0.4 // temperature
    );

    const aiResponse = (await Promise.race([
      openai.createChatCompletion(apiRequest),
      timeoutPromise,
    ])) as any;

    const explanation = aiResponse.choices[0]?.message?.content || 'No explanation generated';

    const result = {
      success: true,
      explanation,
      metadata: {
        language: detectedLanguage,
        audience,
        focus: focus || 'general',
        includeImprovement,
        codeLength: codeContent.length,
        tokenUsage: aiResponse.usage?.total_tokens || 0,
        processingTime: Date.now() - startTime,
        provider: openai.getProviderInfo().provider,
        model: openai.getProviderInfo().model,
      },
    };

    logger.info('AI code explanation completed', {
      duration: result.metadata.processingTime,
      language: detectedLanguage,
      codeLength: codeContent.length,
    });

    return result;
  } catch (error) {
    logger.error('AI code explanation failed', { error: (error as Error).message });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
      suggestion:
        error instanceof Error && error.message.includes('timed out')
          ? `Consider increasing timeout via AI_CODE_EXPLANATION_TIMEOUT_MS environment variable (current: ${baseTimeoutMs / 1000}s). Check OpenAI API key and network connectivity.`
          : 'Check OpenAI API key and ensure the code/file is accessible',
    };
  }
}
