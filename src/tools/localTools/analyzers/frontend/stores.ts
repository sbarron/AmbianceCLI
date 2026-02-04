/**
 * @fileOverview: State stores analyzer for React applications
 * @module: StoresAnalyzer
 * @keyFunctions:
 *   - analyzeStores(): Analyze global state management libraries and usage patterns
 *   - detectStoreLibraries(): Identify Zustand, Redux, Context, Jotai, Recoil usage
 *   - findStoreUsage(): Track which components use which stores
 * @context: Detects state management patterns and global store usage
 */

import { readFile } from 'fs/promises';
import type { FileInfo } from '../../../../core/compactor/fileDiscovery';
import { logger } from '../../../../utils/logger';
import type { ComponentInfo } from './components';

export interface StoreInfo {
  lib: 'zustand' | 'redux' | 'context' | 'jotai' | 'recoil';
  file: string;
  usedBy: string[];
  type?: 'store' | 'slice' | 'context' | 'atom';
  name?: string;
}

/**
 * Detect state management libraries from imports and usage
 */
function detectStoreLibraries(content: string): {
  hasZustand: boolean;
  hasRedux: boolean;
  hasContext: boolean;
  hasJotai: boolean;
  hasRecoil: boolean;
} {
  const imports = content.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || [];
  const importStatements = content.match(/import\s*{[^}]*}\s+from\s+['"]([^'"]+)['"]/g) || [];

  let hasZustand = false;
  let hasRedux = false;
  let hasContext = false;
  let hasJotai = false;
  let hasRecoil = false;

  // Check package imports
  for (const imp of imports) {
    if (imp.includes('zustand')) {
      hasZustand = true;
    }
    if (imp.includes('redux') || imp.includes('@reduxjs/toolkit')) {
      hasRedux = true;
    }
    if (imp.includes('jotai')) {
      hasJotai = true;
    }
    if (imp.includes('recoil')) {
      hasRecoil = true;
    }
  }

  // Check named imports
  for (const imp of importStatements) {
    if (imp.includes('create') && imp.includes('zustand')) {
      hasZustand = true;
    }
    if (imp.includes('configureStore') || imp.includes('createSlice') || imp.includes('Provider')) {
      hasRedux = true;
    }
    if (imp.includes('createContext') || imp.includes('useContext') || imp.includes('Context')) {
      hasContext = true;
    }
    if (imp.includes('atom') || imp.includes('useAtom')) {
      hasJotai = true;
    }
    if (imp.includes('atom') && imp.includes('recoil')) {
      hasRecoil = true;
    }
  }

  // Check for direct function calls and patterns
  if (
    content.includes('createContext(') ||
    content.includes('Context') ||
    content.includes('Provider')
  ) {
    hasContext = true;
  }
  if (content.includes('create(') && content.includes('zustand')) {
    hasZustand = true;
  }

  return { hasZustand, hasRedux, hasContext, hasJotai, hasRecoil };
}

/**
 * Extract Zustand store definitions
 */
function extractZustandStores(content: string): Array<{ name?: string; type: 'store' }> {
  const stores: Array<{ name?: string; type: 'store' }> = [];

  // Match create() calls from zustand
  const createRegex = /const\s+(\w+)\s*=\s*create\s*\(/g;
  let match;
  while ((match = createRegex.exec(content)) !== null) {
    stores.push({ name: match[1], type: 'store' });
  }

  // Also match direct create calls without assignment
  const directCreateRegex = /create\s*\(\s*\(/g;
  if (directCreateRegex.test(content)) {
    stores.push({ type: 'store' });
  }

  return stores;
}

/**
 * Extract Redux store definitions
 */
function extractReduxStores(content: string): Array<{ name?: string; type: 'store' | 'slice' }> {
  const stores: Array<{ name?: string; type: 'store' | 'slice' }> = [];

  // Match configureStore
  const configureStoreRegex = /const\s+(\w+)\s*=\s*configureStore\s*\(/g;
  let match;
  while ((match = configureStoreRegex.exec(content)) !== null) {
    stores.push({ name: match[1], type: 'store' });
  }

  // Match createSlice
  const createSliceRegex = /const\s+(\w+)\s*=\s*createSlice\s*\(/g;
  while ((match = createSliceRegex.exec(content)) !== null) {
    stores.push({ name: match[1], type: 'slice' });
  }

  return stores;
}

/**
 * Extract React Context definitions
 */
function extractContextStores(content: string): Array<{ name?: string; type: 'context' }> {
  const contexts: Array<{ name?: string; type: 'context' }> = [];

  // Match createContext calls
  const createContextRegex = /const\s+(\w+)\s*=\s*createContext\s*\(/g;
  let match;
  while ((match = createContextRegex.exec(content)) !== null) {
    contexts.push({ name: match[1], type: 'context' });
  }

  return contexts;
}

/**
 * Extract Jotai atoms
 */
function extractJotaiAtoms(content: string): Array<{ name?: string; type: 'atom' }> {
  const atoms: Array<{ name?: string; type: 'atom' }> = [];

  // Match atom definitions
  const atomRegex = /const\s+(\w+)\s*=\s*atom\s*\(/g;
  let match;
  while ((match = atomRegex.exec(content)) !== null) {
    atoms.push({ name: match[1], type: 'atom' });
  }

  return atoms;
}

/**
 * Extract Recoil atoms/selectors
 */
function extractRecoilAtoms(content: string): Array<{ name?: string; type: 'atom' }> {
  const atoms: Array<{ name?: string; type: 'atom' }> = [];

  // Match atom definitions
  const atomRegex = /const\s+(\w+)\s*=\s*atom\s*\(/g;
  let match;
  while ((match = atomRegex.exec(content)) !== null) {
    atoms.push({ name: match[1], type: 'atom' });
  }

  // Match selector definitions
  const selectorRegex = /const\s+(\w+)\s*=\s*selector\s*\(/g;
  while ((match = selectorRegex.exec(content)) !== null) {
    atoms.push({ name: match[1], type: 'atom' }); // Treat selectors as atoms for simplicity
  }

  return atoms;
}

/**
 * Find which components use which stores
 */
function findStoreUsage(storeName: string, files: FileInfo[], storeFile: string): string[] {
  const usage: string[] = [];

  for (const file of files) {
    if (file.relPath === storeFile) continue; // Skip the store definition file itself

    try {
      const content = readFile(file.absPath, 'utf-8').then(content => {
        // Check for imports from the store file
        const importRegex = new RegExp(
          `import\\s+.*from\\s+['"]([^'"]*${storeName}[^'"]*)['"]`,
          'g'
        );
        if (importRegex.test(content)) {
          usage.push(file.relPath);
        }

        // Check for direct usage of the store name
        if (content.includes(storeName) && content.includes('use')) {
          usage.push(file.relPath);
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return usage;
}

/**
 * Analyze state management patterns in files
 */
export async function analyzeStores(
  files: FileInfo[],
  components: ComponentInfo[]
): Promise<StoreInfo[]> {
  const stores: StoreInfo[] = [];

  logger.info(`🏪 Analyzing state stores in ${files.length} files`);

  for (const file of files) {
    try {
      const content = await readFile(file.absPath, 'utf-8');
      const libraries = detectStoreLibraries(content);

      // Analyze Zustand stores
      if (libraries.hasZustand) {
        const zustandStores = extractZustandStores(content);
        for (const store of zustandStores) {
          stores.push({
            lib: 'zustand',
            file: file.relPath,
            usedBy: [], // Will be populated later
            type: store.type,
            name: store.name,
          });
        }
      }

      // Analyze Redux stores/slices
      if (libraries.hasRedux) {
        const reduxStores = extractReduxStores(content);
        for (const store of reduxStores) {
          stores.push({
            lib: 'redux',
            file: file.relPath,
            usedBy: [], // Will be populated later
            type: store.type,
            name: store.name,
          });
        }
      }

      // Analyze React Context
      if (libraries.hasContext) {
        const contexts = extractContextStores(content);
        for (const context of contexts) {
          stores.push({
            lib: 'context',
            file: file.relPath,
            usedBy: [], // Will be populated later
            type: context.type,
            name: context.name,
          });
        }
      }

      // Analyze Jotai atoms
      if (libraries.hasJotai) {
        const atoms = extractJotaiAtoms(content);
        for (const atom of atoms) {
          stores.push({
            lib: 'jotai',
            file: file.relPath,
            usedBy: [], // Will be populated later
            type: atom.type,
            name: atom.name,
          });
        }
      }

      // Analyze Recoil atoms/selectors
      if (libraries.hasRecoil) {
        const atoms = extractRecoilAtoms(content);
        for (const atom of atoms) {
          stores.push({
            lib: 'recoil',
            file: file.relPath,
            usedBy: [], // Will be populated later
            type: atom.type,
            name: atom.name,
          });
        }
      }
    } catch (error) {
      logger.warn(`Failed to analyze stores in ${file.relPath}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Find usage of each store
  for (const store of stores) {
    if (store.name) {
      store.usedBy = findStoreUsage(store.name, files, store.file);
    }
  }

  // Deduplicate by file and sort
  const uniqueStores = stores
    .filter(
      (store, index, self) =>
        index ===
        self.findIndex(s => s.file === store.file && s.lib === store.lib && s.name === store.name)
    )
    .sort((a, b) => a.file.localeCompare(b.file));

  logger.info(`🏪 Store analysis complete: ${uniqueStores.length} stores detected`);
  return uniqueStores;
}

/**
 * Get state management library summary for the project
 */
export function getStoreLibrariesSummary(files: FileInfo[]): {
  zustand: boolean;
  redux: boolean;
  context: boolean;
  jotai: boolean;
  recoil: boolean;
} {
  const summary = { zustand: false, redux: false, context: false, jotai: false, recoil: false };

  for (const file of files) {
    try {
      const content = readFile(file.absPath, 'utf-8').then(content => {
        const libraries = detectStoreLibraries(content);
        summary.zustand = summary.zustand || libraries.hasZustand;
        summary.redux = summary.redux || libraries.hasRedux;
        summary.context = summary.context || libraries.hasContext;
        summary.jotai = summary.jotai || libraries.hasJotai;
        summary.recoil = summary.recoil || libraries.hasRecoil;
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return summary;
}
