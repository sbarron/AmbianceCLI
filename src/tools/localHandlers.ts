import * as fs from 'fs';
import * as path from 'path';
import { TreeSitterProcessor, CodeChunk, CodeSymbol } from '../local/treeSitterProcessor';
import { LocalProjectManager } from '../local/projectManager';
import { LocalSearch } from '../local/search';
import { ProjectIdentifier, ProjectInfo } from '../local/projectIdentifier';
import { logger } from '../utils/logger';

const projectManager = new LocalProjectManager();
const localSearch = new LocalSearch();
const projectIdentifier = ProjectIdentifier.getInstance();

export interface LocalProject {
  id: string;
  name: string;
  path: string;
  addedAt: Date;
  lastIndexed?: Date;
  stats?: {
    fileCount: number;
    chunkCount: number;
    symbolCount: number;
  };
}

export async function handleAddLocalProject(args: any): Promise<LocalProject> {
  const { path: projectPath, name } = args;

  if (!projectPath) {
    throw new Error('Project path is required');
  }

  // Validate path exists and is a directory
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Path does not exist: ${projectPath}`);
  }

  const stat = fs.statSync(projectPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${projectPath}`);
  }

  // Add project to manager
  const project = await projectManager.addProject(projectPath, name);

  // Start background indexing
  indexProjectInBackground(project);

  return project;
}

export async function handleListLocalProjects(): Promise<LocalProject[]> {
  return projectManager.listProjects();
}

export async function handleSearchLocalContext(args: any): Promise<any[]> {
  const { query, project, k = 12 } = args;

  if (!query) {
    throw new Error('Query is required');
  }

  if (!project) {
    throw new Error('Project is required');
  }

  // Find project by name or path
  const projects = await projectManager.listProjects();
  const targetProject = projects.find(
    p => p.name === project || p.path === project || p.id === project
  );

  if (!targetProject) {
    throw new Error(`Project not found: ${project}`);
  }

  // Convert LocalProject to ProjectInfo for the new search system
  const projectInfo: ProjectInfo = {
    id: targetProject.id,
    name: targetProject.name,
    path: targetProject.path,
    type: 'local',
    workspaceRoot: targetProject.path,
    lastModified: targetProject.lastIndexed || new Date(),
  };

  // Search local context
  const results = await localSearch.search(projectInfo, query, k);

  return results.map(result => ({
    path: result.path,
    startLine: result.startLine,
    endLine: result.endLine,
    content: result.content,
    score: result.score,
    symbolName: result.symbolName,
    symbolType: result.symbolType,
    language: result.language,
  }));
}

async function indexProjectInBackground(project: LocalProject): Promise<void> {
  try {
    logger.info(`🔍 Starting background indexing for project: ${project.name}`);

    const processor = new TreeSitterProcessor();
    const stats = { fileCount: 0, chunkCount: 0, symbolCount: 0 };

    // Get all supported files in the project
    const files = await getAllFiles(project.path, ['.ts', '.tsx', '.js', '.jsx', '.py', '.md']);

    stats.fileCount = files.length;

    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const relativePath = path.relative(project.path, filePath);
        const language = getLanguageFromExtension(path.extname(filePath));

        if (language) {
          const result = await processor.parseAndChunk(content, language, relativePath);

          // Store chunks and symbols locally
          // Convert LocalProject to ProjectInfo for the new search system
          const projectInfo: ProjectInfo = {
            id: project.id,
            name: project.name,
            path: project.path,
            type: 'local',
            workspaceRoot: project.path,
            lastModified: project.lastIndexed || new Date(),
          };

          await localSearch.indexFile(projectInfo, {
            path: relativePath,
            content,
            language,
            chunks: result.chunks,
            symbols: result.symbols,
          });

          stats.chunkCount += result.chunks.length;
          stats.symbolCount += result.symbols.length;
        }
      } catch (error) {
        logger.error(`Error indexing file ${filePath}:`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Update project stats
    await projectManager.updateProjectStats(project.id, stats);

    logger.info(
      `✅ Completed indexing for ${project.name}: ${stats.fileCount} files, ${stats.chunkCount} chunks, ${stats.symbolCount} symbols`
    );
  } catch (error) {
    logger.error(`❌ Error indexing project ${project.name}:`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getAllFiles(dir: string, extensions: string[]): Promise<string[]> {
  const files: string[] = [];

  const traverse = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip common ignore directories
        if (
          !['node_modules', '.git', 'dist', 'build', '.next', '__pycache__'].includes(entry.name)
        ) {
          traverse(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  };

  traverse(dir);
  return files;
}

function getLanguageFromExtension(ext: string): string | null {
  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.html': 'html',
    '.htm': 'html',
    '.astro': 'html',
    '.vue': 'html',
    '.svelte': 'html',
    '.css': 'css',
    '.scss': 'css',
    '.sass': 'css',
    '.less': 'css',
  };

  return languageMap[ext] || null;
}
