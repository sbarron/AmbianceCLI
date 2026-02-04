/**
 * @fileOverview: Schema loader for ast-grep language schemas
 * @module: SchemaLoader
 * @keyFunctions:
 *   - loadSchema(): Load and cache ast-grep schema for a language
 *   - getSupportedLanguages(): Get list of languages with available schemas
 *   - getNodeTypes(): Get available node types for a language
 *   - getFieldTypes(): Get available field types for a language
 * @context: Provides schema information for AST-based file analysis
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../utils/logger';

/**
 * Language definition from languages.json schema
 */
export interface LanguageDefinition {
  fields?: string[];
  nodes?: string[];
}

/**
 * Complete schema information for a language
 */
export interface LanguageSchema {
  language: string;
  nodeTypes: string[];
  fieldTypes: string[];
  raw?: any; // Raw schema JSON for advanced usage
}

/**
 * Schema loader with caching
 */
export class SchemaLoader {
  private static instance: SchemaLoader;
  private schemaCache: Map<string, LanguageSchema> = new Map();
  private languageDefinitions: Record<string, LanguageDefinition> | null = null;
  private schemaDir: string;

  private constructor() {
    // Schemas are in src/tools/localTools/schemas (or dist equivalent)
    this.schemaDir = path.join(__dirname, '../schemas');
    logger.info('📚 SchemaLoader initialized', { schemaDir: this.schemaDir });
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SchemaLoader {
    if (!SchemaLoader.instance) {
      SchemaLoader.instance = new SchemaLoader();
    }
    return SchemaLoader.instance;
  }

  /**
   * Load language definitions from languages.json
   */
  private async loadLanguageDefinitions(): Promise<Record<string, LanguageDefinition>> {
    if (this.languageDefinitions) {
      return this.languageDefinitions;
    }

    try {
      const languagesPath = path.join(this.schemaDir, 'languages.json');
      const content = await fs.promises.readFile(languagesPath, 'utf-8');
      let schema;
      try {
        schema = JSON.parse(content);
      } catch (parseError) {
        logger.error('Failed to parse languages.json', {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          contentPreview: content.substring(0, 200),
        });
        throw parseError;
      }

      // Extract language definitions from JSON Schema definitions
      const definitions: Record<string, LanguageDefinition> = {};

      if (schema.definitions) {
        // Parse language-specific field and node definitions
        for (const [key, value] of Object.entries(schema.definitions)) {
          if (key.endsWith('Fields')) {
            const lang = key.replace('Fields', '').toLowerCase();
            if (!definitions[lang]) definitions[lang] = {};
            definitions[lang].fields = (value as any).enum || [];
          } else if (key.endsWith('Nodes')) {
            const lang = key.replace('Nodes', '').toLowerCase();
            if (!definitions[lang]) definitions[lang] = {};
            definitions[lang].nodes = (value as any).enum || [];
          }
        }
      }

      this.languageDefinitions = definitions;
      logger.info('📖 Loaded language definitions', {
        languages: Object.keys(definitions).length,
      });

      return definitions;
    } catch (error) {
      logger.error('Failed to load language definitions', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Get list of supported languages
   */
  public async getSupportedLanguages(): Promise<string[]> {
    const definitions = await this.loadLanguageDefinitions();
    return Object.keys(definitions).sort();
  }

  /**
   * Check if a language is supported
   */
  public async isLanguageSupported(language: string): Promise<boolean> {
    const supported = await this.getSupportedLanguages();
    return supported.includes(language.toLowerCase());
  }

  /**
   * Load schema for a specific language
   */
  public async loadSchema(language: string): Promise<LanguageSchema | null> {
    const normalizedLang = language.toLowerCase();

    // Check cache first
    if (this.schemaCache.has(normalizedLang)) {
      return this.schemaCache.get(normalizedLang)!;
    }

    try {
      // Load language definitions
      const definitions = await this.loadLanguageDefinitions();
      const langDef = definitions[normalizedLang];

      if (!langDef) {
        logger.warn('Language not found in definitions', { language: normalizedLang });
        return null;
      }

      // Try to load the full rule schema file for additional metadata
      let rawSchema = null;
      try {
        const schemaPath = path.join(this.schemaDir, `${normalizedLang}_rule.json`);
        const content = await fs.promises.readFile(schemaPath, 'utf-8');
        rawSchema = JSON.parse(content);
      } catch (error) {
        // Rule schema is optional, we have the essential info from languages.json
        logger.debug('Rule schema not loaded (using definitions only)', {
          language: normalizedLang,
        });
      }

      const schema: LanguageSchema = {
        language: normalizedLang,
        nodeTypes: langDef.nodes || [],
        fieldTypes: langDef.fields || [],
        raw: rawSchema,
      };

      // Cache the schema
      this.schemaCache.set(normalizedLang, schema);

      logger.info('✅ Loaded schema', {
        language: normalizedLang,
        nodeTypes: schema.nodeTypes.length,
        fieldTypes: schema.fieldTypes.length,
      });

      return schema;
    } catch (error) {
      logger.error('Failed to load schema', {
        language: normalizedLang,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get node types for a language
   */
  public async getNodeTypes(language: string): Promise<string[]> {
    const schema = await this.loadSchema(language);
    return schema?.nodeTypes || [];
  }

  /**
   * Get field types for a language
   */
  public async getFieldTypes(language: string): Promise<string[]> {
    const schema = await this.loadSchema(language);
    return schema?.fieldTypes || [];
  }

  /**
   * Check if a node type exists for a language
   */
  public async hasNodeType(language: string, nodeType: string): Promise<boolean> {
    const nodeTypes = await this.getNodeTypes(language);
    return nodeTypes.includes(nodeType);
  }

  /**
   * Check if a field type exists for a language
   */
  public async hasFieldType(language: string, fieldType: string): Promise<boolean> {
    const fieldTypes = await this.getFieldTypes(language);
    return fieldTypes.includes(fieldType);
  }

  /**
   * Clear the schema cache (useful for testing)
   */
  public clearCache(): void {
    this.schemaCache.clear();
    this.languageDefinitions = null;
    logger.info('🗑️ Schema cache cleared');
  }
}

/**
 * Convenience function to get the schema loader instance
 */
export function getSchemaLoader(): SchemaLoader {
  return SchemaLoader.getInstance();
}
