/**
 * @fileOverview: AI Code Explanation Prompt Generators
 * @module: ExplanationPrompts
 * @keyFunctions:
 *   - createExplanationSystemPrompt: System prompt for code explanations
 *   - createExplanationUserPrompt: User prompt with code and context
 * @context: Provides audience-aware prompts for AI code explanation
 */

export function createExplanationSystemPrompt(
  audience: string,
  includeImprovement: boolean,
  focus?: string
): string {
  const audienceMap = {
    beginner: 'Explain concepts clearly with basic programming knowledge assumed.',
    intermediate: 'Provide detailed explanations assuming solid programming fundamentals.',
    expert: 'Focus on advanced concepts, patterns, and architectural decisions.',
  };

  let prompt = `You are an expert code mentor. ${audienceMap[audience as keyof typeof audienceMap]}`;

  if (focus) {
    prompt += ` Pay special attention to ${focus} aspects of the code.`;
  }

  if (includeImprovement) {
    prompt += ' Include constructive suggestions for improvement where appropriate.';
  }

  return (
    prompt +
    ' Be concise but thorough. Avoid starting responses with affirmative words like "Certainly!" or "Of course!".'
  );
}

export function createExplanationUserPrompt(
  code: string,
  language?: string,
  projectContext?: string,
  focus?: string
): string {
  const langText = language ? ` (${language})` : '';
  const contextText = projectContext ? `\n\nProject Context: ${projectContext}` : '';
  const focusText = focus ? `\n\nPlease focus on: ${focus}` : '';

  return `Explain this code${langText}:

\`\`\`
${code}
\`\`\`${contextText}${focusText}

Please explain:
1. What this code does
2. How it works
3. Key patterns or techniques used
4. Any notable design decisions
5. Potential improvements (if applicable)`;
}
