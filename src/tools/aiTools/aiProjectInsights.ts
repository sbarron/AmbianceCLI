/**
 * @fileOverview: AI-Enhanced Project Insights Tool
 * @module: AIProjectInsights
 * @keyFunctions:
 *   - aiProjectInsightsTool: Tool definition for comprehensive project analysis
 *   - handleAIProjectInsights: Handler with intelligent architecture analysis
 * @dependencies:
 *   - OpenAIService: Direct OpenAI API integration
 *   - SemanticCompactor: Code structure analysis
 *   - ProjectHintsGenerator: Project pattern detection
 * @context: Provides AI-powered analysis of project architecture, technical debt, and improvement recommendations
 */

import { SemanticCompactor } from '../../core/compactor/semanticCompactor';
import { ProjectHintsGenerator, ProjectHints } from '../projectHints';
import { validateAndResolvePath } from '../utils/pathUtils';
import { logger } from '../../utils/logger';
import { getOpenAIService } from './aiSemanticCompact';
import { createInsightsSystemPrompt, createInsightsUserPrompt } from './prompts/insightsPrompts';
import { buildApiRequest } from './utils/tokenUtils';
import { compileExcludePatterns, isExcludedPath } from '../utils/toolHelpers';

export const aiProjectInsightsTool = {
  name: 'ai_project_insights',
  description: `🔍 AI-ENHANCED PROJECT INSIGHTS AND RECOMMENDATIONS

Accepts absolute paths or relative paths (when workspace can be detected).

**When to use**:
- When you need intelligent analysis of project architecture and patterns
- For identifying technical debt and improvement opportunities
- When planning refactoring or new feature development
- For generating project documentation and onboarding materials

**Features**:
- AI-powered architecture analysis
- Technical debt identification
- Performance and security recommendations
- Code quality assessment
- Development workflow suggestions

**Performance**: 10-30 seconds for comprehensive project analysis`,
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Project directory path. Can be absolute or relative to workspace.',
      },
      analysisType: {
        type: 'string',
        enum: ['architecture', 'quality', 'security', 'performance', 'comprehensive'],
        default: 'comprehensive',
        description: 'Type of analysis to perform',
      },
      includeRecommendations: {
        type: 'boolean',
        default: true,
        description: 'Include actionable recommendations',
      },
      focusAreas: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['patterns', 'dependencies', 'testing', 'documentation', 'performance', 'security'],
        },
        description: 'Specific areas to focus analysis on',
      },
      outputFormat: {
        type: 'string',
        enum: ['structured', 'markdown', 'executive-summary'],
        default: 'structured',
        description: 'Format for the analysis output',
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional patterns to exclude from analysis (e.g., ["*.md", "docs/**", "*.test.js"])',
      },
    },
  },
};

export async function handleAIProjectInsights(args: any): Promise<any> {
  const startTime = Date.now();
  let validatedProjectPath: string = args.projectPath || 'unknown';

  try {
    const {
      projectPath,
      analysisType = 'comprehensive',
      includeRecommendations = true,
      focusAreas = [],
      outputFormat = 'structured',
      excludePatterns = [],
    } = args;

    // Validate that projectPath is provided and is absolute
    if (!projectPath) {
      throw new Error(
        '❌ projectPath is required. Please provide an absolute path to the project directory.'
      );
    }
    validatedProjectPath = validateAndResolvePath(projectPath);

    logger.info('Starting AI project insights analysis', {
      projectPath,
      analysisType,
      focusAreas,
      outputFormat,
    });

    const openai = getOpenAIService();

    // Handle exclude patterns by creating a temporary directory if needed
    let analysisPath = validatedProjectPath;
    let cleanupTempDir: (() => Promise<void>) | null = null;

    const excludeRegexes = compileExcludePatterns(excludePatterns);

    if (excludeRegexes.length > 0) {
      const fs = require('fs').promises;
      const path = require('path');
      const os = require('os');
      const { FileDiscovery } = await import('../../core/compactor/fileDiscovery.js');

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-insights-'));
      logger.info('📁 Creating temporary directory for AI insights exclude pattern filtering', {
        tempDir,
      });

      try {
        const fileDiscovery = new FileDiscovery(validatedProjectPath, {
          maxFileSize: 200000,
        });

        let allFiles = await fileDiscovery.discoverFiles();

        allFiles = allFiles.filter(file => !isExcludedPath(file.relPath, excludeRegexes));

        logger.info('📊 Applied exclude patterns to AI insights', {
          filteredCount: allFiles.length,
          excludePatterns,
        });

        // Copy filtered files to temp directory
        for (const file of allFiles) {
          const sourcePath = file.absPath;
          const relativePath = path.relative(validatedProjectPath, sourcePath);
          const destPath = path.join(tempDir, relativePath);

          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.copyFile(sourcePath, destPath);
        }

        analysisPath = tempDir;
        cleanupTempDir = async () => {
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
            logger.debug('🧹 Cleaned up AI insights temporary directory', { tempDir });
          } catch (error) {
            logger.warn('Failed to cleanup AI insights temporary directory', { tempDir, error });
          }
        };
      } catch (error) {
        // Clean up temp directory on error
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {}
        throw error;
      }
    }

    // Get comprehensive project analysis
    const [compactedProject, projectHints] = await Promise.all([
      new SemanticCompactor(analysisPath).compact(),
      new ProjectHintsGenerator().generateProjectHints(analysisPath, {
        format: 'json',
        maxFiles: 50,
        includeContent: true,
        useAI: false, // We'll do our own AI analysis
        excludePatterns,
      }),
    ]);

    // Clean up temporary directory if created
    if (cleanupTempDir) {
      try {
        await cleanupTempDir();
      } catch (cleanupError) {
        logger.warn('Failed to cleanup AI insights temporary directory', { error: cleanupError });
      }
    }

    // Build comprehensive context
    const analysisContext = {
      overview: {
        totalFiles: compactedProject.files.length,
        totalSymbols: compactedProject.processingStats.totalSymbols,
        languages: [...new Set(compactedProject.files.map(f => f.language))],
        patterns: compactedProject.patterns,
        architecture: compactedProject.summary.architecture,
      },
      primaryLanguages: (projectHints as ProjectHints).primaryLanguages,
      architectureKeywords: (projectHints as ProjectHints).architectureKeywords,
      domainKeywords: (projectHints as ProjectHints).domainKeywords,
      keyFiles: compactedProject.files.slice(0, 10).map(f => ({
        path: f.path,
        purpose: f.summary.purpose,
        exports: f.exports,
        complexity: f.nodes.length > 20 ? 'high' : f.nodes.length > 10 ? 'medium' : 'low',
      })),
      dependencies: [...new Set(compactedProject.files.flatMap(f => f.dependencies))],
    };

    // Create analysis prompt
    const systemPrompt = createInsightsSystemPrompt(
      analysisType,
      includeRecommendations,
      focusAreas
    );
    const userPrompt = createInsightsUserPrompt(analysisContext, analysisType, focusAreas);

    // Calculate timeout for project insights (typically longer)
    const baseTimeoutMs = 45000; // 45 seconds base for project analysis
    const fileMultiplier = Math.max(1, Math.floor(compactedProject.files.length / 50)); // +1 per 50 files
    const analysisMultiplier = analysisType === 'comprehensive' ? 2 : 1;
    const dynamicTimeoutMs = Math.min(240000, baseTimeoutMs * fileMultiplier * analysisMultiplier); // Max 4 minutes

    logger.info('⏱️ Project insights timeout calculated', {
      fileCount: compactedProject.files.length,
      analysisType,
      timeout: `${dynamicTimeoutMs / 1000}s`,
    });

    // Get AI insights with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Project insights timed out after ${dynamicTimeoutMs / 1000}s`));
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
      4000, // max completion tokens
      0.2 // Lower temperature for more structured analysis
    );

    const aiResponse = (await Promise.race([
      openai.createChatCompletion(apiRequest),
      timeoutPromise,
    ])) as any;

    const insights = aiResponse.choices[0]?.message?.content || 'No insights generated';

    // Format output based on requested format
    let formattedOutput = insights;
    if (outputFormat === 'markdown') {
      formattedOutput = `# Project Analysis Report\n\n${insights}`;
    } else if (outputFormat === 'executive-summary') {
      // Extract key points for executive summary
      const summaryPrompt = `Create a brief executive summary (2-3 paragraphs) from this analysis:\n\n${insights}`;
      const summaryResponse = await openai.createChatCompletion({
        model: openai.getModelForTask('mini'),
        messages: [{ role: 'user', content: summaryPrompt }],
        max_tokens: 500,
        temperature: 0.3,
      });
      formattedOutput = summaryResponse.choices[0]?.message?.content || insights;
    }

    const result = {
      success: true,
      insights: formattedOutput,
      analysis: {
        type: analysisType,
        focusAreas: focusAreas.length > 0 ? focusAreas : ['comprehensive'],
        format: outputFormat,
      },
      projectOverview: analysisContext.overview,
      metadata: {
        tokenUsage: aiResponse.usage?.total_tokens || 0,
        processingTime: Date.now() - startTime,
        provider: openai.getProviderInfo().provider,
        model: openai.getProviderInfo().model,
        includeRecommendations,
      },
    };

    logger.info('AI project insights completed', {
      duration: result.metadata.processingTime,
      analysisType,
      focusAreas: focusAreas.length,
    });

    return result;
  } catch (error) {
    logger.error('AI project insights failed', { error: (error as Error).message });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      projectPath: validatedProjectPath || args.projectPath || 'unknown',
      duration: Date.now() - startTime,
      suggestion: 'Check OpenAI API key and ensure the project contains supported files',
    };
  }
}
