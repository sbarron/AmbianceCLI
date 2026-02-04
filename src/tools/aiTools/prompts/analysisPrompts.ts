/**
 * @fileOverview: AI Analysis Prompt Generators
 * @module: AnalysisPrompts
 * @keyFunctions:
 *   - createAnalysisSystemPrompt: System prompt for semantic analysis
 *   - createAnalysisUserPrompt: User prompt with context and query
 * @context: Provides task-specific and format-aware prompts for AI code analysis
 */

export function createAnalysisSystemPrompt(
  taskType: string,
  complexity: string,
  includeExplanations: boolean,
  format?: string
): string {
  // Task-specific base prompts to match user expectations
  const basePrompts = {
    understand: `You are an expert software architect focused on explaining complex codebases clearly and thoroughly. Your primary goal is to help developers build comprehensive mental models and deep understanding of how systems work. Prioritize clear explanations, architecture insights, and comprehensive summaries.`,
    implement: `You are an expert software engineer focused on practical implementation guidance. Your primary goal is to help developers take concrete action and make specific code changes. Prioritize actionable steps, specific file locations, and implementation patterns.`,
    debug: `You are an expert debugger focused on identifying and solving specific issues. Your primary goal is to help developers trace problems and implement fixes. Prioritize error analysis, debugging strategies, and concrete solutions.`,
    default: `You are an expert software architect and code analyst who provides actionable guidance. Your primary goal is to help developers understand codebases and take concrete next steps. Always focus on practical, implementable recommendations rather than just descriptions.`,
  };

  const basePrompt = basePrompts[taskType as keyof typeof basePrompts] || basePrompts.default;

  let taskSpecific = '';
  switch (taskType) {
    case 'debug':
      taskSpecific =
        ' Focus on identifying specific issues, error patterns, and provide step-by-step debugging approaches with concrete fixes.';
      break;
    case 'implement':
      taskSpecific =
        ' Focus on implementation patterns, provide specific code examples, and actionable development steps.';
      break;
    case 'understand':
      taskSpecific =
        ' Focus on comprehensive explanations of architecture, relationships, and how components work together. Provide thorough summaries and help build complete mental models of the system.';
      break;
    case 'refactor':
      taskSpecific =
        ' Focus on code quality issues and provide specific refactoring strategies with concrete before/after examples.';
      break;
    case 'test':
      taskSpecific =
        ' Focus on testability gaps and provide specific test cases, mocking strategies, and coverage improvement steps.';
      break;
    case 'document':
      taskSpecific =
        ' Focus on documentation gaps and provide specific documentation improvements with concrete examples.';
      break;
  }

  const complexityNote =
    complexity === 'comprehensive'
      ? ' Provide thorough analysis with detailed implementation guidance.'
      : complexity === 'detailed'
        ? ' Provide balanced analysis with actionable insights and specific recommendations.'
        : ' Provide concise analysis with immediate, high-impact action items.';

  const explanationNote = includeExplanations
    ? ' Include clear explanations of patterns and decisions, then provide specific next steps.'
    : ' Focus on concrete actions and recommendations rather than general explanations.';

  let formatNote = '';
  if (format === 'markdown') {
    formatNote =
      ' Structure your response with clear sections, actionable recommendations, and specific implementation steps.';
  } else if (format === 'structured') {
    formatNote =
      ' Organize your response with specific action items, implementation priorities, and measurable outcomes.';
  }

  return (
    basePrompt +
    taskSpecific +
    complexityNote +
    explanationNote +
    formatNote +
    ' Avoid starting responses with affirmative words like "Certainly!" or "Of course!".'
  );
}

export function createAnalysisUserPrompt(
  query: string | undefined,
  context: any[],
  taskType: string,
  format?: string
): string {
  const contextJson = JSON.stringify(context, null, 2);
  const queryText = query ? `\n\nSpecific focus: ${query}` : '';

  // Task-specific prompt templates
  const promptTemplates = {
    understand: `Analyze this codebase context and provide comprehensive understanding:

${contextJson}

Task type: ${taskType}${queryText}

Please provide THOROUGH, COMPREHENSIVE analysis:

1. **System Overview**
   - What is this system and what does it do?
   - High-level architecture and key components
   - Primary responsibilities and data flow

2. **Component Analysis**
   - How do the main components work?
   - What are the key classes, functions, and interfaces?
   - How do they interact and depend on each other?

3. **Code Organization & Patterns**
   - What architectural patterns are used?
   - How is the code organized and why?
   - What are the main abstractions and design decisions?

4. **Key Concepts & Mental Models**
   - What concepts does a developer need to understand?
   - How should someone think about this system?
   - What are the important relationships and dependencies?

5. **Context for Further Exploration**
   - What files contain the most important logic?
   - Where would you look to understand specific features?
   - What are the main entry points and extension points?

Focus on building comprehensive understanding with clear explanations and thorough summaries.`,

    implement: `Analyze this codebase context and provide actionable implementation guidance:

${contextJson}

Task type: ${taskType}${queryText}

Please provide SPECIFIC, ACTIONABLE guidance:

1. **Immediate Actions (Next 30 minutes)**
   - What should the developer do first?
   - Quick wins and immediate improvements

2. **Short-term Implementation (Next 1-2 hours)**
   - Specific code changes or additions
   - Concrete implementation steps with file names and code examples

3. **Medium-term Improvements (Next day)**
   - Architecture enhancements
   - Testing and documentation priorities

4. **Key Insights for Decision Making**
   - Critical architectural decisions
   - Trade-offs and considerations
   - Risk factors and mitigation strategies

5. **Concrete Next Steps**
   - Specific files to modify
   - Exact code patterns to implement
   - Measurable success criteria

Focus on providing specific, implementable actions rather than general observations. Include concrete code examples where helpful.`,

    debug: `Analyze this codebase context and provide debugging guidance:

${contextJson}

Task type: ${taskType}${queryText}

Please provide SYSTEMATIC debugging analysis:

1. **Error Analysis**
   - What errors or issues can you identify?
   - What are the likely root causes?
   - What symptoms should developers look for?

2. **Debugging Strategy**
   - Where should debugging start?
   - What tools and techniques would be most effective?
   - What logging or instrumentation is needed?

3. **Immediate Fixes**
   - What can be fixed right now?
   - What workarounds are available?
   - What validation steps should be taken?

4. **Root Cause Solutions**
   - What underlying issues need to be addressed?
   - What code changes would prevent similar problems?
   - How can error handling be improved?

5. **Prevention & Monitoring**
   - How can similar issues be prevented?
   - What monitoring or alerts should be added?
   - What testing strategies would catch these problems?

Focus on systematic problem-solving with concrete debugging steps and solutions.`,
  };

  // Use task-specific template or fall back to implement template
  return promptTemplates[taskType as keyof typeof promptTemplates] || promptTemplates.implement;
}
