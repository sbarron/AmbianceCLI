/**
 * Lightweight module graph builder with alias and re-export support
 */
import { readFile } from 'fs/promises';
import * as path from 'path';
import type { FileInfo } from '../../../../core/compactor/fileDiscovery';

export interface ModuleGraph {
  imports: Map<string, Set<string>>; // file -> set(imported files)
  reverse: Map<string, Set<string>>; // file -> set(importers)
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function getTsconfigPaths(projectRoot: string): Record<string, string[]> {
  try {
    const tsPath = path.join(projectRoot, 'tsconfig.json');
    const raw = require('fs').readFileSync(tsPath, 'utf-8');
    const ts = JSON.parse(raw);
    return ts?.compilerOptions?.paths || {};
  } catch {
    return {};
  }
}

function resolveAlias(
  spec: string,
  fromFile: string,
  files: FileInfo[],
  projectRoot: string,
  pathsMap: Record<string, string[]>
): string | undefined {
  const relFrom = toPosix(fromFile);
  // Relative import
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = toPosix(path.posix.dirname(relFrom));
    const resolved = toPosix(path.posix.normalize(path.posix.join(base, spec)));
    const found = files.find(f => {
      const r = toPosix(f.relPath);
      return (
        r === resolved ||
        r === resolved + '.ts' ||
        r === resolved + '.tsx' ||
        r === resolved + '.js' ||
        r === resolved + '.jsx' ||
        (r.endsWith('/index.ts') && r.slice(0, -9) === resolved) ||
        (r.endsWith('/index.tsx') && r.slice(0, -10) === resolved)
      );
    });
    return found ? toPosix(found.relPath) : undefined;
  }
  // Next.js alias '@/' - try common bases: 'web/', 'app/', project root
  if (spec.startsWith('@/')) {
    const tail = spec.slice(2);
    const bases = ['web', 'app', 'src', ''];
    for (const base of bases) {
      const joined = base
        ? toPosix(path.posix.normalize(path.posix.join(base, tail)))
        : toPosix(tail);
      const found = files.find(f => {
        const rel = toPosix(f.relPath);
        return (
          rel === joined ||
          rel.startsWith(joined + '.') ||
          rel === joined + '/index.tsx' ||
          rel === joined + '/index.ts'
        );
      });
      if (found) return toPosix(found.relPath);
    }
  }
  // tsconfig paths
  for (const [alias, targets] of Object.entries(pathsMap)) {
    const aliasBase = alias.replace(/\*$/, '');
    if (spec.startsWith(aliasBase)) {
      const rest = spec.slice(aliasBase.length);
      for (const tgt of targets) {
        const tgtBase = toPosix(tgt.replace(/\*$/, ''));
        const candidate = toPosix(
          path.posix.normalize(path.posix.join(projectRoot, tgtBase, rest))
        );
        const found = files.find(
          f => toPosix(f.absPath) === candidate || toPosix(f.absPath).startsWith(candidate + '.')
        );
        if (found) return toPosix(found.relPath);
      }
    }
  }
  return undefined;
}

export async function buildModuleGraph(
  files: FileInfo[],
  projectRoot: string
): Promise<ModuleGraph> {
  const imports = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const pathsMap = getTsconfigPaths(projectRoot);

  for (const file of files) {
    const rel = toPosix(file.relPath);
    if (!/\.(ts|tsx|js|jsx)$/.test(rel)) continue;
    let content = '';
    try {
      content = await readFile(file.absPath, 'utf-8');
    } catch {
      continue;
    }

    const importSpecs: string[] = [];
    const imp = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    const reexp1 = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
    const reexp2 = /export\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = imp.exec(content)) !== null) importSpecs.push(m[1]);
    while ((m = reexp1.exec(content)) !== null) importSpecs.push(m[1]);
    while ((m = reexp2.exec(content)) !== null) importSpecs.push(m[1]);

    for (const spec of importSpecs) {
      const resolved = resolveAlias(spec, rel, files, toPosix(projectRoot), pathsMap);
      if (!resolved) continue;
      let importSet = imports.get(rel);
      if (!importSet) {
        importSet = new Set<string>();
        imports.set(rel, importSet);
      }
      importSet.add(resolved);

      let reverseSet = reverse.get(resolved);
      if (!reverseSet) {
        reverseSet = new Set<string>();
        reverse.set(resolved, reverseSet);
      }
      reverseSet.add(rel);
    }
  }

  return { imports, reverse };
}
