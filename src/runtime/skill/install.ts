import fs from 'fs';
import path from 'path';
import os from 'os';

export interface SkillInstallReport {
  success: boolean;
  timestamp: string;
  sourceDir: string;
  targetDirs: string[];
  dryRun: boolean;
  copiedFiles: number;
}

export async function runSkillInstall(args: {
  sourceDir: string;
  targetDir?: string;
  dryRun?: boolean;
  quiet?: boolean;
}): Promise<SkillInstallReport> {
  const { sourceDir, dryRun = false, quiet = false } = args;
  const log = (message: string): void => {
    if (!quiet) {
      process.stdout.write(`${message}\n`);
    }
  };

  let targetDirs: string[] = [];
  const home = os.homedir();
  const providers = ['.claude', '.gemini', '.antigravity', '.codex', '.cursor'];

  if (args.targetDir) {
    targetDirs.push(args.targetDir);
  } else {
    targetDirs = providers
      .map(p => path.join(home, p))
      .filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory())
      .map(p => path.join(p, 'skills', 'ambiance'));

    if (targetDirs.length === 0) {
      log(
        `No known AI provider directories found (${providers.join(', ')}). Defaulting to .claude`
      );
      targetDirs.push(path.join(home, '.claude', 'skills', 'ambiance'));
    }
  }

  log(`Installing ambiance skill...`);
  log(`Source: ${sourceDir}`);
  log(`Targets:\n  - ${targetDirs.join('\n  - ')}`);

  if (dryRun) {
    log('\n[DRY RUN] Would copy files to the target directories.');
    return {
      success: true,
      timestamp: new Date().toISOString(),
      sourceDir,
      targetDirs,
      dryRun,
      copiedFiles: 0,
    };
  }

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  for (const targetDir of targetDirs) {
    fs.cpSync(sourceDir, targetDir, {
      recursive: true,
      force: true,
    });
    log(`Successfully installed ambiance skill to ${targetDir}`);
  }

  return {
    success: true,
    timestamp: new Date().toISOString(),
    sourceDir,
    targetDirs,
    dryRun,
    copiedFiles: targetDirs.length, // Indicate number of successful copies
  };
}
