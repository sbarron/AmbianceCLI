import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern:
      /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi,
    replacement: '[REDACTED PRIVATE KEY]',
  },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g, replacement: 'sk-[REDACTED]' },
  {
    pattern:
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\b\s*[:=]\s*["']?[^\s,"']{6,}["']?/gi,
    replacement: '$1=[REDACTED]',
  },
];

export function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeFsPath(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) return undefined;
  let normalized = path.resolve(value.replace(/^\\\\\?\\/, ''));
  normalized = normalized.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function pathsMatch(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeFsPath(left);
  const b = normalizeFsPath(right);
  return !!a && !!b && a === b;
}

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function truncateText(value: string, maxChars: number): string {
  const normalized = value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function redactSecrets(value: string): { text: string; redactions: number } {
  let text = value;
  let redactions = 0;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    text = text.replace(pattern, match => {
      redactions += 1;
      if (replacement.includes('$1')) {
        const key = match.split(/\s*[:=]\s*/)[0] || 'secret';
        return `${key}=[REDACTED]`;
      }
      return replacement;
    });
  }
  return { text, redactions };
}

export function cleanTitle(value: string | undefined, fallback = 'Untitled agent session'): string {
  if (!value) return fallback;
  const stripped = value
    .replace(
      /<(?:environment_context|codex_internal_context)[\s\S]*?<\/(?:environment_context|codex_internal_context)>/gi,
      ' '
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return fallback;
  return truncateText(redactSecrets(stripped.split(/(?<=[.!?])\s|\n/)[0]).text, 96);
}

export function resolveAmbianceHome(): string {
  const override = process.env.AMBIANCE_HOME?.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), '.ambiance');
}

export function resolveHandoffCacheDir(): string {
  const override = process.env.AMBIANCE_HANDOFF_CACHE_DIR?.trim();
  return override ? path.resolve(override) : path.join(resolveAmbianceHome(), 'cache');
}

export function ensureDirSync(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
}

export function atomicWriteFileSync(filePath: string, contents: string): void {
  ensureDirSync(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, contents, 'utf8');
  fs.renameSync(temporary, filePath);
}

export function listJsonlFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) files.push(fullPath);
    }
  }
  return files;
}

export function readJsonlSample(
  filePath: string,
  headBytes = 128 * 1024,
  tailBytes = 32 * 1024
): unknown[] {
  const stat = fs.statSync(filePath);
  const handle = fs.openSync(filePath, 'r');
  try {
    const firstLength = Math.min(headBytes, stat.size);
    const first = Buffer.alloc(firstLength);
    fs.readSync(handle, first, 0, firstLength, 0);

    let raw = first.toString('utf8');
    if (stat.size > firstLength) {
      const tailLength = Math.min(tailBytes, stat.size - firstLength);
      const tail = Buffer.alloc(tailLength);
      fs.readSync(handle, tail, 0, tailLength, stat.size - tailLength);
      raw += `\n${tail.toString('utf8')}`;
    }

    const rows: unknown[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim().startsWith('{')) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        // Samples may begin or end in the middle of a JSONL record.
      }
    }
    return rows;
  } finally {
    fs.closeSync(handle);
  }
}

export function extractText(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(extractText);

  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : undefined;
  if (type === 'thinking' || type === 'reasoning') return [];
  if (typeof record.text === 'string') return [record.text];
  if (typeof record.content === 'string') return [record.content];
  if (typeof record.message === 'string') return [record.message];
  return [];
}

export function isSubstantiveUserText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3) return false;
  if (
    /^<(?:environment_context|apps_instructions|plugins_instructions|recommended_plugins|codex_internal_context|system-reminder|command-name|command-message|local-command-stdout|task-notification)>/i.test(
      trimmed
    )
  )
    return false;
  if (/^This block is automatically supplied ambient UI state/i.test(trimmed)) return false;
  if (/^Base directory for this skill:/i.test(trimmed)) return false;
  if (/^Caveat: The messages below were generated/i.test(trimmed)) return false;
  if (/^\[SYSTEM NOTIFICATION\b/i.test(trimmed)) return false;
  return true;
}
