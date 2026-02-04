/**
 * @fileOverview: Template-based answer draft generation for enhanced local context
 * @module: AnswerDraftGenerator
 * @keyFunctions:
 *   - generateDeterministicAnswer(): Create template-based answers from jump targets
 *   - fillTemplate(): Fill template variables with project data
 *   - extractTemplateData(): Extract data from targets and project indices
 *   - generateFallbackAnswer(): Create generic answers when templates fail
 * @context: Provides deterministic, informative answers using template system
 */

import { JumpTarget, ANSWER_TEMPLATES } from './enhancedLocalContext';
import { logger } from '../../utils/logger';
import * as path from 'path';

// ===== TEMPLATE DATA INTERFACES =====

export interface TemplateData {
  engine?: string;
  initFile?: string;
  initSymbol?: string;
  writeSymbols?: string;
  readSymbols?: string;
  envKeys?: string;
  triggerPoints?: string;
  testFiles?: string;
  framework?: string;
  routeFiles?: string;
  handlers?: string;
  entryPoint?: string;
  authStrategy?: string;
  tokenHandling?: string;
  sessionFiles?: string;
  middlewareFiles?: string;
  storePath?: string;
  checks?: string;
  callChain?: string;
  readWriteMethods?: string;
  storageSetup?: string;
}

export interface AnswerContext {
  taskType: string;
  attackPlan: string;
  jumpTargets: JumpTarget[];
  projectIndices: any;
  query?: string;
}

// ===== MAIN GENERATION FUNCTION =====

/**
 * Generate deterministic answer using templates
 */
export function generateDeterministicAnswer(
  plan: string,
  taskType: string,
  targets: JumpTarget[],
  indices: any,
  query?: string
): string {
  logger.debug('📝 Generating deterministic answer', {
    plan,
    taskType,
    targetCount: targets.length,
    query,
  });

  if (targets.length === 0) {
    return generateNoTargetsAnswer(plan, taskType, query);
  }

  try {
    // Get template for this task type and plan
    const template = ANSWER_TEMPLATES[taskType]?.[plan];

    if (!template) {
      logger.debug('No template found, using fallback', { taskType, plan });
      return generateFallbackAnswer(plan, taskType, targets, query);
    }

    // Extract data from targets and indices
    const templateData = extractTemplateData(targets, indices, plan);

    // Fill template with data
    const answer = fillTemplate(template.pattern, templateData);

    // Ensure answer is within reasonable length (120-200 words)
    const finalAnswer = enforceWordLimit(answer, 120, 200);

    logger.debug('✅ Generated templated answer', {
      template: template.pattern.substring(0, 50),
      dataKeys: Object.keys(templateData),
      answerLength: finalAnswer.length,
    });

    return finalAnswer;
  } catch (error) {
    logger.warn('⚠️ Template generation failed, using fallback', {
      error: error instanceof Error ? error.message : String(error),
      plan,
      taskType,
    });

    return generateFallbackAnswer(plan, taskType, targets, query);
  }
}

// ===== TEMPLATE DATA EXTRACTION =====

/**
 * Extract template data from jump targets and project indices
 */
function extractTemplateData(targets: JumpTarget[], indices: any, plan: string): TemplateData {
  const data: TemplateData = {};

  // Extract data based on attack plan
  switch (plan) {
    case 'init-read-write':
      extractInitReadWriteData(targets, indices, data);
      break;
    case 'api-route':
      extractApiRouteData(targets, indices, data);
      break;
    case 'auth':
      extractAuthData(targets, indices, data);
      break;
    case 'error-driven':
      extractErrorData(targets, indices, data);
      break;
    default:
      extractGenericData(targets, indices, data);
  }

  return data;
}

/**
 * Extract data for init-read-write pattern
 */
function extractInitReadWriteData(targets: JumpTarget[], indices: any, data: TemplateData): void {
  // Find initialization symbols
  const initTargets = targets.filter(
    t => t.role?.includes('init') || t.symbol.match(/^(init|initialize|connect|open|create|setup)/i)
  );

  if (initTargets.length > 0) {
    const init = initTargets[0];
    data.initFile = getRelativePath(init.file);
    data.initSymbol = init.symbol;
  }

  // Find read/write operations
  const writeTargets = targets.filter(t =>
    t.symbol.match(/(insert|upsert|save|create|store|write|update)/i)
  );
  const readTargets = targets.filter(t =>
    t.symbol.match(/(select|query|search|find|get|read|retrieve)/i)
  );

  data.writeSymbols = writeTargets.map(t => t.symbol).join(', ') || 'writeOperations';
  data.readSymbols = readTargets.map(t => t.symbol).join(', ') || 'readOperations';

  // Detect engine from file paths and symbols
  data.engine = detectDatabaseEngine(targets, indices);

  // Extract environment keys
  data.envKeys = extractEnvKeys(targets, indices);

  // Find trigger points (entry points)
  data.triggerPoints = findTriggerPoints(targets, indices);

  // Find test files
  data.testFiles = findTestFiles(targets, indices);
}

/**
 * Extract data for API route pattern
 */
function extractApiRouteData(targets: JumpTarget[], indices: any, data: TemplateData): void {
  // Find framework
  data.framework = detectApiFramework(targets, indices);

  // Find route files
  const routeTargets = targets.filter(
    t =>
      t.file.includes('route') ||
      t.file.includes('api') ||
      t.symbol.match(/(get|post|put|delete|patch)/i)
  );
  data.routeFiles = [...new Set(routeTargets.map(t => getRelativePath(t.file)))].join(', ');

  // Find handlers
  const handlerTargets = targets.filter(
    t =>
      t.symbol.includes('handler') || t.symbol.includes('controller') || t.role?.includes('handler')
  );
  data.handlers = handlerTargets.map(t => `${getRelativePath(t.file)}:${t.symbol}`).join(', ');

  // Find entry point
  data.entryPoint = findApiEntryPoint(targets, indices);

  // Extract environment keys
  data.envKeys = extractEnvKeys(targets, indices);
}

/**
 * Extract data for auth pattern
 */
function extractAuthData(targets: JumpTarget[], indices: any, data: TemplateData): void {
  // Detect auth strategy
  data.authStrategy = detectAuthStrategy(targets, indices);

  // Find token handling
  const tokenTargets = targets.filter(t => t.symbol.match(/(token|jwt|sign|verify)/i));
  data.tokenHandling = tokenTargets.map(t => t.symbol).join(', ') || 'tokenHandlers';

  // Find session management
  const sessionTargets = targets.filter(
    t => t.symbol.match(/(session|cookie|store)/i) || t.file.includes('session')
  );
  data.sessionFiles = [...new Set(sessionTargets.map(t => getRelativePath(t.file)))].join(', ');

  // Find middleware
  const middlewareTargets = targets.filter(
    t => t.symbol.match(/(middleware|guard|protect|auth)/i) || t.file.includes('middleware')
  );
  data.middlewareFiles = [...new Set(middlewareTargets.map(t => getRelativePath(t.file)))].join(
    ', '
  );

  // Extract environment keys (auth-specific)
  data.envKeys = extractEnvKeys(targets, indices, ['JWT_SECRET', 'AUTH_SECRET', 'SESSION_SECRET']);
}

/**
 * Extract data for error-driven pattern
 */
function extractErrorData(targets: JumpTarget[], indices: any, data: TemplateData): void {
  // Find initialization symbol
  const initTargets = targets.filter(t => t.role?.includes('init'));
  if (initTargets.length > 0) {
    data.initSymbol = initTargets[0].symbol;
  }

  // Find storage path
  data.storePath = findStoragePath(targets, indices);

  // Extract environment keys
  data.envKeys = extractEnvKeys(targets, indices);

  // Generate verification checks
  data.checks = generateVerificationChecks(targets, indices);
}

/**
 * Extract generic data for fallback
 */
function extractGenericData(targets: JumpTarget[], indices: any, data: TemplateData): void {
  // Find most relevant files
  const files = [...new Set(targets.map(t => getRelativePath(t.file)))];
  data.routeFiles = files.slice(0, 3).join(', ');

  // Find key symbols
  const symbols = targets.slice(0, 5).map(t => t.symbol);
  data.handlers = symbols.join(', ');

  // Extract environment keys
  data.envKeys = extractEnvKeys(targets, indices);
}

// ===== TEMPLATE FILLING =====

/**
 * Fill template pattern with data
 */
function fillTemplate(pattern: string, data: TemplateData): string {
  let result = pattern;

  // Replace each template variable
  for (const [key, value] of Object.entries(data)) {
    const placeholder = `{${key}}`;
    const replacement = value || `[${key}]`; // Show placeholder if no value
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), replacement);
  }

  // Clean up any remaining placeholders
  result = result.replace(/\{[^}]+\}/g, '[unknown]');

  return result;
}

// ===== DATA DETECTION FUNCTIONS =====

/**
 * Detect database engine from targets
 */
function detectDatabaseEngine(targets: JumpTarget[], indices: any): string {
  // Check symbols and file paths for database indicators
  const symbols = targets.map(t => t.symbol.toLowerCase()).join(' ');
  const files = targets.map(t => t.file.toLowerCase()).join(' ');
  const combined = symbols + ' ' + files;

  if (combined.includes('sqlite') || combined.includes('better-sqlite3')) {
    return 'SQLite';
  }
  if (combined.includes('postgres') || combined.includes('pg')) {
    return 'PostgreSQL';
  }
  if (combined.includes('mongo') || combined.includes('mongoose')) {
    return 'MongoDB';
  }
  if (combined.includes('mysql')) {
    return 'MySQL';
  }
  if (combined.includes('redis')) {
    return 'Redis';
  }

  // Check system info if available
  if (indices.systems?.db?.engine) {
    return indices.systems.db.engine;
  }

  return 'database';
}

/**
 * Detect API framework
 */
function detectApiFramework(targets: JumpTarget[], indices: any): string {
  const files = targets.map(t => t.file.toLowerCase()).join(' ');
  const symbols = targets.map(t => t.symbol.toLowerCase()).join(' ');
  const combined = files + ' ' + symbols;

  if (combined.includes('express')) return 'Express';
  if (combined.includes('fastify')) return 'Fastify';
  if (combined.includes('koa')) return 'Koa';
  if (combined.includes('hapi')) return 'Hapi';
  if (combined.includes('next')) return 'Next.js';

  return 'Node.js API';
}

/**
 * Detect authentication strategy
 */
function detectAuthStrategy(targets: JumpTarget[], indices: any): string {
  const combined = targets.map(t => t.symbol.toLowerCase()).join(' ');

  if (combined.includes('jwt')) return 'JWT tokens';
  if (combined.includes('passport')) return 'Passport.js';
  if (combined.includes('session')) return 'session-based auth';
  if (combined.includes('oauth')) return 'OAuth';
  if (combined.includes('bcrypt')) return 'password hashing';

  return 'authentication system';
}

/**
 * Extract environment keys
 */
function extractEnvKeys(targets: JumpTarget[], indices: any, preferredKeys?: string[]): string {
  const envKeys = new Set<string>();

  // From project indices
  if (indices.env && Array.isArray(indices.env)) {
    indices.env.forEach((key: any) => {
      if (typeof key === 'string') {
        envKeys.add(key);
      } else if (key.key) {
        envKeys.add(key.key);
      }
    });
  }

  // From target symbols (process.env references)
  targets.forEach(target => {
    const envMatches = target.symbol.match(/process\.env\.(\w+)/g) || [];
    envMatches.forEach(match => {
      const key = match.replace('process.env.', '');
      envKeys.add(key);
    });
  });

  // Filter to preferred keys if provided
  let keys = Array.from(envKeys);
  if (preferredKeys) {
    const preferred = keys.filter(key => preferredKeys.some(pref => key.includes(pref)));
    if (preferred.length > 0) {
      keys = preferred;
    }
  }

  return keys.slice(0, 4).join(', ') || 'environment variables';
}

/**
 * Find trigger points (entry points)
 */
function findTriggerPoints(targets: JumpTarget[], indices: any): string {
  const triggerTargets = targets.filter(
    t =>
      t.symbol.match(/^(main|start|init|app|server|cli|run)/i) ||
      t.file.includes('index') ||
      t.file.includes('main') ||
      t.file.includes('server')
  );

  if (triggerTargets.length > 0) {
    return triggerTargets.map(t => `${getRelativePath(t.file)}:${t.symbol}`).join(', ');
  }

  return 'application startup';
}

/**
 * Find test files
 */
function findTestFiles(targets: JumpTarget[], indices: any): string {
  const testTargets = targets.filter(
    t => t.file.includes('test') || t.file.includes('spec') || t.symbol.includes('test')
  );

  if (testTargets.length > 0) {
    const testFiles = [...new Set(testTargets.map(t => getRelativePath(t.file)))];
    return testFiles.join(', ');
  }

  return 'tests';
}

/**
 * Find API entry point
 */
function findApiEntryPoint(targets: JumpTarget[], indices: any): string {
  const entryTargets = targets.filter(
    t =>
      t.symbol.match(/^(app|server|api|main)/i) ||
      t.file.includes('server') ||
      t.file.includes('index')
  );

  if (entryTargets.length > 0) {
    const entry = entryTargets[0];
    return `${getRelativePath(entry.file)}:${entry.symbol}`;
  }

  return 'server entry point';
}

/**
 * Find storage path for debugging
 */
function findStoragePath(targets: JumpTarget[], indices: any): string {
  // Look for file paths or environment variables that might be storage paths
  const envKeys = extractEnvKeys(targets, indices, ['DB_PATH', 'DATABASE_URL', 'STORAGE_PATH']);
  if (envKeys && envKeys !== 'environment variables') {
    return envKeys.split(', ')[0];
  }

  return 'storage location';
}

/**
 * Generate verification checks for debugging
 */
function generateVerificationChecks(targets: JumpTarget[], indices: any): string {
  const checks: string[] = [];

  // Environment variable checks
  const envKeys = extractEnvKeys(targets, indices);
  if (envKeys && envKeys !== 'environment variables') {
    checks.push(`echo $${envKeys.split(', ')[0]}`);
  }

  // File system checks
  if (targets.some(t => t.symbol.includes('path') || t.symbol.includes('file'))) {
    checks.push('ls -la storage/');
  }

  // Process checks
  checks.push('ps aux | grep node');

  return checks.slice(0, 3).join(', ') || 'system checks';
}

// ===== FALLBACK AND UTILITIES =====

/**
 * Generate fallback answer when no template is available
 */
function generateFallbackAnswer(
  plan: string,
  taskType: string,
  targets: JumpTarget[],
  query?: string
): string {
  const fileCount = new Set(targets.map(t => t.file)).size;
  const symbolCount = targets.length;
  const topFiles = [...new Set(targets.slice(0, 3).map(t => getRelativePath(t.file)))];
  const topSymbols = targets.slice(0, 3).map(t => t.symbol);

  let answer = `Analysis for "${query || 'your request'}" (${plan} pattern, ${taskType} task) `;
  answer += `found ${symbolCount} relevant symbols across ${fileCount} files. `;
  answer += `Key locations: ${topFiles.join(', ')}. `;
  answer += `Primary symbols: ${topSymbols.join(', ')}. `;

  // Add task-specific guidance
  switch (taskType) {
    case 'understand':
      answer += `Review these files to understand the implementation architecture and data flow.`;
      break;
    case 'debug':
      answer += `Start debugging by examining these symbols for potential issues or error conditions.`;
      break;
    case 'trace':
      answer += `Trace execution through these symbols to understand the call flow and dependencies.`;
      break;
    default:
      answer += `These locations contain the most relevant code for your analysis.`;
  }

  return answer;
}

/**
 * Generate answer when no targets found
 */
function generateNoTargetsAnswer(plan: string, taskType: string, query?: string): string {
  let answer = `No specific code locations found for "${query || 'your request'}" `;
  answer += `using ${plan} analysis pattern. `;

  switch (plan) {
    case 'init-read-write':
      answer += `Consider searching for database initialization, storage operations, or data persistence patterns.`;
      break;
    case 'api-route':
      answer += `Consider examining API routes, HTTP handlers, or endpoint definitions.`;
      break;
    case 'auth':
      answer += `Consider looking for authentication middleware, login handlers, or token management.`;
      break;
    default:
      answer += `Consider broadening your search terms or using project_hints for navigation guidance.`;
  }

  return answer;
}

/**
 * Enforce word limit on generated answers
 */
function enforceWordLimit(text: string, minWords: number, maxWords: number): string {
  const words = text.split(/\s+/);

  if (words.length < minWords) {
    // Too short - add context
    return text + ` Use the jump targets and mini-bundle for detailed implementation analysis.`;
  }

  if (words.length > maxWords) {
    // Too long - truncate gracefully
    const truncated = words.slice(0, maxWords).join(' ');
    return truncated + '...';
  }

  return text;
}

/**
 * Get relative path for display
 */
function getRelativePath(absolutePath: string): string {
  const parts = absolutePath.split(/[/\\]/);
  const srcIndex = parts.findIndex(part => part === 'src');
  if (srcIndex >= 0) {
    return parts.slice(srcIndex).join('/');
  }
  return parts.slice(-2).join('/');
}
