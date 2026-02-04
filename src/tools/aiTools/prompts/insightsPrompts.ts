/**
 * @fileOverview: AI Project Insights Prompt Generators
 * @module: InsightsPrompts
 * @keyFunctions:
 *   - createInsightsSystemPrompt: System prompt for project analysis
 *   - createInsightsUserPrompt: User prompt with project context
 * @context: Provides analysis-type-specific prompts for AI project insights
 */

export function createInsightsSystemPrompt(
  analysisType: string,
  includeRecommendations: boolean,
  focusAreas: string[]
): string {
  let prompt = 'You are a senior software architect and technical consultant. ';

  switch (analysisType) {
    case 'architecture':
      prompt += 'Focus on architectural patterns, design decisions, and structural analysis.';
      break;
    case 'quality':
      prompt += 'Focus on code quality, maintainability, and development best practices.';
      break;
    case 'security':
      prompt += 'Focus on security vulnerabilities, risk assessment, and security best practices.';
      break;
    case 'performance':
      prompt += 'Focus on performance bottlenecks, optimization opportunities, and scalability.';
      break;
    case 'comprehensive':
      prompt +=
        'Provide comprehensive analysis covering architecture, quality, and development practices.';
      break;
  }

  if (focusAreas.length > 0) {
    prompt += ` Pay special attention to: ${focusAreas.join(', ')}.`;
  }

  if (includeRecommendations) {
    prompt += ' Include specific, actionable recommendations.';
  }

  return (
    prompt +
    ' Structure your analysis clearly and provide practical insights. Avoid starting responses with affirmative words like "Certainly!" or "Of course!".'
  );
}

export function createInsightsUserPrompt(
  context: any,
  analysisType: string,
  focusAreas: string[]
): string {
  const contextJson = JSON.stringify(context, null, 2);
  const focusText = focusAreas.length > 0 ? `\n\nFocus areas: ${focusAreas.join(', ')}` : '';

  return `Analyze this project and provide ${analysisType} insights:

${contextJson}${focusText}

Please provide structured analysis including:
1. Current state assessment
2. Strengths and opportunities
3. Potential risks or concerns
4. Specific recommendations
5. Priority actions (if applicable)`;
}
