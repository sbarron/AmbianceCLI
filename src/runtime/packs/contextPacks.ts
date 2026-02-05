import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { v4 as uuidv4 } from 'uuid';

export interface ContextPackV1 {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  projectPath?: string;
  context: {
    query: string;
    taskType?: string;
    maxTokens?: number;
    useEmbeddings?: boolean;
    excludePatterns?: string[];
  };
  notes?: string;
}

export interface ContextPackSummary {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  projectPath?: string;
}

function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFileSync(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isContextPackV1(value: unknown): value is ContextPackV1 {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;
  return (
    v.version === 1 &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    v.context &&
    typeof v.context === 'object' &&
    typeof v.context.query === 'string'
  );
}

export function resolvePacksDir(args: { projectPath?: string; packsDir?: string }): string {
  const envOverride = process.env.AMBIANCE_PACKS_DIR?.trim();
  if (envOverride) return envOverride;

  if (args.packsDir) return args.packsDir;

  if (args.projectPath) {
    return path.resolve(args.projectPath, '.ambiance', 'packs');
  }

  return path.resolve(os.homedir(), '.ambiance', 'packs');
}

export function getContextPackTemplate(overrides?: Partial<ContextPackV1>): ContextPackV1 {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: '<generated>',
    name: 'example-pack',
    createdAt: now,
    updatedAt: now,
    projectPath: '<optional project path>',
    context: {
      query: 'Explain the main architecture of this project',
      taskType: 'understand',
      maxTokens: 2000,
      useEmbeddings: true,
      excludePatterns: ['node_modules/**', 'dist/**', 'build/**', '.git/**'],
    },
    ...overrides,
  };
}

export function createContextPack(args: {
  name: string;
  query: string;
  projectPath?: string;
  taskType?: string;
  maxTokens?: number;
  useEmbeddings?: boolean;
  excludePatterns?: string[];
  notes?: string;
  packsDir?: string;
}): { pack: ContextPackV1; filePath: string } {
  const now = new Date().toISOString();
  const pack: ContextPackV1 = {
    version: 1,
    id: uuidv4(),
    name: args.name,
    createdAt: now,
    updatedAt: now,
    projectPath: args.projectPath,
    context: {
      query: args.query,
      taskType: args.taskType,
      maxTokens: args.maxTokens,
      useEmbeddings: args.useEmbeddings,
      excludePatterns: args.excludePatterns,
    },
    notes: args.notes,
  };

  const packsDir = resolvePacksDir({ projectPath: args.projectPath, packsDir: args.packsDir });
  ensureDirSync(packsDir);

  const filePath = path.join(packsDir, `${pack.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(pack, null, 2));

  return { pack, filePath };
}

export function listContextPacks(args: { projectPath?: string; packsDir?: string }): {
  packsDir: string;
  packs: ContextPackSummary[];
} {
  const packsDir = resolvePacksDir({ projectPath: args.projectPath, packsDir: args.packsDir });
  if (!fs.existsSync(packsDir)) {
    return { packsDir, packs: [] };
  }

  const packs: ContextPackSummary[] = [];

  for (const entry of fs.readdirSync(packsDir)) {
    if (!entry.endsWith('.json')) continue;
    const fullPath = path.join(packsDir, entry);
    try {
      const parsed = readJsonFileSync(fullPath);
      if (!isContextPackV1(parsed)) continue;
      packs.push({
        id: parsed.id,
        name: parsed.name,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
        projectPath: parsed.projectPath,
      });
    } catch {
      // ignore invalid entries
    }
  }

  packs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { packsDir, packs };
}

function resolvePackFilePath(args: {
  identifier: string;
  projectPath?: string;
  packsDir?: string;
}): { packsDir: string; filePath?: string } {
  const packsDir = resolvePacksDir({ projectPath: args.projectPath, packsDir: args.packsDir });
  const idCandidate = args.identifier.trim();
  const direct = path.join(packsDir, `${idCandidate}.json`);
  if (fs.existsSync(direct)) return { packsDir, filePath: direct };

  if (!fs.existsSync(packsDir)) return { packsDir, filePath: undefined };

  for (const entry of fs.readdirSync(packsDir)) {
    if (!entry.endsWith('.json')) continue;
    const fullPath = path.join(packsDir, entry);
    try {
      const parsed = readJsonFileSync(fullPath);
      if (!isContextPackV1(parsed)) continue;
      if (parsed.name === args.identifier) return { packsDir, filePath: fullPath };
    } catch {
      // ignore
    }
  }

  return { packsDir, filePath: undefined };
}

export function getContextPack(args: {
  identifier: string;
  projectPath?: string;
  packsDir?: string;
}): { packsDir: string; pack: ContextPackV1 } {
  const resolved = resolvePackFilePath(args);
  if (!resolved.filePath) {
    throw new Error(`Context pack not found: ${args.identifier}`);
  }

  const parsed = readJsonFileSync(resolved.filePath);
  if (!isContextPackV1(parsed)) {
    throw new Error(`Invalid context pack file: ${path.basename(resolved.filePath)}`);
  }

  return { packsDir: resolved.packsDir, pack: parsed };
}

export function deleteContextPack(args: {
  identifier: string;
  projectPath?: string;
  packsDir?: string;
}): { packsDir: string; deleted: boolean; filePath?: string } {
  const resolved = resolvePackFilePath(args);
  if (!resolved.filePath) {
    return { packsDir: resolved.packsDir, deleted: false };
  }

  fs.unlinkSync(resolved.filePath);
  return { packsDir: resolved.packsDir, deleted: true, filePath: resolved.filePath };
}
