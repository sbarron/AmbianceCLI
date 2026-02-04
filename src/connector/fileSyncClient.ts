/**
 * @fileOverview: File synchronization client for uploading project files to cloud service with manifest-based change detection
 * @module: FileSyncClient
 * @keyFunctions:
 *   - buildManifest(): Create file manifest with hashes for change detection
 *   - syncProject(): Synchronize project files with cloud service
 *   - computeSha256(): Generate file hashes for change tracking
 *   - uploadFiles(): Upload changed files with compression
 * @dependencies:
 *   - apiClient: Cloud service communication for file uploads
 *   - crypto: SHA-256 hash generation for file change detection
 *   - zlib: File compression for efficient uploads
 *   - projectIdentifier: Ignore pattern loading and file filtering
 * @context: Provides efficient file synchronization with cloud service using manifest-based change detection and compressed file uploads
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { apiClient } from '../client/apiClient';
import { loadIgnorePatterns, shouldIgnoreFile } from '../local/projectIdentifier';

const gzipAsync = promisify(zlib.gzip);

export interface ManifestEntry {
  path: string;
  size: number;
  mtime: number;
  sha256: string;
}

export interface SyncLimits {
  maxFileSizeMB: number;
  allowedTypes: string[];
}

export interface SyncManifestResponse {
  projectId: string;
  needed: Array<{ path: string; reason: 'missing' | 'hash_mismatch' }>;
  limits?: SyncLimits;
}

export interface SyncFilesResponse {
  accepted: string[];
  rejected: Array<{ path: string; error: string }>;
  indexed?: { files: number; chunks: number; symbols: number };
}

export interface SyncResult {
  projectId?: string;
  manifestCount: number;
  uploadedCount: number;
  limits: SyncLimits;
}

export interface BuildManifestOptions {
  baseDir: string;
  additionalIgnores?: string[];
  maxFileSizeMB?: number;
  allowedExtensions?: string[]; // e.g., ['.ts', '.tsx', '.js', '.jsx', '.py', '.md']
}

const DEFAULT_MAX_FILE_SIZE_MB = 5; // client cap
const DEFAULT_ALLOWED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.md', '.json'];
const MANIFEST_BATCH_SIZE = 5000; // max files per batch to avoid request body size limits

export async function buildManifest(options: BuildManifestOptions): Promise<ManifestEntry[]> {
  const { baseDir } = options;
  const maxFileSizeMB = options.maxFileSizeMB ?? DEFAULT_MAX_FILE_SIZE_MB;
  const allowed = new Set(
    (options.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS).map(e => e.toLowerCase())
  );
  const patterns = await loadIgnorePatterns(baseDir);
  const extra = options.additionalIgnores ?? [];
  for (const p of extra) patterns.push(p);

  const entries: ManifestEntry[] = [];

  const walk = async (dir: string) => {
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of list) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(baseDir, abs).replace(/\\/g, '/');

      if (shouldIgnoreFile(rel, patterns)) continue;

      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!allowed.has(ext)) continue;

        const stat = fs.statSync(abs);
        const sizeMB = stat.size / (1024 * 1024);
        if (sizeMB > maxFileSizeMB) continue;

        const sha256 = await computeSha256(abs);
        entries.push({ path: rel, size: stat.size, mtime: Math.floor(stat.mtimeMs), sha256 });
      }
    }
  };

  await walk(baseDir);
  return entries;
}

export async function syncProject(baseDir: string, projectName?: string): Promise<SyncResult> {
  const manifest = await buildManifest({ baseDir });
  const limits: SyncLimits = {
    maxFileSizeMB: DEFAULT_MAX_FILE_SIZE_MB,
    allowedTypes: DEFAULT_ALLOWED_EXTENSIONS,
  };

  try {
    const deviceId = process.env.AMBIANCE_DEVICE_TOKEN || 'local-device';

    // Batch the manifest if it's too large
    const allNeeded: Array<{ path: string; reason: 'missing' | 'hash_mismatch' }> = [];
    let projectId: string = '';
    let finalLimits = limits;

    for (let i = 0; i < manifest.length; i += MANIFEST_BATCH_SIZE) {
      const batch = manifest.slice(i, i + MANIFEST_BATCH_SIZE);
      const body = { projectName, projectId: projectId || undefined, deviceId, manifest: batch };
      const resp = await apiClient.post('/v1/projects/sync-manifest', body);

      if (!projectId) projectId = resp.projectId;
      allNeeded.push(...(resp.needed ?? []));
      if (resp.limits) finalLimits = resp.limits;
    }

    const parsed: SyncManifestResponse = {
      projectId,
      needed: allNeeded,
      limits: finalLimits,
    };

    // Prepare uploads
    const neededSet = new Set(parsed.needed.map(n => n.path));
    const filesToUpload = manifest.filter(m => neededSet.has(m.path));
    const payloadFiles = await Promise.all(
      filesToUpload.map(async f => ({
        path: f.path,
        sha256: f.sha256,
        contentGzipBase64: await gzipFileBase64(path.join(baseDir, f.path)),
      }))
    );

    let uploadedCount = 0;
    if (payloadFiles.length > 0) {
      const uploadResp = await apiClient.post('/v1/projects/sync-files', {
        projectId: parsed.projectId,
        files: payloadFiles,
      });
      const parsedUpload: SyncFilesResponse = {
        accepted: uploadResp.accepted ?? [],
        rejected: uploadResp.rejected ?? [],
        indexed: uploadResp.indexed,
      };
      uploadedCount = parsedUpload.accepted.length;
    }

    return {
      projectId: parsed.projectId,
      manifestCount: manifest.length,
      uploadedCount,
      limits: parsed.limits ?? limits,
    };
  } catch (error) {
    // Server likely unavailable; return offline summary
    return {
      projectId: undefined,
      manifestCount: manifest.length,
      uploadedCount: 0,
      limits,
    };
  }
}

export async function gzipFileBase64(absPath: string): Promise<string> {
  const content = fs.readFileSync(absPath);
  const gz = await gzipAsync(content);
  return gz.toString('base64');
}

async function computeSha256(absPath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(absPath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
