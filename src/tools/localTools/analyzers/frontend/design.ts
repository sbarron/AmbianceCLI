/**
 * @fileOverview: Design system analyzer for React applications
 * @module: DesignAnalyzer
 * @keyFunctions:
 *   - analyzeDesignSystem(): Analyze styling approaches and design system usage
 *   - detectTailwind(): Identify Tailwind CSS usage patterns
 *   - detectShadcnUI(): Identify shadcn/ui component library usage
 *   - detectCSSModules(): Identify CSS Modules and global CSS usage
 * @context: Detects styling patterns, design systems, and UI library usage
 */

import { readFile } from 'fs/promises';
import * as path from 'path';
import type { FileInfo } from '../../../../core/compactor/fileDiscovery';
import { logger } from '../../../../utils/logger';

export interface DesignSystemAnalysis {
  tailwind: boolean;
  shadcnUI: boolean;
  radixUI: boolean;
  lucideIcons: boolean;
  classVarianceAuthority: boolean;
  tailwindVariants: boolean;
  cssModules: boolean;
  styledComponents: boolean;
  emotion: boolean;
  globalCSS: string[];
  designLibraries: string[];
}

/**
 * Detect Tailwind CSS usage
 */
function detectTailwind(files: FileInfo[]): { hasTailwind: boolean; configFiles: string[] } {
  let hasTailwind = false;
  const configFiles: string[] = [];

  // Check for Tailwind config files
  for (const file of files) {
    const fileName = path.basename(file.relPath);
    if (fileName.startsWith('tailwind.config.') || fileName === 'tailwind.config') {
      hasTailwind = true;
      configFiles.push(file.relPath);
    }
  }

  // Check for Tailwind class usage in component files
  if (!hasTailwind) {
    for (const file of files) {
      if (file.ext === '.tsx' || file.ext === '.jsx' || file.ext === '.ts' || file.ext === '.js') {
        try {
          const content = readFile(file.absPath, 'utf-8').then(content => {
            // Check for common Tailwind classes
            const tailwindClasses = [
              'flex',
              'grid',
              'block',
              'inline',
              'hidden',
              'p-',
              'm-',
              'w-',
              'h-',
              'text-',
              'bg-',
              'border',
              'rounded',
              'shadow',
              'hover:',
              'focus:',
            ];

            for (const className of tailwindClasses) {
              if (
                content.includes(`className="${className}`) ||
                content.includes(`className='${className}`)
              ) {
                hasTailwind = true;
                break;
              }
              if (content.includes(`className={`) && content.includes(className)) {
                hasTailwind = true;
                break;
              }
            }
          });
        } catch (error) {
          // Continue with next file
        }
        if (hasTailwind) break;
      }
    }
  }

  return { hasTailwind, configFiles };
}

/**
 * Detect shadcn/ui usage
 */
function detectShadcnUI(files: FileInfo[]): { hasShadcnUI: boolean; componentFiles: string[] } {
  let hasShadcnUI = false;
  const componentFiles: string[] = [];

  for (const file of files) {
    try {
      const content = readFile(file.absPath, 'utf-8').then(content => {
        // Check for shadcn/ui imports
        if (content.includes('@/components/ui/') || content.includes('shadcn/ui')) {
          hasShadcnUI = true;
          componentFiles.push(file.relPath);
        }

        // Check for common shadcn/ui component usage
        const shadcnComponents = [
          'Button',
          'Input',
          'Card',
          'Dialog',
          'Sheet',
          'AlertDialog',
          'DropdownMenu',
          'Select',
          'Checkbox',
          'RadioGroup',
          'Switch',
          'Tabs',
          'Accordion',
          'Alert',
          'Badge',
          'Avatar',
        ];

        for (const component of shadcnComponents) {
          if (content.includes(`<${component}`) || content.includes(`import.*${component}`)) {
            hasShadcnUI = true;
            componentFiles.push(file.relPath);
            break;
          }
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return { hasShadcnUI, componentFiles: [...new Set(componentFiles)] };
}

/**
 * Detect Radix UI usage
 */
function detectRadixUI(files: FileInfo[]): { hasRadixUI: boolean; components: string[] } {
  let hasRadixUI = false;
  const components: string[] = [];

  for (const file of files) {
    try {
      const content = readFile(file.absPath, 'utf-8').then(content => {
        // Check for Radix UI imports
        if (content.includes('@radix-ui/')) {
          hasRadixUI = true;

          // Extract specific Radix components
          const radixImports =
            content.match(/import\s+.*from\s+['"]@radix-ui\/([^'"]+)['"]/g) || [];
          for (const imp of radixImports) {
            const component = imp.match(/@radix-ui\/([^'"]+)/)?.[1];
            if (component && !components.includes(component)) {
              components.push(component);
            }
          }
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return { hasRadixUI, components };
}

/**
 * Detect Lucide icon usage
 */
function detectLucideIcons(files: FileInfo[]): boolean {
  for (const file of files) {
    try {
      const content = readFile(file.absPath, 'utf-8').then(content => {
        if (
          content.includes('lucide-react') ||
          content.includes('from "lucide-react"') ||
          content.includes("from 'lucide-react'")
        ) {
          return true;
        }

        // Check for common Lucide icon names
        const lucideIcons = [
          'ArrowRight',
          'ArrowLeft',
          'ChevronDown',
          'ChevronUp',
          'ChevronRight',
          'ChevronLeft',
          'Search',
          'User',
          'Settings',
          'Home',
          'Menu',
          'X',
          'Check',
          'Plus',
          'Minus',
        ];

        for (const icon of lucideIcons) {
          if (content.includes(`<${icon}`) || content.includes(`import.*${icon}`)) {
            return true;
          }
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return false;
}

/**
 * Detect class-variance-authority usage
 */
function detectClassVarianceAuthority(files: FileInfo[]): boolean {
  for (const file of files) {
    try {
      const content = readFile(file.absPath, 'utf-8').then(content => {
        if (
          content.includes('class-variance-authority') ||
          content.includes('cva(') ||
          content.includes('cx(')
        ) {
          return true;
        }

        // Check for common cva patterns
        if (content.includes('import.*cva') || content.includes('import.*cx')) {
          return true;
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return false;
}

/**
 * Detect tailwind-variants usage
 */
function detectTailwindVariants(files: FileInfo[]): boolean {
  for (const file of files) {
    try {
      const content = readFile(file.absPath, 'utf-8').then(content => {
        if (content.includes('tailwind-variants') || content.includes('tv(')) {
          return true;
        }

        // Check for tv import
        if (content.includes('import.*tv') || content.includes('from.*tailwind-variants')) {
          return true;
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return false;
}

/**
 * Detect CSS Modules usage
 */
function detectCSSModules(files: FileInfo[]): { hasCSSModules: boolean; moduleFiles: string[] } {
  let hasCSSModules = false;
  const moduleFiles: string[] = [];

  for (const file of files) {
    if (file.ext === '.module.css' || file.ext === '.module.scss' || file.ext === '.module.sass') {
      hasCSSModules = true;
      moduleFiles.push(file.relPath);
    }

    // Check for CSS module imports
    if (file.ext === '.tsx' || file.ext === '.jsx' || file.ext === '.ts' || file.ext === '.js') {
      try {
        const content = readFile(file.absPath, 'utf-8').then(content => {
          if (
            content.includes('.module.css') ||
            content.includes('.module.scss') ||
            content.includes('.module.sass')
          ) {
            hasCSSModules = true;
            moduleFiles.push(file.relPath);
          }
        });
      } catch (error) {
        // Continue with next file
      }
    }
  }

  return { hasCSSModules, moduleFiles: [...new Set(moduleFiles)] };
}

/**
 * Detect styled-components usage
 */
function detectStyledComponents(files: FileInfo[]): boolean {
  for (const file of files) {
    try {
      const content = readFile(file.absPath, 'utf-8').then(content => {
        if (content.includes('styled-components') || content.includes('styled.')) {
          return true;
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return false;
}

/**
 * Detect Emotion usage
 */
function detectEmotion(files: FileInfo[]): boolean {
  for (const file of files) {
    try {
      const content = readFile(file.absPath, 'utf-8').then(content => {
        if (content.includes('@emotion/styled') || content.includes('@emotion/react')) {
          return true;
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return false;
}

/**
 * Detect global CSS files
 */
function detectGlobalCSS(files: FileInfo[]): string[] {
  const globalCSSFiles: string[] = [];

  for (const file of files) {
    if (file.ext === '.css' || file.ext === '.scss' || file.ext === '.sass') {
      // Skip CSS modules
      if (!file.relPath.includes('.module.')) {
        globalCSSFiles.push(file.relPath);
      }
    }
  }

  return globalCSSFiles;
}

/**
 * Analyze design system and styling patterns
 */
export async function analyzeDesignSystem(files: FileInfo[]): Promise<DesignSystemAnalysis> {
  logger.info(`🎨 Analyzing design system in ${files.length} files`);

  // Run all detections in parallel
  const [
    tailwindResult,
    shadcnResult,
    radixResult,
    lucideResult,
    cvaResult,
    tvResult,
    cssModulesResult,
    styledComponentsResult,
    emotionResult,
    globalCSSFiles,
  ] = await Promise.all([
    detectTailwind(files),
    detectShadcnUI(files),
    detectRadixUI(files),
    detectLucideIcons(files),
    detectClassVarianceAuthority(files),
    detectTailwindVariants(files),
    detectCSSModules(files),
    detectStyledComponents(files),
    detectEmotion(files),
    detectGlobalCSS(files),
  ]);

  // Build design libraries array
  const designLibraries: string[] = [];
  if (tailwindResult.hasTailwind) designLibraries.push('Tailwind CSS');
  if (shadcnResult.hasShadcnUI) designLibraries.push('shadcn/ui');
  if (radixResult.hasRadixUI) designLibraries.push('Radix UI');
  if (lucideResult) designLibraries.push('Lucide Icons');
  if (cvaResult) designLibraries.push('class-variance-authority');
  if (tvResult) designLibraries.push('tailwind-variants');
  if (cssModulesResult.hasCSSModules) designLibraries.push('CSS Modules');
  if (styledComponentsResult) designLibraries.push('styled-components');
  if (emotionResult) designLibraries.push('@emotion/styled');

  const analysis: DesignSystemAnalysis = {
    tailwind: tailwindResult.hasTailwind,
    shadcnUI: shadcnResult.hasShadcnUI,
    radixUI: radixResult.hasRadixUI,
    lucideIcons: lucideResult,
    classVarianceAuthority: cvaResult,
    tailwindVariants: tvResult,
    cssModules: cssModulesResult.hasCSSModules,
    styledComponents: styledComponentsResult,
    emotion: emotionResult,
    globalCSS: globalCSSFiles,
    designLibraries,
  };

  logger.info(`🎨 Design system analysis complete: ${designLibraries.length} libraries detected`);
  return analysis;
}
