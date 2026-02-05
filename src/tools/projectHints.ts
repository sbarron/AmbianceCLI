/**
 * @fileOverview: Intelligent project analysis and hints generation with enhanced performance and multiple output formats
 * @module: ProjectHintsGenerator
 * @keyFunctions:
 *   - generateProjectHints(): Create comprehensive project insights with configurable output formats (JSON, Markdown, HTML)
 *   - generateFolderDocumentation(): Analyze folder structure and purpose with improved confidence scoring
 *   - extractSymbols(): Parallel file processing with configurable size limits and filtered generic symbols
 *   - formatAsMarkdown()/formatAsHTML(): Multiple output format support for different use cases
 *   - generateFunctionChart(): Chart generation for symbol frequency visualization
 *   - analyzeContentForConfidence(): Content-based analysis to improve folder purpose detection
 * @dependencies:
 *   - OpenAIService: Centralized AI service with provider-specific configurations
 *   - FileDiscovery: File system scanning and discovery
 *   - fs/promises: Parallel file reading operations
 *   - path: Path manipulation utilities
 * @context: Provides intelligent project navigation hints with enhanced performance, better confidence scoring,
 *           and multiple output formats to help AI agents understand project organization
 * @improvements:
 *   - Performance: Parallel file processing, configurable size thresholds
 *   - Usability: Multiple output formats (JSON, Markdown, HTML), chart generation
 *   - Quality: Better type safety, refactored methods, improved symbol filtering
 *   - Accuracy: Content-based confidence scoring, generic symbol filtering
 *   - Integration: Uses centralized OpenAIService with provider-specific configurations
 */

import { FileDiscovery, FileInfo } from '../core/compactor/fileDiscovery';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import {
  OpenAIService,
  createOpenAIService,
  ProviderType,
  resolveProviderApiKey,
  PROVIDER_API_KEY_ENV,
} from '../core/openaiService';
import { projectHintsComposer, ProjectHintsWithEvidence } from './projectHints/composer';
import { LocalEmbeddingStorage } from '../local/embeddingStorage';
import { LocalEmbeddingGenerator } from '../local/embeddingGenerator';
import { compileExcludePatterns, isExcludedPath } from './utils/toolHelpers';

export interface WordFrequency {
  word: string;
  count: number;
  files: string[];
  folders: string[];
}

export interface FolderHint {
  purpose: string;
  keywords: string[];
  fileTypes: string[];
  confidence: number;
  fileCount: number;
}

export interface FolderDocumentation {
  path: string;
  name: string;
  purpose: string;
  keyFiles: string[];
  subFolders: FolderDocumentation[];
  architecture: string[];
  dependencies: { imports: string[]; exports: string[] };
  documentation: string;
  lastAnalyzed: Date;
  confidence: number;
}

export interface SymbolMaps {
  functions: WordFrequency[];
  classes: WordFrequency[];
  imports: WordFrequency[];
  variables: WordFrequency[];
}

export interface ProjectHints {
  // High-level project guidance
  projectPurpose?: string; // Brief description of what the project does
  primaryLanguages: string[];
  architectureKeywords: string[];
  domainKeywords: string[];

  // Folder-specific hints
  folderHints: Record<string, FolderHint>;

  // File-specific hints
  entryPoints: string[];
  configFiles: string[];
  documentationFiles: string[];

  // Symbol frequency maps
  symbolHints: SymbolMaps;

  // Metadata
  totalFiles: number;
  codebaseSize: string;
  lastAnalyzed: Date;
}

export interface ProjectHintsOptions {
  maxFiles?: number;
  includeContent?: boolean;
  useAI?: boolean;
  maxFileSizeForSymbols?: number;
  format?: 'json' | 'markdown' | 'html';
  excludePatterns?: string[];
  includeCharts?: {
    type: 'functions' | 'classes';
    maxItems?: number;
  };
}

export interface FolderDocumentationOptions {
  maxDepth?: number;
  includeSubfolders?: boolean;
  useAI?: boolean;
}

export class ProjectHintsGenerator {
  private openaiService: OpenAIService | null = null;
  private useAI = false;

  constructor() {
    const provider = this.determineProvider();
    const apiKey = resolveProviderApiKey(provider);

    if (apiKey) {
      try {
        this.openaiService = createOpenAIService({
          apiKey,
          provider,
          model: process.env.OPENAI_BASE_MODEL,
          miniModel: process.env.OPENAI_MINI_MODEL,
          embeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL,
          baseUrl: process.env.OPENAI_BASE_URL,
          organization: process.env.OPENAI_ORG_ID,
        });
        this.useAI = true;

        logger.info('ProjectHintsGenerator initialized with OpenAI service', {
          provider: this.openaiService.getProviderInfo().provider,
          model: this.openaiService.getProviderInfo().model,
          miniModel: this.openaiService.getProviderInfo().miniModel,
        });
      } catch (error) {
        logger.warn('Failed to initialize OpenAI service for project hints', {
          error: (error as Error).message,
        });
        this.openaiService = null;
        this.useAI = false;
      }
    } else if (process.env.OPENAI_API_KEY) {
      // Legacy compatibility: allow OPENAI_API_KEY to trigger OpenAI provider when detection fails
      try {
        this.openaiService = createOpenAIService({
          apiKey: process.env.OPENAI_API_KEY,
          provider,
          model: process.env.OPENAI_BASE_MODEL,
          miniModel: process.env.OPENAI_MINI_MODEL,
          embeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL,
          baseUrl: process.env.OPENAI_BASE_URL,
          organization: process.env.OPENAI_ORG_ID,
        });
        this.useAI = true;
        logger.info('ProjectHintsGenerator initialized with fallback OpenAI service', {
          provider: this.openaiService.getProviderInfo().provider,
          model: this.openaiService.getProviderInfo().model,
          miniModel: this.openaiService.getProviderInfo().miniModel,
        });
      } catch (error) {
        logger.warn('Failed to initialize fallback OpenAI service for project hints', {
          error: (error as Error).message,
        });
        this.openaiService = null;
        this.useAI = false;
      }
    } else {
      logger.debug('Skipping AI-backed project hints due to missing provider credentials', {
        provider,
        expectedEnv: PROVIDER_API_KEY_ENV[provider] || ['OPENAI_API_KEY'],
      });
    }
  }

  /**
   * Determine the provider type based on environment variables or OpenAI base URL
   */
  private determineProvider(): ProviderType {
    // Check explicit provider setting first
    const explicitProvider = process.env.OPENAI_PROVIDER?.toLowerCase() as ProviderType;
    if (
      explicitProvider &&
      [
        'openai',
        'qwen',
        'azure',
        'anthropic',
        'together',
        'openrouter',
        'grok',
        'groq',
        'custom',
      ].includes(explicitProvider)
    ) {
      return explicitProvider;
    }

    // Determine from OpenAI-specific base URL only
    const openaiBaseUrl = process.env.OPENAI_BASE_URL;
    if (openaiBaseUrl) {
      try {
        const host = new URL(openaiBaseUrl).host.toLowerCase();
        if (host.includes('aliyuncs.com') || host.includes('qwen')) return 'qwen';
        if (host.includes('azure')) return 'azure';
        if (host.includes('anthropic.com')) return 'anthropic';
        if (host.includes('together.xyz')) return 'together';
        if (host.includes('openrouter.ai')) return 'openrouter';
        if (host.includes('api.x.ai') || host.endsWith('.x.ai')) return 'grok';
        if (host.includes('groq.com')) return 'groq';
        if (host.includes('openai.com')) return 'openai';
      } catch {
        // Invalid URL, fall back to default
      }
    }

    // Default to OpenAI
    return 'openai';
  }

  private getHintsModel(): string {
    if (this.openaiService) {
      // Use the service's model selection for mini tasks
      return this.openaiService.getModelForTask('mini');
    }

    return (
      process.env.PROJECT_HINTS_MODEL ||
      process.env.OPENAI_MINI_MODEL ||
      process.env.OPENAI_BASE_MODEL ||
      'gpt-5-mini'
    );
  }

  /**
   * Generate folder-specific documentation
   */
  async generateFolderDocumentation(
    projectPath: string,
    folderPath = '.',
    options: FolderDocumentationOptions = {}
  ): Promise<FolderDocumentation> {
    const { includeSubfolders = true, useAI = this.useAI } = options;

    // Note: maxDepth parameter available but not yet implemented

    logger.info('Generating folder documentation', { folderPath, projectPath });

    // Always discover files from the project root to get consistent relative paths
    const fileDiscovery = new FileDiscovery(projectPath, {
      maxFileSize: 200000,
    });

    const allFiles = await fileDiscovery.discoverFiles();

    // Filter files to this specific folder if not root
    // Normalize path separators for cross-platform compatibility
    const normalizedFolderPath = folderPath === '.' ? '.' : folderPath.replace(/[\/\\]/g, path.sep);
    const folderFiles =
      folderPath === '.'
        ? allFiles
        : allFiles.filter(file => {
            const normalizedFilePath = file.relPath.replace(/[\/\\]/g, path.sep);
            return (
              normalizedFilePath.startsWith(normalizedFolderPath + path.sep) ||
              normalizedFilePath === normalizedFolderPath
            );
          });

    // Analyze folder structure
    const folderHints = await this.analyzeFolderStructure(folderFiles, useAI);
    const currentFolderHint = folderHints[folderPath] || folderHints['.'];

    // Get subfolder information
    const subFolders: FolderDocumentation[] = [];
    if (includeSubfolders) {
      const subFolderPaths = new Set<string>();
      folderFiles.forEach(file => {
        const relativePath = path.relative(folderPath === '.' ? '' : folderPath, file.relPath);
        const firstDir = relativePath.split(path.sep)[0];
        const fileName = path.basename(file.relPath);
        if (firstDir && firstDir !== fileName && !firstDir.includes('.')) {
          subFolderPaths.add(path.join(folderPath === '.' ? '' : folderPath, firstDir));
        }
      });

      for (const subPath of Array.from(subFolderPaths).slice(0, 10)) {
        try {
          const subDoc = await this.generateFolderDocumentation(projectPath, subPath, {
            ...options,
            includeSubfolders: false, // Prevent deep recursion
          });
          subFolders.push(subDoc);
        } catch (error) {
          logger.warn('Could not analyze subfolder', {
            subPath,
            error: (error as Error).message,
          });
        }
      }
    }

    // Extract symbols and patterns
    const symbolMaps = await this.extractSymbols(folderFiles, true);

    // Get key files
    const keyFiles = this.findKeyFiles(folderFiles);

    // Analyze dependencies
    const dependencies = await this.analyzeFolderDependencies(folderFiles);

    // Generate architecture patterns
    const architecture = this.detectArchitecturePatterns(folderFiles, symbolMaps);

    // Generate AI documentation if available
    let documentation = '';
    if (useAI && this.openaiService && currentFolderHint) {
      documentation = await this.generateAIDocumentation(
        folderPath,
        folderFiles,
        currentFolderHint,
        symbolMaps
      );
    }

    if (!documentation) {
      documentation = this.generateBasicDocumentation(folderPath, folderFiles, currentFolderHint);
    }

    const result: FolderDocumentation = {
      path: folderPath,
      name: path.basename(folderPath) || 'root',
      purpose: currentFolderHint?.purpose || 'Code directory',
      keyFiles,
      subFolders,
      architecture,
      dependencies,
      documentation,
      lastAnalyzed: new Date(),
      confidence: currentFolderHint?.confidence || 0.5,
    };

    logger.info('Folder documentation generated', {
      folderPath,
      keyFileCount: keyFiles.length,
      subFolderCount: subFolders.length,
    });

    return result;
  }

  /**
   * Generate comprehensive project hints and word cloud
   */
  async generateProjectHints(
    projectPath: string,
    options: ProjectHintsOptions = {}
  ): Promise<ProjectHints | ProjectHintsWithEvidence | string> {
    const {
      maxFiles = 200,
      includeContent = false,
      useAI = this.useAI,
      maxFileSizeForSymbols = 50000,
      format = 'json',
      excludePatterns = [],
    } = options;

    logger.info('Generating project hints', { projectPath, options });

    const hintsGenerator = new ProjectHintsGenerator();
    const excludeRegexes = compileExcludePatterns(excludePatterns);

    const hints = await hintsGenerator.generateRawHints(projectPath, {
      maxFiles,
      includeContent,
      useAI,
      maxFileSizeForSymbols,
      excludePatterns,
    });

    // Check if we should enhance with evidence cards
    const useEmbeddingAssisted = this.shouldUseEmbeddingAssistedHints();

    let finalHints: ProjectHints | ProjectHintsWithEvidence;
    if (useEmbeddingAssisted && format === 'json') {
      // Enhance with evidence cards for JSON format
      finalHints = await projectHintsComposer.enhanceWithEvidence(hints);
    } else {
      finalHints = hints;
    }

    // Handle different output formats
    switch (format) {
      case 'markdown':
        return this.formatAsMarkdown(finalHints);
      case 'html':
        return this.formatAsHTML(finalHints);
      default:
        return finalHints;
    }
  }

  /**
   * Generate raw project hints data
   */
  private async generateRawHints(
    projectPath: string,
    options: {
      maxFiles: number;
      includeContent: boolean;
      useAI: boolean;
      maxFileSizeForSymbols: number;
      excludePatterns: string[];
    }
  ): Promise<ProjectHints> {
    const { maxFiles, includeContent, useAI, maxFileSizeForSymbols, excludePatterns } = options;

    // Discover all files
    const fileDiscovery = new FileDiscovery(projectPath, {
      maxFileSize: 200000, // 200KB limit for hint analysis
    });

    let allFiles = await fileDiscovery.discoverFiles();

    // Apply exclude patterns if provided
    if (excludePatterns && excludePatterns.length > 0) {
      const excludeRegexes = compileExcludePatterns(excludePatterns);
      allFiles = allFiles.filter(file => !isExcludedPath(file.relPath, excludeRegexes));
    }

    // Sort by relevance and limit
    const limitedFiles = fileDiscovery.sortByRelevance(allFiles).slice(0, maxFiles);

    // Process different analyses in parallel for better performance
    const [symbolMaps, folderHints] = await Promise.all([
      this.extractSymbols(limitedFiles, includeContent, maxFileSizeForSymbols),
      this.analyzeFolderStructure(limitedFiles, useAI),
    ]);

    // Detect architecture and domain patterns
    const architectureKeywords = this.detectArchitecturePatterns(limitedFiles, symbolMaps);
    const domainKeywords = this.extractDomainKeywords(limitedFiles, symbolMaps);

    // Get file size information
    const totalSize = limitedFiles.reduce((sum: number, file: FileInfo) => sum + file.size, 0);
    const codebaseSize = this.formatFileSize(totalSize);

    // Generate project purpose summary
    const projectPurpose = await this.generateProjectPurpose(
      projectPath,
      limitedFiles,
      architectureKeywords,
      domainKeywords
    );

    const hints: ProjectHints = {
      projectPurpose,
      primaryLanguages: this.getPrimaryLanguages(limitedFiles),
      architectureKeywords,
      domainKeywords,
      folderHints,
      entryPoints: this.findEntryPoints(limitedFiles),
      configFiles: this.findConfigFiles(limitedFiles),
      documentationFiles: this.findDocumentationFiles(limitedFiles),
      symbolHints: symbolMaps,
      totalFiles: limitedFiles.length,
      codebaseSize,
      lastAnalyzed: new Date(),
    };

    logger.info('Project hints generated', {
      totalFiles: hints.totalFiles,
      codebaseSize: hints.codebaseSize,
      folderCount: Object.keys(hints.folderHints).length,
      functionCount: hints.symbolHints.functions.length,
    });

    return hints;
  }

  /**
   * Generate a high-level project purpose summary
   */
  private async generateProjectPurpose(
    projectPath: string,
    files: FileInfo[],
    architectureKeywords: string[],
    domainKeywords: string[]
  ): Promise<string | undefined> {
    try {
      // Try to get purpose from package.json first
      const packageJsonPath = path.join(projectPath, 'package.json');
      try {
        const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        if (packageJson.description && packageJson.description.trim()) {
          return packageJson.description.trim();
        }
      } catch {
        // package.json not found or no description, continue
      }

      // Try to extract from README
      const readmeFile = files.find(
        f =>
          f.relPath.toLowerCase() === 'readme.md' ||
          f.relPath.toLowerCase() === 'readme.txt' ||
          f.relPath.toLowerCase() === 'readme'
      );

      if (readmeFile) {
        try {
          const readmeContent = await readFile(readmeFile.absPath, 'utf-8');
          const firstParagraph = this.extractFirstMeaningfulParagraph(readmeContent);
          if (firstParagraph) {
            return firstParagraph;
          }
        } catch {
          // README not readable, continue
        }
      }

      // Fallback: Generate purpose from project structure
      return this.inferPurposeFromStructure(files, architectureKeywords, domainKeywords);
    } catch (error) {
      logger.warn('Failed to generate project purpose', {
        error: (error as Error).message,
      });
      return undefined;
    }
  }

  /**
   * Extract the first meaningful paragraph from README
   */
  private extractFirstMeaningfulParagraph(content: string): string | null {
    const lines = content.split('\n');
    let paragraphLines: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip code blocks
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      if (inCodeBlock) continue;

      // Skip headers, badges, and empty lines
      if (
        trimmed.startsWith('#') ||
        trimmed.startsWith('[![') ||
        trimmed.startsWith('[!') ||
        trimmed.startsWith('---') ||
        trimmed.length === 0
      ) {
        if (paragraphLines.length > 0) break; // End of paragraph
        continue;
      }

      paragraphLines.push(trimmed);

      // If we have a substantial paragraph, stop
      if (paragraphLines.join(' ').length > 100) {
        break;
      }
    }

    if (paragraphLines.length === 0) return null;

    const paragraph = paragraphLines.join(' ').trim();

    // Clean up common README patterns
    const cleaned = paragraph
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove markdown links
      .replace(/`([^`]+)`/g, '$1') // Remove code formatting
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
      .replace(/\*([^*]+)\*/g, '$1') // Remove italic
      .trim();

    // Return if it's a meaningful description (not just a title)
    if (cleaned.length > 20 && !cleaned.match(/^[A-Z][a-z]+ [A-Z][a-z]+$/)) {
      return cleaned.length > 150 ? cleaned.substring(0, 147) + '...' : cleaned;
    }

    return null;
  }

  /**
   * Infer project purpose from file structure and patterns
   */
  private inferPurposeFromStructure(
    files: FileInfo[],
    architectureKeywords: string[],
    domainKeywords: string[]
  ): string {
    const languages = this.getPrimaryLanguages(files);
    const hasTests = files.some(f => f.relPath.toLowerCase().includes('test'));
    const hasApi = files.some(
      f => f.relPath.toLowerCase().includes('api') || f.relPath.toLowerCase().includes('route')
    );
    const hasCli = files.some(f => f.relPath.toLowerCase().includes('cli'));
    const hasWeb = files.some(
      f =>
        f.relPath.toLowerCase().includes('component') ||
        f.relPath.toLowerCase().includes('view') ||
        f.relPath.toLowerCase().includes('page')
    );

    let purposeParts: string[] = [];

    // Determine project type
    if (hasCli && hasApi) {
      purposeParts.push('CLI tool with API integration');
    } else if (hasCli) {
      purposeParts.push('Command-line interface tool');
    } else if (hasApi && hasWeb) {
      purposeParts.push('Full-stack web application');
    } else if (hasApi) {
      purposeParts.push('API server');
    } else if (hasWeb) {
      purposeParts.push('Web application');
    } else {
      purposeParts.push('Software project');
    }

    // Add language context
    if (languages.length > 0) {
      purposeParts.push(`built with ${languages.slice(0, 2).join(' and ')}`);
    }

    // Add domain context if available
    if (domainKeywords.length > 0) {
      const topDomains = domainKeywords.slice(0, 3).join(', ');
      purposeParts.push(`focusing on ${topDomains}`);
    }

    // Add architecture context if available
    if (architectureKeywords.length > 0) {
      purposeParts.push(`using ${architectureKeywords.slice(0, 2).join(' and ')}`);
    }

    return purposeParts.join(', ') + '.';
  }

  /**
   * Extract symbols from files using pattern matching and light parsing with parallel processing
   */
  private async extractSymbols(
    files: FileInfo[],
    includeContent: boolean,
    maxFileSize: number = 50000
  ): Promise<SymbolMaps> {
    const functionMap = new Map<
      string,
      { count: number; files: Set<string>; folders: Set<string> }
    >();
    const classMap = new Map<string, { count: number; files: Set<string>; folders: Set<string> }>();
    const importMap = new Map<
      string,
      { count: number; files: Set<string>; folders: Set<string> }
    >();
    const variableMap = new Map<
      string,
      { count: number; files: Set<string>; folders: Set<string> }
    >();

    // Process files in parallel for better performance
    const filePromises = files.map(async file => {
      if (!includeContent && file.size > maxFileSize) return null;
      try {
        const content = await readFile(file.absPath, 'utf-8');
        const folder = path.dirname(file.relPath);
        return { content, file, folder };
      } catch (error) {
        logger.warn('Could not read file during analysis', {
          filePath: file.relPath,
          error: (error as Error).message,
        });
        return null;
      }
    });

    const results = (await Promise.all(filePromises)).filter(result => result !== null);

    for (const result of results) {
      if (result) {
        const { content, file, folder } = result;
        // Extract patterns based on language
        this.extractPatternsFromContent(content, file, folder, {
          functionMap,
          classMap,
          importMap,
          variableMap,
        });
      }
    }

    return {
      functions: this.mapToWordFrequency(functionMap).slice(0, 50),
      classes: this.mapToWordFrequency(classMap).slice(0, 30),
      imports: this.mapToWordFrequency(importMap).slice(0, 40),
      variables: this.mapToWordFrequency(variableMap).slice(0, 30),
    };
  }

  /**
   * Extract patterns from file content using regex patterns
   */
  private extractPatternsFromContent(
    content: string,
    file: FileInfo,
    folder: string,
    maps: {
      functionMap: Map<string, { count: number; files: Set<string>; folders: Set<string> }>;
      classMap: Map<string, { count: number; files: Set<string>; folders: Set<string> }>;
      importMap: Map<string, { count: number; files: Set<string>; folders: Set<string> }>;
      variableMap: Map<string, { count: number; files: Set<string>; folders: Set<string> }>;
    }
  ) {
    const { functionMap, classMap, importMap, variableMap } = maps;

    // Language-specific patterns
    if (file.language === 'typescript' || file.language === 'javascript') {
      // Functions: function name() {}, const name = () => {}, async function name()
      const functionPatterns = [
        /(?:function\s+|const\s+|let\s+|var\s+)(\w+)(?:\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)|\s*\([^)]*\)\s*{)/g,
        /(?:async\s+)?function\s+(\w+)/g,
        /(\w+)\s*:\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/g,
      ];

      functionPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          this.addToMap(functionMap, match[1], file.relPath, folder);
        }
      });

      // Classes: class Name {}, export class Name
      const classPattern = /(?:export\s+)?class\s+(\w+)/g;
      let match;
      while ((match = classPattern.exec(content)) !== null) {
        this.addToMap(classMap, match[1], file.relPath, folder);
      }

      // Imports: import X from 'Y', import { X } from 'Y'
      const importPattern = /import\s+(?:\{[^}]+\}|\w+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/g;
      while ((match = importPattern.exec(content)) !== null) {
        const importName = match[1].split('/').pop() || match[1];
        this.addToMap(importMap, importName, file.relPath, folder);
      }

      // Variables: const X =, let X =, var X =
      const variablePattern = /(?:const|let|var)\s+(\w+)\s*=/g;
      while ((match = variablePattern.exec(content)) !== null) {
        if (match[1].length > 2 && !match[1].startsWith('_')) {
          // Filter out short/private vars
          this.addToMap(variableMap, match[1], file.relPath, folder);
        }
      }
    }

    // Python patterns
    if (file.language === 'python') {
      // Functions: def name():
      const functionPattern = /def\s+(\w+)\s*\(/g;
      let match;
      while ((match = functionPattern.exec(content)) !== null) {
        this.addToMap(functionMap, match[1], file.relPath, folder);
      }

      // Classes: class Name:
      const classPattern = /class\s+(\w+)(?:\([^)]*\))?\s*:/g;
      while ((match = classPattern.exec(content)) !== null) {
        this.addToMap(classMap, match[1], file.relPath, folder);
      }

      // Imports: import X, from X import Y
      const importPattern = /(?:import\s+(\w+)|from\s+(\w+)\s+import)/g;
      while ((match = importPattern.exec(content)) !== null) {
        const importName = match[1] || match[2];
        this.addToMap(importMap, importName, file.relPath, folder);
      }
    }
  }

  /**
   * Add item to frequency map
   */
  private addToMap(
    map: Map<string, { count: number; files: Set<string>; folders: Set<string> }>,
    item: string,
    file: string,
    folder: string
  ) {
    if (!map.has(item)) {
      map.set(item, { count: 0, files: new Set(), folders: new Set() });
    }
    const entry = map.get(item)!;
    entry.count++;
    entry.files.add(file);
    entry.folders.add(folder);
  }

  /**
   * Convert map to WordFrequency array with filtering for generic/common symbols
   */
  private mapToWordFrequency(
    map: Map<string, { count: number; files: Set<string>; folders: Set<string> }>
  ): WordFrequency[] {
    // Expanded filter for generic/common words that are less informative
    const genericWords = new Set([
      // Basic verbs and prepositions
      'to',
      'name',
      'get',
      'set',
      'on',
      'off',
      'is',
      'has',
      'can',
      'will',
      'should',
      'do',
      'go',
      'up',
      'run',
      'end',
      'add',
      'new',
      'old',
      'out',
      'in',
      'at',
      'it',
      'id',
      'key',
      'value',
      'data',
      'info',
      'item',
      'list',
      'map',
      'set',
      'obj',
      'fn',
      'cb',
      'err',
      'res',
      'req',
      'tmp',
      'temp',
      'log',
      'console',
      'debug',
      'warn',
      'error',
      'info',
      // Common test-related names
      'test',
      'spec',
      'mock',
      'describe',
      'it',
      'expect',
      'assert',
      'should',
      'before',
      'after',
      'setup',
      'teardown',
      // Generic variable names
      'result',
      'results',
      'output',
      'input',
      'args',
      'params',
      'options',
      'config',
      'settings',
      'path',
      'file',
      'dir',
      'folder',
      'text',
      'content',
      'message',
      'msg',
      'str',
      'num',
      'arr',
      'val',
      'var',
      'env',
      'ctx',
      'context',
      'state',
      'props',
      'index',
      'idx',
      'length',
      'len',
      'size',
      'count',
      'total',
      'sum',
      'max',
      'min',
      'first',
      'last',
      'next',
      'prev',
      'current',
      'previous',
      'payload',
      'response',
      'request',
      'query',
      'body',
      'headers',
      'status',
      'code',
      'type',
      'kind',
      'mode',
      'flag',
      'enabled',
      'disabled',
      'valid',
      'invalid',
      'success',
      'failure',
      'failed',
      'passed',
      'true',
      'false',
      'null',
      'undefined',
      'and',
      'or',
      'not',
    ]);

    // Test-related function prefixes/patterns to filter
    const testPatterns = [
      /^test[A-Z]/,
      /^run[A-Z].*[Tt]est/,
      /^mock[A-Z]/,
      /^setup[A-Z]/,
      /^teardown[A-Z]/,
      /Test$/,
      /Mock$/,
    ];

    return Array.from(map.entries())
      .filter(([word, data]) => {
        const lower = word.toLowerCase();

        // Filter out generic words
        if (genericWords.has(lower)) return false;

        // Filter out very short words
        if (word.length <= 2) return false;

        // Filter out words starting with underscore (private)
        if (word.startsWith('_')) return false;

        // Filter out words that are all uppercase (likely constants we don't want)
        if (word === word.toUpperCase() && word.length < 6) return false;

        // Filter out test-related function names
        if (testPatterns.some(pattern => pattern.test(word))) return false;

        // Filter out symbols that only appear in test folders
        const folders = Array.from(data.folders);
        const allInTests = folders.every(f =>
          f.toLowerCase().includes('test') ||
          f.toLowerCase().includes('spec') ||
          f.toLowerCase().includes('__tests__')
        );
        if (allInTests && folders.length > 0) return false;

        return true;
      })
      .map(([word, data]) => {
        const folders = Array.from(data.folders);

        // Calculate relevance score: production code > test code
        const testFolderCount = folders.filter(f =>
          f.toLowerCase().includes('test') ||
          f.toLowerCase().includes('spec') ||
          f.toLowerCase().includes('__tests__')
        ).length;

        const productionScore = folders.length - testFolderCount;

        return {
          word,
          count: data.count,
          files: Array.from(data.files),
          folders,
          _score: productionScore * 10 + data.count, // Weight production code 10x
        };
      })
      .sort((a, b) => (b._score || 0) - (a._score || 0))
      .map(({ _score, ...rest }) => rest); // Remove internal score field
  }

  /**
   * Analyze folder structure and generate intelligent hints
   */
  private async analyzeFolderStructure(
    files: FileInfo[],
    useAI: boolean
  ): Promise<Record<string, FolderHint>> {
    const folderMap = new Map<string, FileInfo[]>();

    // Group files by folder
    for (const file of files) {
      const folder = path.dirname(file.relPath);
      if (!folderMap.has(folder)) {
        folderMap.set(folder, []);
      }
      folderMap.get(folder)!.push(file);
    }

    const folderHints: Record<string, FolderHint> = {};

    for (const [folderPath, folderFiles] of folderMap) {
      if (folderPath === '.' || folderFiles.length < 2) continue;

      const hint = await this.analyzeSingleFolder(folderPath, folderFiles, useAI);
      if (hint) {
        folderHints[folderPath] = hint;
      }
    }

    return folderHints;
  }

  /**
   * Analyze a single folder to determine its purpose
   */
  private async analyzeSingleFolder(
    folderPath: string,
    files: FileInfo[],
    useAI: boolean
  ): Promise<FolderHint | null> {
    // Basic pattern-based analysis
    const folderName = path.basename(folderPath).toLowerCase();
    const fileTypes = [...new Set(files.map(f => f.ext))];
    const languages = [...new Set(files.map(f => f.language))];

    // Pattern-based folder purpose detection
    let purpose = '';
    let keywords: string[] = [];
    let confidence = 0.7;

    // Common folder patterns (expanded with more patterns)
    if (folderName.includes('api') || folderName.includes('route')) {
      purpose = 'API endpoints and routing logic';
      keywords = ['routes', 'endpoints', 'handlers', 'middleware'];
      confidence = 0.9;
    } else if (folderName.includes('component')) {
      purpose = 'UI components and reusable elements';
      keywords = ['components', 'ui', 'props', 'render'];
      confidence = 0.9;
    } else if (folderName.includes('service')) {
      purpose = 'Business logic and external service integrations';
      keywords = ['services', 'business logic', 'integrations'];
      confidence = 0.85;
    } else if (folderName.includes('test') || folderName.includes('spec')) {
      purpose = 'Test files and testing utilities';
      keywords = ['tests', 'specs', 'mocks', 'fixtures'];
      confidence = 0.95;
    } else if (folderName.includes('util') || folderName.includes('helper')) {
      purpose = 'Utility functions and helper modules';
      keywords = ['utilities', 'helpers', 'common'];
      confidence = 0.8;
    } else if (folderName.includes('config')) {
      purpose = 'Configuration files and settings';
      keywords = ['configuration', 'settings', 'environment'];
      confidence = 0.9;
    } else if (folderName.includes('model') || folderName.includes('schema')) {
      purpose = 'Data models and schema definitions';
      keywords = ['models', 'schemas', 'data structures'];
      confidence = 0.85;
    } else if (folderName.includes('tool')) {
      purpose = 'Tool implementations and command handlers';
      keywords = ['tools', 'commands', 'operations'];
      confidence = 0.85;
    } else if (folderName.includes('core')) {
      purpose = 'Core functionality and business logic';
      keywords = ['core', 'engine', 'foundation'];
      confidence = 0.85;
    } else if (folderName.includes('runtime')) {
      purpose = 'Runtime components and execution logic';
      keywords = ['runtime', 'execution', 'engine'];
      confidence = 0.85;
    } else if (folderName.includes('client') || folderName.includes('consumer')) {
      purpose = 'Client interfaces and API consumers';
      keywords = ['client', 'consumer', 'api calls'];
      confidence = 0.8;
    } else if (folderName.includes('middleware')) {
      purpose = 'Middleware and request processing';
      keywords = ['middleware', 'interceptors', 'processors'];
      confidence = 0.85;
    } else if (folderName.includes('controller')) {
      purpose = 'Controllers and request handlers';
      keywords = ['controllers', 'handlers', 'endpoints'];
      confidence = 0.85;
    } else if (folderName.includes('repository') || folderName.includes('repo')) {
      purpose = 'Data access layer and repositories';
      keywords = ['repositories', 'data access', 'persistence'];
      confidence = 0.85;
    } else if (folderName.includes('view') || folderName.includes('page')) {
      purpose = 'Views and page components';
      keywords = ['views', 'pages', 'ui'];
      confidence = 0.85;
    } else if (folderName.includes('hook')) {
      purpose = 'React hooks and custom logic';
      keywords = ['hooks', 'react', 'state management'];
      confidence = 0.85;
    } else if (folderName.includes('store') || folderName.includes('state')) {
      purpose = 'State management and data stores';
      keywords = ['state', 'store', 'redux', 'data management'];
      confidence = 0.85;
    } else if (folderName.includes('type')) {
      purpose = 'Type definitions and interfaces';
      keywords = ['types', 'interfaces', 'definitions'];
      confidence = 0.85;
    } else if (folderName.includes('constant')) {
      purpose = 'Constants and configuration values';
      keywords = ['constants', 'config', 'static values'];
      confidence = 0.85;
    } else if (folderName.includes('script')) {
      purpose = 'Scripts and automation utilities';
      keywords = ['scripts', 'automation', 'build'];
      confidence = 0.8;
    } else if (folderName.includes('lib') || folderName.includes('library')) {
      purpose = 'Library code and shared modules';
      keywords = ['library', 'shared', 'modules'];
      confidence = 0.8;
    } else if (folderName.includes('adapter') || folderName.includes('provider')) {
      purpose = 'Adapters and external service providers';
      keywords = ['adapters', 'providers', 'integrations'];
      confidence = 0.85;
    } else if (folderName.includes('formatter') || folderName.includes('format')) {
      purpose = 'Data formatters and output processors';
      keywords = ['formatters', 'processors', 'output'];
      confidence = 0.85;
    } else if (folderName.includes('analyzer') || folderName.includes('analysis')) {
      purpose = 'Code analysis and processing logic';
      keywords = ['analyzers', 'analysis', 'processing'];
      confidence = 0.85;
    }

    // Enhance confidence using file content analysis if confidence is low or purpose is unclear
    // Always try content analysis first before AI or fallback
    if (!purpose || confidence < 0.7) {
      try {
        const contentAnalysis = await this.analyzeContentForConfidence(files, folderName);
        if (contentAnalysis.purpose) {
          purpose = contentAnalysis.purpose;
          keywords = [...keywords, ...contentAnalysis.keywords];
          confidence = Math.max(confidence, contentAnalysis.confidence);
        }
      } catch (error) {
        logger.warn('Content analysis failed for folder', {
          folderPath,
          error: (error as Error).message,
        });
      }
    }

    // Use AI enhancement if available and purpose is still unclear
    if (useAI && this.openaiService && (confidence < 0.8 || !purpose)) {
      try {
        const aiAnalysis = await this.analyzeWithAI(folderPath, files);
        if (aiAnalysis) {
          purpose = aiAnalysis.purpose || purpose;
          keywords = [...keywords, ...aiAnalysis.keywords];
          confidence = Math.max(confidence, aiAnalysis.confidence);
        }
      } catch (error) {
        logger.warn('AI analysis failed for folder', {
          folderPath,
          error: (error as Error).message,
        });
      }
    }

    // Intelligent fallback for unclear folders based on folder name patterns
    if (!purpose) {
      // Try to infer from folder name segments
      const inferredPurpose = this.inferPurposeFromName(folderName);
      if (inferredPurpose) {
        purpose = inferredPurpose.purpose;
        keywords = [...keywords, ...inferredPurpose.keywords];
        confidence = inferredPurpose.confidence;
      } else {
        // Final fallback: use a more descriptive generic message
        const langDisplay = languages.length > 0 ? languages.join('/') : 'code';
        purpose = `${this.capitalize(folderName)} - ${langDisplay} files (${files.length} files)`;
        keywords = [folderName, ...languages];
        confidence = 0.4;
      }
    }

    return {
      purpose,
      keywords: [...new Set(keywords)],
      fileTypes,
      confidence,
      fileCount: files.length,
    };
  }

  /**
   * Use OpenAI service for intelligent folder analysis with enhanced content
   * @improvement: Now includes actual code content instead of just file names for better AI analysis
   */
  private async analyzeWithAI(
    folderPath: string,
    files: FileInfo[]
  ): Promise<{
    purpose: string;
    keywords: string[];
    confidence: number;
  } | null> {
    if (!this.openaiService) return null;

    // Get file names and sample key content for better analysis
    const fileNames = files.slice(0, 10).map(f => path.basename(f.relPath));
    const keyContent = await this.sampleKeyContent(files);

    const prompt = `Analyze this code folder:

Folder: ${folderPath}
Files: ${fileNames.join(', ')}

${
  keyContent
    ? `Key Code Content:
${keyContent}
`
    : ''
}Determine the folder's purpose in 1-2 sentences. Focus on:
- What type of code lives here
- How it fits in the application architecture
- Key responsibilities
- Patterns and architectural decisions visible in the code

Return JSON:
{
  "purpose": "brief description",
  "keywords": ["key", "terms", "related"],
  "confidence": 0.8
}`;

    try {
      const response = await this.openaiService.createChatCompletion({
        model: this.getHintsModel(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 1,
      });

      let content = response.choices[0].message.content || '{}';

      // Extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
      if (jsonMatch) {
        content = jsonMatch[1].trim();
      }

      const result = JSON.parse(content);
      return result;
    } catch (error) {
      logger.warn('AI analysis failed', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Sample key content from files for AI analysis
   */
  private async sampleKeyContent(files: FileInfo[]): Promise<string | null> {
    try {
      // Select the most informative files (limit to 3-5 files to avoid token limits)
      const keyFiles = this.selectKeyFilesForAnalysis(files).slice(0, 3);

      if (keyFiles.length === 0) {
        return null;
      }

      let totalContent = '';
      const maxContentSize = 3000; // Limit total content size

      for (const file of keyFiles) {
        if (totalContent.length > maxContentSize) break;

        try {
          const content = await readFile(file.absPath, 'utf-8');
          const sampledContent = this.extractKeySnippets(content, file.language);

          if (sampledContent) {
            const fileHeader = `\n=== ${path.basename(file.relPath)} ===\n`;
            const remainingSpace = maxContentSize - totalContent.length - fileHeader.length;

            if (remainingSpace > 100) {
              totalContent += fileHeader + sampledContent.substring(0, remainingSpace) + '\n';
            }
          }
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }

      return totalContent.trim() || null;
    } catch (error) {
      logger.warn('Failed to sample key content for AI analysis', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Select the most informative files for AI analysis
   */
  private selectKeyFilesForAnalysis(files: FileInfo[]): FileInfo[] {
    // Prioritize files by importance indicators
    return files
      .filter(file => {
        const name = path.basename(file.relPath).toLowerCase();
        // Include files that are likely to be informative
        return (
          name.includes('index') ||
          name.includes('main') ||
          name.includes('service') ||
          name.includes('util') ||
          name.includes('helper') ||
          file.size > 5000 || // Larger files are likely more informative
          ['package.json', 'tsconfig.json', 'README.md'].includes(name)
        );
      })
      .sort((a, b) => {
        // Sort by relevance for analysis
        const aScore = this.getFileAnalysisScore(a);
        const bScore = this.getFileAnalysisScore(b);
        return bScore - aScore;
      });
  }

  /**
   * Get analysis score for a file (higher = more informative)
   */
  private getFileAnalysisScore(file: FileInfo): number {
    let score = 0;
    const name = path.basename(file.relPath).toLowerCase();

    // Boost score for key files
    if (name.includes('index')) score += 10;
    if (name.includes('main')) score += 10;
    if (name.includes('service')) score += 8;
    if (name.includes('util') || name.includes('helper')) score += 6;

    // Boost score for configuration files
    if (['package.json', 'tsconfig.json', 'README.md'].includes(name)) score += 15;

    // Boost score for larger files (likely more comprehensive)
    if (file.size > 10000) score += 5;
    if (file.size > 50000) score += 10;

    return score;
  }

  /**
   * Extract key code snippets from file content
   */
  private extractKeySnippets(content: string, language: string): string {
    const lines = content.split('\n');
    const snippets: string[] = [];

    // Language-specific extraction patterns
    if (language === 'typescript' || language === 'javascript') {
      // Extract imports, interfaces, classes, and key functions
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Include import statements
        if (line.startsWith('import ')) {
          snippets.push(line);
          continue;
        }

        // Include interface/type definitions
        if (
          line.startsWith('interface ') ||
          line.startsWith('type ') ||
          line.startsWith('export interface') ||
          line.startsWith('export type')
        ) {
          // Include the definition and a few following lines
          for (let j = i; j < Math.min(i + 10, lines.length); j++) {
            snippets.push(lines[j]);
            if (lines[j].includes('}')) break;
          }
          i += 9; // Skip ahead
          continue;
        }

        // Include class definitions
        if (line.startsWith('class ') || line.startsWith('export class')) {
          // Include the class definition and key methods
          for (let j = i; j < Math.min(i + 15, lines.length); j++) {
            snippets.push(lines[j]);
            if (lines[j].includes('}')) break;
          }
          i += 14; // Skip ahead
          continue;
        }

        // Include function definitions
        if (
          (line.includes('function ') || line.includes('const ') || line.includes('async ')) &&
          (line.includes('=') || line.includes('('))
        ) {
          // Include function signature and start of body
          snippets.push(line);
          if (i + 1 < lines.length && lines[i + 1].includes('{')) {
            snippets.push(lines[i + 1]);
            i++; // Skip the opening brace line
          }
          continue;
        }

        // Include key constants and exports
        if (
          line.startsWith('export const') ||
          line.startsWith('export function') ||
          line.includes('const ')
        ) {
          snippets.push(line);
          continue;
        }
      }
    } else if (language === 'python') {
      // Extract imports, classes, and functions
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Include imports
        if (line.startsWith('import ') || line.startsWith('from ')) {
          snippets.push(line);
          continue;
        }

        // Include class definitions
        if (line.startsWith('class ')) {
          for (let j = i; j < Math.min(i + 10, lines.length); j++) {
            snippets.push(lines[j]);
            if (lines[j].includes(':')) break;
          }
          i += 9;
          continue;
        }

        // Include function definitions
        if (line.startsWith('def ')) {
          snippets.push(line);
          continue;
        }
      }
    }

    // Limit total snippet size and return
    const maxSnippetSize = 1000;
    const result = snippets.slice(0, 20).join('\n'); // Limit lines
    return result.length > maxSnippetSize ? result.substring(0, maxSnippetSize) + '...' : result;
  }

  /**
   * Capitalize first letter of a string
   */
  private capitalize(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Infer folder purpose from name patterns when other methods fail
   */
  private inferPurposeFromName(
    folderName: string
  ): { purpose: string; keywords: string[]; confidence: number } | null {
    const lower = folderName.toLowerCase();

    // Try to identify key terms in the folder name
    const terms = lower.split(/[_\-\/\\]/);

    // Check for common suffixes/patterns
    if (terms.some(t => ['tools', 'tool'].includes(t))) {
      return {
        purpose: 'Tool implementations and utilities',
        keywords: ['tools', 'utilities'],
        confidence: 0.65,
      };
    }

    if (terms.some(t => ['local', 'remote', 'cloud'].includes(t))) {
      return {
        purpose: `${this.capitalize(terms.find(t => ['local', 'remote', 'cloud'].includes(t))!)} modules and implementations`,
        keywords: terms,
        confidence: 0.6,
      };
    }

    if (terms.some(t => ['debug', 'debugger'].includes(t))) {
      return {
        purpose: 'Debugging utilities and development tools',
        keywords: ['debug', 'development'],
        confidence: 0.7,
      };
    }

    if (terms.some(t => ['common', 'shared'].includes(t))) {
      return {
        purpose: 'Shared code and common utilities',
        keywords: ['shared', 'common'],
        confidence: 0.65,
      };
    }

    if (terms.some(t => ['index', 'main'].includes(t))) {
      return {
        purpose: 'Entry points and module exports',
        keywords: ['entry', 'exports'],
        confidence: 0.6,
      };
    }

    if (terms.some(t => ['ai', 'ml', 'llm'].includes(t))) {
      return {
        purpose: 'AI/ML functionality and integrations',
        keywords: ['ai', 'machine learning'],
        confidence: 0.75,
      };
    }

    if (terms.some(t => ['auth', 'authentication', 'authorization'].includes(t))) {
      return {
        purpose: 'Authentication and authorization logic',
        keywords: ['auth', 'security'],
        confidence: 0.8,
      };
    }

    if (terms.some(t => ['db', 'database', 'data'].includes(t))) {
      return {
        purpose: 'Database operations and data management',
        keywords: ['database', 'data'],
        confidence: 0.75,
      };
    }

    if (terms.some(t => ['embed', 'embedding', 'embeddings'].includes(t))) {
      return {
        purpose: 'Embedding generation and management',
        keywords: ['embeddings', 'vectors'],
        confidence: 0.8,
      };
    }

    if (terms.some(t => ['compactor', 'compact'].includes(t))) {
      return {
        purpose: 'Code compaction and compression utilities',
        keywords: ['compaction', 'compression'],
        confidence: 0.75,
      };
    }

    if (terms.some(t => ['skill', 'skills'].includes(t))) {
      return {
        purpose: 'Skill definitions and templates',
        keywords: ['skills', 'capabilities'],
        confidence: 0.75,
      };
    }

    // If folder name suggests a feature/domain, use that
    if (terms.length > 0 && terms[0].length > 3) {
      return {
        purpose: `${this.capitalize(terms.join(' '))} functionality`,
        keywords: terms,
        confidence: 0.5,
      };
    }

    return null;
  }

  /**
   * Analyze file content to improve confidence scores
   */
  private async analyzeContentForConfidence(
    files: FileInfo[],
    folderName: string
  ): Promise<{
    purpose: string;
    keywords: string[];
    confidence: number;
  }> {
    // Use the same key file selection logic for consistency
    const keyFiles = this.selectKeyFilesForAnalysis(files).slice(0, 3);

    const fileContents = await Promise.all(
      keyFiles.map(async f => {
        try {
          return await readFile(f.absPath, 'utf-8');
        } catch {
          return '';
        }
      })
    );

    const contentKeywords = this.extractContentKeywords(fileContents);
    let purpose = '';
    let keywords: string[] = [];
    let confidence = 0.5;

    // Content-based pattern detection
    if (
      contentKeywords.includes('test') ||
      contentKeywords.includes('spec') ||
      contentKeywords.includes('describe') ||
      contentKeywords.includes('expect')
    ) {
      purpose = 'Test files and testing utilities';
      keywords = ['tests', 'specs', 'unit tests', 'integration tests'];
      confidence = 0.95;
    } else if (
      contentKeywords.includes('api') ||
      contentKeywords.includes('endpoint') ||
      contentKeywords.includes('router') ||
      contentKeywords.includes('middleware')
    ) {
      purpose = 'API endpoints and routing logic';
      keywords = ['api', 'routes', 'endpoints', 'handlers'];
      confidence = 0.9;
    } else if (
      contentKeywords.includes('component') ||
      contentKeywords.includes('react') ||
      contentKeywords.includes('props') ||
      contentKeywords.includes('jsx')
    ) {
      purpose = 'UI components and React elements';
      keywords = ['components', 'ui', 'react', 'frontend'];
      confidence = 0.85;
    } else if (
      contentKeywords.includes('model') ||
      contentKeywords.includes('schema') ||
      contentKeywords.includes('database') ||
      contentKeywords.includes('table')
    ) {
      purpose = 'Data models and database schemas';
      keywords = ['models', 'schemas', 'database', 'entities'];
      confidence = 0.85;
    } else if (
      contentKeywords.includes('util') ||
      contentKeywords.includes('helper') ||
      contentKeywords.includes('common') ||
      contentKeywords.includes('shared')
    ) {
      purpose = 'Utility functions and helper modules';
      keywords = ['utilities', 'helpers', 'common functions'];
      confidence = 0.8;
    } else if (
      contentKeywords.includes('config') ||
      contentKeywords.includes('setting') ||
      contentKeywords.includes('environment') ||
      contentKeywords.includes('env')
    ) {
      purpose = 'Configuration files and settings';
      keywords = ['configuration', 'settings', 'environment'];
      confidence = 0.9;
    } else if (
      contentKeywords.includes('service') ||
      contentKeywords.includes('business') ||
      contentKeywords.includes('logic') ||
      contentKeywords.includes('class')
    ) {
      purpose = 'Business logic and service layer';
      keywords = ['services', 'business logic', 'application layer'];
      confidence = 0.75;
    } else if (
      folderName.includes('tool') ||
      folderName.includes('script') ||
      contentKeywords.includes('cli') ||
      contentKeywords.includes('command')
    ) {
      purpose = 'Tools and utility scripts';
      keywords = ['tools', 'scripts', 'utilities', 'automation'];
      confidence = 0.8;
    }

    return { purpose, keywords, confidence };
  }

  /**
   * Extract keywords from file contents for pattern matching
   */
  private extractContentKeywords(contents: string[]): string[] {
    const keywords = new Set<string>();
    const patterns = [
      { regex: /test|spec|describe|expect|jest|mocha|chai/i, word: 'test' },
      { regex: /api|endpoint|route|router|middleware|express|fastify/i, word: 'api' },
      { regex: /component|react|jsx|tsx|props|state|render/i, word: 'component' },
      { regex: /model|schema|database|table|entity|sequelize|mongoose/i, word: 'model' },
      { regex: /util|helper|common|shared|library/i, word: 'util' },
      { regex: /config|setting|environment|env|constant/i, word: 'config' },
      { regex: /service|business|logic|class|interface/i, word: 'service' },
      { regex: /tool|script|cli|command|automation/i, word: 'tool' },
      { regex: /types|interface|enum|definition/i, word: 'types' },
    ];

    contents.forEach(content => {
      if (content) {
        patterns.forEach(({ regex, word }) => {
          if (regex.test(content)) {
            keywords.add(word);
          }
        });
      }
    });

    return Array.from(keywords);
  }

  /**
   * Detect architecture patterns from files and imports
   */
  private detectArchitecturePatterns(files: FileInfo[], symbolMaps: SymbolMaps): string[] {
    const patterns = new Set<string>();

    // Check package.json and imports for frameworks
    const allImports = symbolMaps.imports.map((imp: WordFrequency) => imp.word.toLowerCase());
    const normalizedImports = allImports.map(imp => imp.toLowerCase());
    const hasImport = (...candidates: string[]) =>
      normalizedImports.some(imp =>
        candidates.some(candidate => imp.includes(candidate.toLowerCase()))
      );

    // Web frameworks
    if (hasImport('express')) patterns.add('express');
    if (hasImport('fastify')) patterns.add('fastify');
    if (hasImport('next')) patterns.add('nextjs');
    if (hasImport('react')) patterns.add('react');
    if (hasImport('vue')) patterns.add('vue');

    // ORMs & query builders
    if (
      hasImport('prisma', 'schema.prisma') ||
      files.some(f => f.relPath.toLowerCase().includes('schema.prisma'))
    )
      patterns.add('prisma');
    if (hasImport('drizzle-orm', 'drizzle')) patterns.add('drizzle');
    if (hasImport('typeorm')) patterns.add('typeorm');
    if (hasImport('sequelize')) patterns.add('sequelize');
    if (hasImport('knex')) patterns.add('knex');
    if (hasImport('kysely')) patterns.add('kysely');
    if (hasImport('objection')) patterns.add('objection');
    if (
      patterns.has('prisma') ||
      patterns.has('drizzle') ||
      patterns.has('typeorm') ||
      patterns.has('sequelize') ||
      patterns.has('knex') ||
      patterns.has('kysely') ||
      patterns.has('objection')
    ) {
      patterns.add('orm');
    }

    // Databases & storage engines
    if (hasImport('postgres', 'pg', 'supabase-js')) patterns.add('postgresql');
    if (hasImport('mongo', 'mongoose')) patterns.add('mongodb');
    if (hasImport('redis', 'ioredis', 'redis-om')) patterns.add('redis');
    if (hasImport('supabase')) patterns.add('supabase');
    if (hasImport('dynamodb', 'lib-dynamodb', '@aws-sdk/lib-dynamodb')) patterns.add('dynamodb');
    if (hasImport('firestore', '@google-cloud/firestore', 'firebase')) patterns.add('firestore');
    if (hasImport('fauna')) patterns.add('faunadb');
    if (hasImport('planetscale')) patterns.add('planetscale');
    if (hasImport('cassandra')) patterns.add('cassandra');
    if (hasImport('couchdb', 'pouchdb')) patterns.add('couchdb');

    // Graph & vector databases
    if (hasImport('neo4j', 'gremlin')) patterns.add('graph-db');
    if (hasImport('arangodb')) patterns.add('arangodb');
    if (hasImport('dgraph')) patterns.add('dgraph');
    if (
      hasImport(
        'pinecone',
        'weaviate',
        'qdrant',
        'chromadb',
        'chroma',
        'milvus',
        'meilisearch',
        'typesense',
        'faiss'
      )
    ) {
      patterns.add('vector-db');
    }
    if (hasImport('pinecone')) patterns.add('pinecone');
    if (hasImport('weaviate')) patterns.add('weaviate');
    if (hasImport('qdrant', 'js-client-rest')) patterns.add('qdrant');
    if (hasImport('chromadb', 'chroma')) patterns.add('chroma');
    if (hasImport('milvus')) patterns.add('milvus');
    if (hasImport('meilisearch')) patterns.add('meilisearch');
    if (hasImport('typesense')) patterns.add('typesense');

    // Offline/local storage
    if (hasImport('localforage', 'localforage')) patterns.add('localforage');
    if (hasImport('dexie')) patterns.add('indexeddb');
    if (hasImport('idb')) patterns.add('indexeddb');
    if (hasImport('asyncstorage', '@react-native-async-storage')) patterns.add('async-storage');
    if (hasImport('expo-secure-store', 'securestore')) patterns.add('secure-store');
    if (hasImport('realm')) patterns.add('realm');
    if (hasImport('nedb')) patterns.add('nedb');
    if (hasImport('lowdb')) patterns.add('lowdb');

    // Other patterns
    if (hasImport('docker')) patterns.add('docker');
    if (hasImport('openai')) patterns.add('openai');
    if (files.some(f => f.relPath.includes('package.json'))) patterns.add('nodejs');
    if (files.some(f => f.relPath.includes('requirements.txt'))) patterns.add('python');
    if (files.some(f => f.relPath.includes('go.mod'))) patterns.add('golang');

    return Array.from(patterns);
  }

  /**
   * Extract domain-specific keywords
   */
  private extractDomainKeywords(_files: FileInfo[], symbolMaps: SymbolMaps): string[] {
    const keywords = new Set<string>();

    // Extract from function names and variables
    const allWords = [
      ...symbolMaps.functions.map((f: WordFrequency) => f.word),
      ...symbolMaps.variables.map((v: WordFrequency) => v.word),
      ...symbolMaps.classes.map((c: WordFrequency) => c.word),
    ];

    // Domain pattern matching
    const domainPatterns = {
      auth: /auth|login|token|jwt|session|password|oauth/i,
      api: /api|endpoint|route|handler|controller/i,
      database: /db|database|model|schema|query|sql/i,
      user: /user|account|profile|member/i,
      file: /file|upload|download|storage|blob/i,
      email: /email|mail|smtp|notification/i,
      payment: /payment|billing|stripe|charge|invoice/i,
      admin: /admin|dashboard|management|control/i,
      search: /search|index|query|filter|sort/i,
      cache: /cache|redis|memory|store/i,
    };

    for (const word of allWords) {
      for (const [domain, pattern] of Object.entries(domainPatterns)) {
        if (pattern.test(word)) {
          keywords.add(domain);
          break;
        }
      }
    }

    return Array.from(keywords);
  }

  /**
   * Get primary programming languages by file count
   */
  private getPrimaryLanguages(files: FileInfo[]): string[] {
    const langCounts = files.reduce(
      (acc, file) => {
        acc[file.language] = (acc[file.language] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return Object.entries(langCounts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([lang]) => lang);
  }

  /**
   * Find entry point files
   */
  private findEntryPoints(files: FileInfo[]): string[] {
    const entryPatterns = [
      /index\.(ts|js|py)$/,
      /main\.(ts|js|py)$/,
      /app\.(ts|js|py)$/,
      /server\.(ts|js)$/,
      /__main__\.py$/,
    ];

    return files
      .filter(file => entryPatterns.some(pattern => pattern.test(file.relPath)))
      .map(file => file.relPath)
      .slice(0, 10);
  }

  /**
   * Find configuration files
   */
  private findConfigFiles(files: FileInfo[]): string[] {
    const configPatterns = [
      /package\.json$/,
      /tsconfig\.json$/,
      /\.env/,
      /config\./,
      /settings\./,
      /Cargo\.toml$/,
      /go\.mod$/,
      /requirements\.txt$/,
    ];

    return files
      .filter(file => configPatterns.some(pattern => pattern.test(file.relPath)))
      .map(file => file.relPath);
  }

  /**
   * Find documentation files
   */
  private findDocumentationFiles(files: FileInfo[]): string[] {
    const docPatterns = [/README/i, /CHANGELOG/i, /\.md$/, /docs?\//i, /CONTRIBUTING/i, /LICENSE/i];

    return files
      .filter(file => docPatterns.some(pattern => pattern.test(file.relPath)))
      .map(file => file.relPath)
      .slice(0, 20);
  }

  /**
   * Format file size in human readable format
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Find key files in a folder based on importance
   */
  private findKeyFiles(files: FileInfo[]): string[] {
    return files
      .filter(file => {
        // Include entry points, large files, or important config files
        return (
          file.relPath.includes('index') ||
          file.relPath.includes('main') ||
          file.relPath.includes('app') ||
          file.relPath.includes('server') ||
          file.relPath.includes('config') ||
          file.size > 10000 || // Files larger than 10KB
          ['package.json', 'tsconfig.json', 'Dockerfile', 'README.md'].includes(
            path.basename(file.relPath)
          )
        );
      })
      .sort((a, b) => b.size - a.size)
      .slice(0, 10)
      .map(file => file.relPath);
  }

  /**
   * Analyze folder dependencies (imports/exports)
   */
  private async analyzeFolderDependencies(
    files: FileInfo[]
  ): Promise<{ imports: string[]; exports: string[] }> {
    const imports = new Set<string>();
    const exports = new Set<string>();

    for (const file of files.slice(0, 20)) {
      // Limit to avoid performance issues
      try {
        const content = await readFile(file.absPath, 'utf-8');

        // Extract import statements
        const importMatches = content.match(
          /import\s+(?:\{[^}]+\}|\w+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/g
        );
        if (importMatches) {
          importMatches.forEach(match => {
            const importPath = match.match(/from\s+['"]([^'"]+)['"]/)?.[1];
            if (importPath && !importPath.startsWith('.')) {
              imports.add(importPath);
            }
          });
        }

        // Extract export statements
        const exportMatches = content.match(/export\s+(?:\{[^}]+\}|\*)\s+from\s+['"]([^'"]+)['"]/g);
        if (exportMatches) {
          exportMatches.forEach(match => {
            const exportPath = match.match(/from\s+['"]([^'"]+)['"]/)?.[1];
            if (exportPath && !exportPath.startsWith('.')) {
              exports.add(exportPath);
            }
          });
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }

    return {
      imports: Array.from(imports).slice(0, 20),
      exports: Array.from(exports).slice(0, 20),
    };
  }

  /**
   * Generate AI-powered documentation for a folder
   */
  private async generateAIDocumentation(
    folderPath: string,
    files: FileInfo[],
    hint: FolderHint,
    symbolMaps: SymbolMaps
  ): Promise<string> {
    if (!this.openaiService) return '';

    const keySymbols = [
      ...symbolMaps.functions.slice(0, 5).map((f: WordFrequency) => `function ${f.word}`),
      ...symbolMaps.classes.slice(0, 3).map((c: WordFrequency) => `class ${c.word}`),
    ].join(', ');

    const prompt = `Generate documentation for this code folder:

Folder: ${folderPath}
Purpose: ${hint.purpose}
Files: ${files.length}
Key Symbols: ${keySymbols}
File Types: ${hint.fileTypes.join(', ')}

Write 2-3 paragraphs describing:
1. What this folder does and its role in the project
2. Key components and their relationships
3. How it fits into the overall architecture

Be technical but accessible.`;

    try {
      const response = await this.openaiService.createChatCompletion({
        model: this.getHintsModel(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 1,
      });

      return response.choices[0].message.content || '';
    } catch (error) {
      logger.warn('AI documentation generation failed', {
        error: (error as Error).message,
      });
      return '';
    }
  }

  /**
   * Generate basic documentation fallback
   */
  private generateBasicDocumentation(
    folderPath: string,
    files: FileInfo[],
    hint?: FolderHint
  ): string {
    const languages = [...new Set(files.map(f => f.language))];
    const purpose = hint?.purpose || 'Code directory';

    return (
      `This folder (${folderPath}) contains ${files.length} files and serves as ${purpose.toLowerCase()}. ` +
      `The primary languages used are ${languages.join(', ')}. ` +
      `Key files include ${files
        .slice(0, 3)
        .map(f => path.basename(f.relPath))
        .join(', ')}.`
    );
  }

  /**
   * Format project hints as Markdown
   */
  private formatAsMarkdown(hints: ProjectHints | ProjectHintsWithEvidence): string {
    // Type guard to ensure we have the required properties
    const hasBasicProperties = (h: any): h is ProjectHints =>
      'primaryLanguages' in h &&
      'architectureKeywords' in h &&
      'domainKeywords' in h &&
      'totalFiles' in h &&
      'codebaseSize' in h &&
      'folderHints' in h &&
      'entryPoints' in h &&
      'configFiles' in h &&
      'documentationFiles' in h &&
      'symbolHints' in h &&
      'lastAnalyzed' in h;

    if (!hasBasicProperties(hints)) {
      return '# 📊 Project Analysis Report\n\n⚠️ Error: Invalid hints format';
    }

    const markdown = `# 📊 Project Analysis Report

## 🏗️ Architecture Overview

- **Languages:** ${hints.primaryLanguages.join(', ')}
- **Architecture Patterns:** ${hints.architectureKeywords.join(', ')}
- **Domain Focus:** ${hints.domainKeywords.join(', ')}
- **Codebase Size:** ${hints.totalFiles} files (${hints.codebaseSize})

## 📁 Folder Structure

${Object.entries(hints.folderHints)
  .map(
    ([path, hint]: [string, any]) => `### ${path}
- **Purpose:** ${hint.purpose}
- **File Types:** ${hint.fileTypes.join(', ')}
- **Confidence:** ${Math.round(hint.confidence * 100)}%
- **Files:** ${hint.fileCount}`
  )
  .join('\n\n')}

## 🔧 Key Files

### Entry Points
${hints.entryPoints.map((file: string) => `- \`${file}\``).join('\n')}

### Configuration Files
${hints.configFiles.map((file: string) => `- \`${file}\``).join('\n')}

### Documentation
${hints.documentationFiles
  .slice(0, 10)
  .map((file: string) => `- \`${file}\``)
  .join('\n')}

## 📈 Symbol Analysis

### Top Functions
${hints.symbolHints.functions
  .slice(0, 10)
  .map((fn: any) => `- **${fn.word}** (${fn.count} occurrences)`)
  .join('\n')}

### Top Classes
${hints.symbolHints.classes
  .slice(0, 5)
  .map((cls: any) => `- **${cls.word}** (${cls.count} occurrences)`)
  .join('\n')}

### Key Imports
${hints.symbolHints.imports
  .slice(0, 10)
  .map((imp: any) => `- **${imp.word}** (${imp.count} occurrences)`)
  .join('\n')}

${this.formatEvidenceCardsAsMarkdown(hints)}

---
*Generated on ${hints.lastAnalyzed.toLocaleDateString()}*
${'retrievalMetadata' in hints ? `\n*Evidence Coverage: ${Math.round(hints.retrievalMetadata.coveragePct * 100)}% | Anchors Hit: ${hints.retrievalMetadata.anchorsHit.length} | Processing Time: ${hints.retrievalMetadata.processingTimeMs}ms*` : ''}
`;

    return markdown;
  }

  /**
   * Format evidence cards as Markdown
   */
  private formatEvidenceCardsAsMarkdown(hints: ProjectHints | ProjectHintsWithEvidence): string {
    if (!('evidenceCards' in hints) || Object.keys(hints.evidenceCards).length === 0) {
      return '';
    }

    const sections: string[] = ['\n## 🔍 Evidence & Supporting Code\n'];

    for (const [section, cards] of Object.entries(hints.evidenceCards)) {
      if (cards.length === 0) continue;

      sections.push(`### ${section.replace('_', ' ').toUpperCase()}\n`);

      cards.forEach(card => {
        const location = card.lineRange ? `${card.path}:${card.lineRange}` : card.path;

        sections.push(`- **${location}** — ${card.excerpt}`);
        sections.push(
          `  - Score: ${card.score.toFixed(3)}, Facets: [${card.facet_tags.join(', ')}]`
        );
        if (card.signals.length > 0) {
          sections.push(`  - Signals: [${card.signals.join(', ')}]`);
        }
        sections.push('');
      });
    }

    return sections.join('\n');
  }

  /**
   * Format project hints as HTML
   */
  private formatAsHTML(hints: ProjectHints | ProjectHintsWithEvidence): string {
    // Type guard to ensure we have the required properties
    const hasBasicProperties = (h: any): h is ProjectHints =>
      'primaryLanguages' in h &&
      'architectureKeywords' in h &&
      'domainKeywords' in h &&
      'totalFiles' in h &&
      'codebaseSize' in h &&
      'folderHints' in h &&
      'entryPoints' in h &&
      'configFiles' in h &&
      'documentationFiles' in h &&
      'symbolHints' in h &&
      'lastAnalyzed' in h;

    if (!hasBasicProperties(hints)) {
      return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project Analysis Report - Error</title>
</head>
<body>
    <div style="padding: 20px; color: red;">
        <h1>⚠️ Error: Invalid hints format</h1>
    </div>
</body>
</html>`;
    }
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project Analysis Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; line-height: 1.6; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }
        .section { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .folder { background: white; padding: 15px; margin: 10px 0; border-left: 4px solid #007bff; border-radius: 4px; }
        .confidence-high { border-left-color: #28a745; }
        .confidence-medium { border-left-color: #ffc107; }
        .confidence-low { border-left-color: #dc3545; }
        .symbol-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
        .symbol-item { background: white; padding: 10px; border-radius: 4px; border: 1px solid #dee2e6; }
        ul { list-style-type: none; padding: 0; }
        li { padding: 5px 0; }
        .badge { background: #007bff; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; }
        .evidence-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin-top: 10px; }
        .evidence-card { background: white; padding: 15px; border-radius: 6px; border: 1px solid #dee2e6; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .evidence-path { color: #007bff; font-family: 'Monaco', 'Menlo', monospace; margin-bottom: 8px; }
        .evidence-excerpt { color: #495057; margin-bottom: 10px; font-style: italic; }
        .evidence-meta { display: flex; flex-wrap: wrap; gap: 8px; }
        .evidence-section { margin-bottom: 30px; }
        .evidence-section h3 { color: #495057; border-bottom: 2px solid #e9ecef; padding-bottom: 5px; }
        .metadata { background: #f8f9fa; padding: 15px; border-radius: 6px; margin-top: 20px; }
        .metadata h4 { margin-top: 0; color: #495057; }
        .metadata ul { margin: 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Project Analysis Report</h1>
        <p>Generated on ${hints.lastAnalyzed.toLocaleDateString()}</p>
    </div>

    <div class="section">
        <h2>🏗️ Architecture Overview</h2>
        <ul>
            <li><strong>Languages:</strong> ${hints.primaryLanguages.join(', ')}</li>
            <li><strong>Architecture Patterns:</strong> ${hints.architectureKeywords.join(', ')}</li>
            <li><strong>Domain Focus:</strong> ${hints.domainKeywords.join(', ')}</li>
            <li><strong>Codebase Size:</strong> ${hints.totalFiles} files (${hints.codebaseSize})</li>
        </ul>
    </div>

    <div class="section">
        <h2>📁 Folder Structure</h2>
        ${Object.entries(hints.folderHints)
          .map(([path, hint]: [string, any]) => {
            const confidenceClass =
              hint.confidence > 0.8
                ? 'confidence-high'
                : hint.confidence > 0.5
                  ? 'confidence-medium'
                  : 'confidence-low';
            return `<div class="folder ${confidenceClass}">
                <h3>${path}</h3>
                <p><strong>Purpose:</strong> ${hint.purpose}</p>
                <p><strong>File Types:</strong> ${hint.fileTypes.join(', ')}</p>
                <p><strong>Confidence:</strong> <span class="badge">${Math.round(hint.confidence * 100)}%</span></p>
                <p><strong>Files:</strong> ${hint.fileCount}</p>
            </div>`;
          })
          .join('')}
    </div>

    <div class="section">
        <h2>📈 Symbol Analysis</h2>
        <div class="symbol-list">
            <div class="symbol-item">
                <h4>Top Functions</h4>
                <ul>
                    ${hints.symbolHints.functions
                      .slice(0, 10)
                      .map((fn: any) => `<li><strong>${fn.word}</strong> (${fn.count})</li>`)
                      .join('')}
                </ul>
            </div>
            <div class="symbol-item">
                <h4>Top Classes</h4>
                <ul>
                    ${hints.symbolHints.classes
                      .slice(0, 5)
                      .map((cls: any) => `<li><strong>${cls.word}</strong> (${cls.count})</li>`)
                      .join('')}
                </ul>
            </div>
            <div class="symbol-item">
                <h4>Key Imports</h4>
                <ul>
                    ${hints.symbolHints.imports
                      .slice(0, 10)
                      .map((imp: any) => `<li><strong>${imp.word}</strong> (${imp.count})</li>`)
                      .join('')}
                </ul>
            </div>
        </div>
    </div>

    ${this.formatEvidenceCardsAsHTML(hints)}
</body>
</html>`;

    return html;
  }

  /**
   * Format evidence cards as HTML
   */
  private formatEvidenceCardsAsHTML(hints: ProjectHints | ProjectHintsWithEvidence): string {
    if (!('evidenceCards' in hints) || Object.keys(hints.evidenceCards).length === 0) {
      return '';
    }

    const sections: string[] = [
      `
    <div class="section">
        <h2>🔍 Evidence & Supporting Code</h2>
    `,
    ];

    for (const [section, cards] of Object.entries(hints.evidenceCards)) {
      if (cards.length === 0) continue;

      sections.push(`
        <div class="evidence-section">
            <h3>${section.replace('_', ' ').toUpperCase()}</h3>
            <div class="evidence-cards">
      `);

      cards.forEach(card => {
        const location = card.lineRange ? `${card.path}:${card.lineRange}` : card.path;

        sections.push(`
                <div class="evidence-card">
                    <div class="evidence-path"><strong>${location}</strong></div>
                    <div class="evidence-excerpt">${card.excerpt}</div>
                    <div class="evidence-meta">
                        <span class="badge">Score: ${card.score.toFixed(3)}</span>
                        <span class="badge">Facets: ${card.facet_tags.join(', ')}</span>
                        ${card.signals.length > 0 ? `<span class="badge">Signals: ${card.signals.join(', ')}</span>` : ''}
                    </div>
                </div>
        `);
      });

      sections.push(`
            </div>
        </div>
      `);
    }

    // Add metadata if available
    if ('retrievalMetadata' in hints) {
      sections.push(`
        <div class="metadata">
            <h4>Retrieval Statistics</h4>
            <ul>
                <li><strong>Coverage:</strong> ${Math.round(hints.retrievalMetadata.coveragePct * 100)}%</li>
                <li><strong>Anchors Hit:</strong> ${hints.retrievalMetadata.anchorsHit.length}</li>
                <li><strong>Processing Time:</strong> ${hints.retrievalMetadata.processingTimeMs}ms</li>
            </ul>
        </div>
      `);
    }

    sections.push(`
    </div>
    `);

    return sections.join('\n');
  }

  /**
   * Generate a chart visualization for symbol frequency
   */
  private generateFunctionChart(functions: WordFrequency[], maxItems: number = 10): string {
    const chartData = {
      type: 'bar',
      data: {
        labels: functions.slice(0, maxItems).map(f => f.word),
        datasets: [
          {
            label: 'Function Usage Count',
            data: functions.slice(0, maxItems).map(f => f.count),
            backgroundColor: [
              '#36A2EB',
              '#FF6384',
              '#FFCE56',
              '#4BC0C0',
              '#9966FF',
              '#FF9F40',
              '#FF6384',
              '#C9CBCF',
              '#4BC0C0',
              '#36A2EB',
            ],
            borderColor: [
              '#2A8ABF',
              '#D44F6E',
              '#D4A017',
              '#3A9C9C',
              '#7A4FD6',
              '#D4851F',
              '#D44F6E',
              '#A3A6AD',
              '#3A9C9C',
              '#2A8ABF',
            ],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Usage Count' },
          },
          x: {
            title: { display: true, text: 'Function Names' },
          },
        },
        plugins: {
          title: {
            display: true,
            text: 'Top Functions by Usage',
          },
        },
      },
    };

    return JSON.stringify(chartData, null, 2);
  }

  /**
   * Dispose of resources and clean up
   */
  async dispose(): Promise<void> {
    if (this.openaiService) {
      await this.openaiService.dispose();
      this.openaiService = null;
    }
    this.useAI = false;
    logger.info('ProjectHintsGenerator disposed');
  }

  /**
   * Check if the generator is ready to use AI features
   */
  isAIReady(): boolean {
    return this.useAI && this.openaiService?.isReady() === true;
  }

  /**
   * Get provider information if available
   */
  getProviderInfo() {
    return this.openaiService?.getProviderInfo() || null;
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
}
