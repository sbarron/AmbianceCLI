/**
 * @fileOverview: Local project state management with persistent storage in user home directory
 * @module: LocalProjectManager
 * @keyFunctions:
 *   - addProject(): Add new project to local registry
 *   - listProjects(): Retrieve all registered local projects
 *   - getProject(): Find project by ID or path
 *   - removeProject(): Remove project from local registry
 * @dependencies:
 *   - fs: File system operations for persistent storage
 *   - path: Path manipulation and resolution
 *   - LocalProject: Project data structure from local handlers
 * @context: Manages local project registry with persistent storage in user's home directory, providing project lifecycle management for local development workflows
 */

import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../utils/logger';

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

export class LocalProjectManager {
  private projectsFile: string;
  private projects: Map<string, LocalProject>;

  constructor() {
    // Store projects in user's home directory
    const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
    const ambianceDir = path.join(homeDir, '.ambiance');

    // Create directory if it doesn't exist
    if (!fs.existsSync(ambianceDir)) {
      fs.mkdirSync(ambianceDir, { recursive: true });
    }

    this.projectsFile = path.join(ambianceDir, 'local-projects.json');
    this.projects = new Map();
    this.loadProjects();
  }

  private loadProjects(): void {
    try {
      if (fs.existsSync(this.projectsFile)) {
        const data = fs.readFileSync(this.projectsFile, 'utf8');
        const parsed = JSON.parse(data);
        const projectsArray = Array.isArray(parsed) ? parsed : [];
        if (!Array.isArray(parsed)) {
          logger.warn('local-projects.json is not an array; resetting in-memory project cache');
        }

        for (const project of projectsArray) {
          this.projects.set(project.id, {
            ...project,
            addedAt: new Date(project.addedAt),
            lastIndexed: project.lastIndexed ? new Date(project.lastIndexed) : undefined,
          });
        }
      }
    } catch (error) {
      logger.error('Failed to load local projects', { error });
    }
  }

  private saveProjects(): void {
    try {
      const projectsArray = Array.from(this.projects.values());
      fs.writeFileSync(this.projectsFile, JSON.stringify(projectsArray, null, 2));
    } catch (error) {
      logger.error('Failed to save local projects', { error });
    }
  }

  async addProject(projectPath: string, name?: string): Promise<LocalProject> {
    const absolutePath = normalizePathForId(projectPath);
    const projectName = name || path.basename(absolutePath);
    const projectId = this.generateProjectId(absolutePath);

    // Check if project already exists
    const existing = Array.from(this.projects.values()).find(p => p.path === absolutePath);
    if (existing) {
      throw new Error(`Project already exists: ${existing.name}`);
    }

    const project: LocalProject = {
      id: projectId,
      name: projectName,
      path: absolutePath,
      addedAt: new Date(),
    };

    this.projects.set(projectId, project);
    this.saveProjects();

    return project;
  }

  async listProjects(): Promise<LocalProject[]> {
    return Array.from(this.projects.values()).sort(
      (a, b) => b.addedAt.getTime() - a.addedAt.getTime()
    );
  }

  async getProject(idOrPath: string): Promise<LocalProject | undefined> {
    // Try by ID first
    const byId = this.projects.get(idOrPath);
    if (byId) return byId;

    // Try by path
    const absolutePath = path.resolve(idOrPath);
    return Array.from(this.projects.values()).find(p => p.path === absolutePath);
  }

  async removeProject(idOrPath: string): Promise<boolean> {
    const project = await this.getProject(idOrPath);
    if (!project) return false;

    this.projects.delete(project.id);
    this.saveProjects();
    return true;
  }

  async updateProjectStats(
    projectId: string,
    stats: { fileCount: number; chunkCount: number; symbolCount: number }
  ): Promise<void> {
    const project = this.projects.get(projectId);
    if (project) {
      project.stats = stats;
      project.lastIndexed = new Date();
      this.saveProjects();
    }
  }

  private generateProjectId(projectPath: string): string {
    // Generate a deterministic ID based on the path
    const normalized = normalizePathForId(projectPath);
    const hash = require('crypto').createHash('md5').update(normalized).digest('hex');
    return hash.substring(0, 12);
  }
}

// Reuse the canonical path normalizer from projectIdentifier
import { normalizePathForId } from './projectIdentifier';
