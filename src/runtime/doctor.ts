import { importEsm } from './utils/esmImport';

export interface DoctorReport {
  success: true;
  timestamp: string;
  node: {
    version: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  workspace: {
    detectedProjectPath: string;
    envWorkspaceFolder?: string;
  };
  embeddings: {
    useLocalEmbeddings?: string;
    sqliteBindings: {
      available: boolean;
      error?: string;
    };
  };
  dependencies: {
    treeSitter: { available: boolean; error?: string };
    transformers: { available: boolean; error?: string };
  };
}

function probeRequire(moduleName: string): { available: boolean; error?: string } {
  try {
    require(moduleName);
    return { available: true };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeEsm(moduleName: string): Promise<{ available: boolean; error?: string }> {
  try {
    await importEsm(moduleName);
    return { available: true };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runDoctor(args: { detectedProjectPath: string }): Promise<DoctorReport> {
  const treeSitter = probeRequire('tree-sitter');
  const transformers = await probeEsm('@xenova/transformers');
  const sqliteBindings = probeRequire('better-sqlite3');

  return {
    success: true,
    timestamp: new Date().toISOString(),
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    workspace: {
      detectedProjectPath: args.detectedProjectPath,
      envWorkspaceFolder: process.env.WORKSPACE_FOLDER,
    },
    embeddings: {
      useLocalEmbeddings: process.env.USE_LOCAL_EMBEDDINGS,
      sqliteBindings,
    },
    dependencies: {
      treeSitter,
      transformers,
    },
  };
}
