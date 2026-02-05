import * as fs from 'fs';
import * as path from 'path';

import { z } from 'zod';

import type { DoctorReport } from '../doctor';
import { runDoctor } from '../doctor';

export interface SkillCapabilitiesFile {
  name: string;
  version: number;
  commands: Array<{ name: string; description: string; json: boolean }>;
  workflows: string[];
}

export interface SkillVerifyReport {
  success: boolean;
  timestamp: string;
  doctor: DoctorReport;
  cli: {
    commands: string[];
  };
  skills: {
    baseDir?: string;
    capabilities?: SkillCapabilitiesFile;
    recipes: string[];
    workflows: string[];
    recipeNames: string[];
    workflowNames: string[];
    warnings: string[];
    errors: string[];
  };
}

const capabilitiesSchema = z
  .object({
    name: z.string().min(1),
    version: z.number().int().positive(),
    commands: z
      .array(
        z
          .object({
            name: z.string().min(1),
            description: z.string().min(1).optional(),
            json: z.boolean(),
          })
          .passthrough()
      )
      .default([]),
    workflows: z.array(z.string().min(1)).default([]),
  })
  .passthrough();

const workflowSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    guards: z
      .object({
        maxTokens: z.number().int().positive().optional(),
        json: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    steps: z
      .array(
        z
          .object({
            command: z.string().min(1),
            args: z.array(z.string()).default([]),
          })
          .passthrough()
      )
      .min(1),
  })
  .passthrough();

const recipeSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    defaults: z.record(z.any()).optional(),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
  })
  .passthrough();

function tryReadJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function findSkillsBaseDir(): string | undefined {
  const envOverride = process.env.AMBIANCE_SKILLS_DIR?.trim();
  if (envOverride) {
    try {
      if (fs.existsSync(envOverride) && fs.statSync(envOverride).isDirectory()) {
        return envOverride;
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'skills', 'ambiance'),
    path.resolve(__dirname, '..', '..', '..', '..', 'skills', 'ambiance'),
    path.resolve(process.cwd(), 'skills', 'ambiance'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

export async function runSkillVerify(args: {
  detectedProjectPath: string;
  availableCommands: string[];
}): Promise<SkillVerifyReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const baseDir = findSkillsBaseDir();

  const doctor = await runDoctor({ detectedProjectPath: args.detectedProjectPath });

  let capabilities: SkillCapabilitiesFile | undefined;
  const workflows: string[] = [];
  const recipes: string[] = [];
  const workflowNames: string[] = [];
  const recipeNames: string[] = [];

  if (!baseDir) {
    errors.push('skills/ambiance directory not found');
  } else {
    const capabilitiesPath = path.join(baseDir, 'capabilities.json');
    if (!fs.existsSync(capabilitiesPath)) {
      errors.push('skills/ambiance/capabilities.json not found');
    } else {
      try {
        const parsed = tryReadJsonFile(capabilitiesPath);
        capabilities = capabilitiesSchema.parse(parsed) as SkillCapabilitiesFile;
      } catch (error) {
        errors.push(
          `Failed to parse skills/ambiance/capabilities.json: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    const workflowsDir = path.join(baseDir, 'workflows');
    try {
      if (fs.existsSync(workflowsDir) && fs.statSync(workflowsDir).isDirectory()) {
        for (const entry of fs.readdirSync(workflowsDir)) {
          if (!entry.endsWith('.json')) continue;
          workflows.push(entry);

          const fullPath = path.join(workflowsDir, entry);
          try {
            const parsed = tryReadJsonFile(fullPath);
            const wf = workflowSchema.parse(parsed);
            workflowNames.push(wf.name);

            const enforceJson = wf.guards?.json === true;
            if (enforceJson) {
              for (const step of wf.steps) {
                if (!step.args.includes('--json')) {
                  errors.push(
                    `Workflow "${wf.name}" step "${step.command}" missing --json while guards.json=true`
                  );
                }
              }
            }

            for (const step of wf.steps) {
              if (!args.availableCommands.includes(step.command)) {
                errors.push(
                  `Workflow "${wf.name}" references unknown CLI command: ${step.command}`
                );
              }
            }
          } catch (error) {
            errors.push(
              `Invalid workflow file ${entry}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } else {
        errors.push('skills/ambiance/workflows directory not found');
      }
    } catch (error) {
      errors.push(
        `Failed to read skills/ambiance/workflows: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const recipesDir = path.join(baseDir, 'recipes');
    try {
      if (fs.existsSync(recipesDir) && fs.statSync(recipesDir).isDirectory()) {
        for (const entry of fs.readdirSync(recipesDir)) {
          if (!entry.endsWith('.json')) continue;
          recipes.push(entry);

          const fullPath = path.join(recipesDir, entry);
          try {
            const parsed = tryReadJsonFile(fullPath);
            const recipe = recipeSchema.parse(parsed);
            recipeNames.push(recipe.name);

            if (!args.availableCommands.includes(recipe.command)) {
              errors.push(
                `Recipe "${recipe.name}" references unknown CLI command: ${recipe.command}`
              );
            }

            const wantsJson = recipe.args.includes('--json') || recipe.defaults?.format === 'json';
            if (!wantsJson) {
              warnings.push(
                `Recipe "${recipe.name}" does not appear to force JSON output (missing --json or defaults.format=json)`
              );
            }
          } catch (error) {
            errors.push(
              `Invalid recipe file ${entry}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } else {
        errors.push('skills/ambiance/recipes directory not found');
      }
    } catch (error) {
      errors.push(
        `Failed to read skills/ambiance/recipes: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (capabilities) {
      const commandSet = new Set(args.availableCommands);

      for (const cmd of capabilities.commands || []) {
        const tokens = cmd.name.trim().split(/\s+/g);
        const topLevel = tokens[0];
        if (topLevel && !commandSet.has(topLevel)) {
          errors.push(`capabilities.json references unknown CLI command: ${cmd.name}`);
        }
      }

      const expectedWorkflows = new Set((capabilities.workflows || []).map(w => w.trim()));
      for (const expected of expectedWorkflows) {
        if (!workflowNames.includes(expected)) {
          errors.push(`capabilities.json workflow missing on disk: ${expected}.json`);
        }
      }

      for (const discovered of workflowNames) {
        if (!expectedWorkflows.has(discovered)) {
          warnings.push(
            `Workflow present on disk but not listed in capabilities.json: ${discovered}`
          );
        }
      }
    }
  }

  const success = errors.length === 0;

  return {
    success,
    timestamp: new Date().toISOString(),
    doctor,
    cli: {
      commands: args.availableCommands,
    },
    skills: {
      baseDir,
      capabilities,
      recipes,
      workflows,
      recipeNames,
      workflowNames,
      warnings,
      errors,
    },
  };
}
