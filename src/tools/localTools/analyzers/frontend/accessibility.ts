/**
 * @fileOverview: Accessibility analyzer for React applications
 * @module: AccessibilityAnalyzer
 * @keyFunctions:
 *   - analyzeAccessibility(): Analyze accessibility issues and violations
 *   - detectMissingAltTags(): Identify images missing alt attributes
 *   - detectMissingAriaLabels(): Find interactive elements without proper labeling
 *   - detectSecurityIssues(): Identify external links missing security attributes
 * @context: Detects accessibility violations, missing labels, and security issues
 */

import { readFile } from 'fs/promises';
import type { FileInfo } from '../../../../core/compactor/fileDiscovery';
import { logger } from '../../../../utils/logger';
import { toPosixPath } from './router';

export interface AccessibilityIssue {
  issue: string;
  file: string;
  line: number;
  sample: string;
  severity: 'high' | 'medium' | 'low';
  recommendation: string;
  rule: string;
  fixHint?: string;
  codemod?: string;
}

export interface AccessibilityAnalysis {
  missingAltTags: AccessibilityIssue[];
  missingAriaLabels: AccessibilityIssue[];
  missingSecurityAttributes: AccessibilityIssue[];
  semanticIssues: AccessibilityIssue[];
  // Enhanced rules from M2 plan
  iconButtonsWithoutLabels: AccessibilityIssue[];
  missingLandmarks: AccessibilityIssue[];
  inputsWithoutLabels: AccessibilityIssue[];
  missingH1Headings: AccessibilityIssue[];
}

/**
 * Detect images missing alt attributes
 */
async function detectMissingAltTags(files: FileInfo[]): Promise<AccessibilityIssue[]> {
  const issues: AccessibilityIssue[] = [];

  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Check for <img> tags missing alt attribute
        const imgRegex = /<img\s+([^>]*)>/g;
        let match;
        while ((match = imgRegex.exec(line)) !== null) {
          const imgTag = match[0];
          const attributes = match[1];

          // Check if alt attribute is present and not empty
          const hasAlt = /alt\s*=\s*["'][^"']*["']/.test(attributes);
          const hasEmptyAlt = /alt\s*=\s*["']\s*["']/.test(attributes);

          if (!hasAlt || hasEmptyAlt) {
            issues.push({
              rule: 'A11Y-IMG-ALT',
              issue: 'Image missing alt attribute',
              file: toPosixPath(file.relPath),
              line: index + 1,
              sample: imgTag.substring(0, 80) + (imgTag.length > 80 ? '...' : ''),
              severity: 'high',
              recommendation: 'Add descriptive alt text: alt="Description of the image"',
              fixHint: hasEmptyAlt ? 'alt=""' : 'alt="TODO: Add description"',
              codemod: 'fix-img-alt',
            });
          }
        }

        // Check for Next.js <Image> components missing alt
        const imageRegex = /<Image\s+([^>]*)>/g;
        while ((match = imageRegex.exec(line)) !== null) {
          const imageTag = match[0];
          const attributes = match[1];

          // Check if alt attribute is present and not empty
          const hasAlt = /alt\s*=\s*["'][^"']*["']/.test(attributes);
          const hasEmptyAlt = /alt\s*=\s*["']\s*["']/.test(attributes);

          if (!hasAlt || hasEmptyAlt) {
            issues.push({
              rule: 'A11Y-IMG-ALT',
              issue: 'Next.js Image missing alt attribute',
              file: toPosixPath(file.relPath),
              line: index + 1,
              sample: imageTag.substring(0, 80) + (imageTag.length > 80 ? '...' : ''),
              severity: 'high',
              recommendation: 'Add descriptive alt text: alt="Description of the image"',
              fixHint: hasEmptyAlt ? 'alt=""' : 'alt="TODO: Add description"',
              codemod: 'fix-img-alt',
            });
          }
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return issues;
}

/**
 * Detect interactive elements missing ARIA labels or roles
 */
async function detectMissingAriaLabels(files: FileInfo[]): Promise<AccessibilityIssue[]> {
  const issues: AccessibilityIssue[] = [];

  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Check for button elements
        const buttonRegex = /<button\s+([^>]*)>/g;
        let match;
        while ((match = buttonRegex.exec(line)) !== null) {
          const buttonTag = match[0];
          const attributes = match[1];

          // Check if it has aria-label, aria-labelledby, or visible text content
          const hasAriaLabel = /aria-label\s*=/.test(attributes);
          const hasAriaLabelledBy = /aria-labelledby\s*=/.test(attributes);
          const hasVisibleText = />[^<]+</.test(buttonTag); // Has text between opening and closing tag

          if (!hasAriaLabel && !hasAriaLabelledBy && !hasVisibleText) {
            issues.push({
              rule: 'A11Y-ICON-BUTTON-LABEL',
              issue: 'Button missing accessible label',
              file: toPosixPath(file.relPath),
              line: index + 1,
              sample: buttonTag.substring(0, 80) + (buttonTag.length > 80 ? '...' : ''),
              severity: 'high',
              recommendation: 'Add aria-label, aria-labelledby, or visible text content to button',
              fixHint: 'aria-label="TODO: Add button description"',
              codemod: 'fix-icon-button-label',
            });
          }
        }

        // Check for input elements (excluding hidden, submit, reset)
        const inputRegex =
          /<input\s+([^>]*type\s*=\s*["'](?:text|email|password|search|tel|url|number)["'][^>]*)>/g;
        while ((match = inputRegex.exec(line)) !== null) {
          const inputTag = match[0];
          const attributes = match[1];

          // Check if it has aria-label, aria-labelledby, or associated label
          const hasAriaLabel = /aria-label\s*=/.test(attributes);
          const hasAriaLabelledBy = /aria-labelledby\s*=/.test(attributes);
          const hasId = /id\s*=/.test(attributes);

          // Look for associated label in nearby lines
          let hasAssociatedLabel = false;
          if (hasId) {
            const idMatch = attributes.match(/id\s*=\s*["']([^"']+)["']/);
            if (idMatch) {
              const inputId = idMatch[1];
              // Check a few lines before and after for label
              const startLine = Math.max(0, index - 3);
              const endLine = Math.min(lines.length, index + 4);
              for (let i = startLine; i < endLine; i++) {
                if (
                  lines[i].includes(`for="${inputId}"`) ||
                  lines[i].includes(`for='${inputId}'`)
                ) {
                  hasAssociatedLabel = true;
                  break;
                }
              }
            }
          }

          if (!hasAriaLabel && !hasAriaLabelledBy && !hasAssociatedLabel) {
            issues.push({
              rule: 'A11Y-LABEL-FOR',
              issue: 'Input missing accessible label',
              file: toPosixPath(file.relPath),
              line: index + 1,
              sample: inputTag.substring(0, 80) + (inputTag.length > 80 ? '...' : ''),
              severity: 'high',
              recommendation:
                'Add aria-label, aria-labelledby, or associate with a <label> element',
              fixHint: 'aria-label="TODO: Add input description"',
              codemod: 'fix-input-label',
            });
          }
        }

        // Check for custom interactive elements with role="button"
        const roleButtonRegex = /role\s*=\s*["']button["']\s+([^>]*)>/g;
        while ((match = roleButtonRegex.exec(line)) !== null) {
          const elementAttrs = match[1];

          // Check if it has aria-label, aria-labelledby, or visible text content
          const hasAriaLabel = /aria-label\s*=/.test(elementAttrs);
          const hasAriaLabelledBy = /aria-labelledby\s*=/.test(elementAttrs);

          if (!hasAriaLabel && !hasAriaLabelledBy) {
            // Find the opening tag to get the full element
            const elementMatch = line.match(/<[^>]*role\s*=\s*["']button["'][^>]*>/);
            if (elementMatch) {
              issues.push({
                rule: 'A11Y-ROLE-BUTTON',
                issue: 'Interactive element with role="button" missing accessible label',
                file: toPosixPath(file.relPath),
                line: index + 1,
                sample:
                  elementMatch[0].substring(0, 80) + (elementMatch[0].length > 80 ? '...' : ''),
                severity: 'high',
                recommendation: 'Add aria-label or aria-labelledby to element with role="button"',
              });
            }
          }
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return issues;
}

/**
 * Detect external links missing security attributes
 */
async function detectMissingSecurityAttributes(files: FileInfo[]): Promise<AccessibilityIssue[]> {
  const issues: AccessibilityIssue[] = [];

  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Check for anchor tags with target="_blank"
        const anchorRegex = /<a\s+([^>]*)target\s*=\s*["']_blank["']([^>]*)>/g;
        let match;
        while ((match = anchorRegex.exec(line)) !== null) {
          const anchorTag = match[0];
          const beforeTarget = match[1];
          const afterTarget = match[2];

          // Check if it has rel="noopener noreferrer" or similar
          const hasNoopener = /rel\s*=.*noopener/.test(beforeTarget + afterTarget);
          const hasNoreferrer = /rel\s*=.*noreferrer/.test(beforeTarget + afterTarget);

          if (!hasNoopener || !hasNoreferrer) {
            issues.push({
              rule: 'A11Y-SEC-001',
              issue: 'External link missing security attributes',
              file: toPosixPath(file.relPath),
              line: index + 1,
              sample: anchorTag.substring(0, 80) + (anchorTag.length > 80 ? '...' : ''),
              severity: 'medium',
              recommendation:
                'Add rel="noopener noreferrer" to external links with target="_blank"',
            });
          }
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return issues;
}

/**
 * Detect semantic HTML issues
 */
async function detectSemanticIssues(files: FileInfo[]): Promise<AccessibilityIssue[]> {
  const issues: AccessibilityIssue[] = [];

  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Check for using div instead of semantic elements for headings
        if (line.includes('className') || line.includes('class=')) {
          // Look for div with heading-like class names
          const headingClasses = ['title', 'heading', 'headline', 'header'];
          const hasHeadingClass = headingClasses.some(
            cls =>
              line.includes(`className="${cls}`) ||
              line.includes(`className='${cls}`) ||
              line.includes(`class="${cls}`) ||
              line.includes(`class='${cls}`)
          );

          if (hasHeadingClass && line.includes('<div')) {
            issues.push({
              rule: 'A11Y-SEMANTIC-HEADING',
              issue: 'Using div instead of semantic heading element',
              file: toPosixPath(file.relPath),
              line: index + 1,
              sample: line.trim().substring(0, 80) + (line.length > 80 ? '...' : ''),
              severity: 'medium',
              recommendation: 'Use <h1>, <h2>, etc. instead of div for headings',
            });
          }

          // Look for div with navigation-like class names
          const navClasses = ['nav', 'navigation', 'menu'];
          const hasNavClass = navClasses.some(
            cls =>
              line.includes(`className="${cls}`) ||
              line.includes(`className='${cls}`) ||
              line.includes(`class="${cls}`) ||
              line.includes(`class='${cls}`)
          );

          if (hasNavClass && line.includes('<div')) {
            issues.push({
              rule: 'A11Y-SEMANTIC-NAV',
              issue: 'Using div instead of semantic nav element',
              file: toPosixPath(file.relPath),
              line: index + 1,
              sample: line.trim().substring(0, 80) + (line.length > 80 ? '...' : ''),
              severity: 'medium',
              recommendation: 'Use <nav> instead of div for navigation elements',
            });
          }
        }

        // Check for label/htmlFor mismatches
        const labelRegex = /<label\s+([^>]*)>/g;
        let match;
        while ((match = labelRegex.exec(line)) !== null) {
          const labelTag = match[0];
          const attributes = match[1];

          // Check if label has htmlFor (or 'for' in HTML)
          const hasHtmlFor = /htmlFor\s*=/.test(attributes) || /for\s*=/.test(attributes);

          if (!hasHtmlFor) {
            issues.push({
              rule: 'A11Y-LABEL-FOR',
              issue: 'Label element missing htmlFor attribute',
              file: toPosixPath(file.relPath),
              line: index + 1,
              sample: labelTag.substring(0, 80) + (labelTag.length > 80 ? '...' : ''),
              severity: 'high',
              recommendation: 'Add htmlFor attribute to associate label with form control',
            });
          }
        }

        // Check for role="button" elements missing keyboard handlers
        const roleButtonRegex = /role\s*=\s*["']button["']/g;
        if (roleButtonRegex.test(line)) {
          // Check if the element has keyboard event handlers
          const hasKeyHandlers = /onKeyDown\s*=|onKeyUp\s*=|onKeyPress\s*=/.test(line);

          if (!hasKeyHandlers) {
            const elementMatch = line.match(/<[^>]*role\s*=\s*["']button["'][^>]*>/);
            if (elementMatch) {
              issues.push({
                rule: 'A11Y-KEYBOARD-HANDLER',
                issue: 'Interactive element with role="button" missing keyboard handlers',
                file: toPosixPath(file.relPath),
                line: index + 1,
                sample:
                  elementMatch[0].substring(0, 80) + (elementMatch[0].length > 80 ? '...' : ''),
                severity: 'high',
                recommendation: 'Add onKeyDown handler to make element keyboard accessible',
              });
            }
          }
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return issues;
}

/**
 * Detect missing semantic landmarks in page components
 */
async function detectMissingLandmarks(files: FileInfo[]): Promise<AccessibilityIssue[]> {
  const issues: AccessibilityIssue[] = [];

  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;

    // Focus on page components (likely in app directory or pages)
    const isPageComponent =
      file.relPath.includes('/page.') ||
      file.relPath.includes('/pages/') ||
      file.relPath.match(/\/[^\/]*\/page\./);

    if (!isPageComponent) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const lines = content.split('\n');

      // Check if page has semantic landmarks
      const hasMain = /<main[^>]*>/.test(content);
      const hasNav = /<nav[^>]*>/.test(content);
      const hasHeader = /<header[^>]*>/.test(content);
      const hasFooter = /<footer[^>]*>/.test(content);

      if (!hasMain && !hasNav && !hasHeader && !hasFooter) {
        // Find the top-level return statement or JSX
        let returnLine = -1;
        for (let i = 0; i < lines.length; i++) {
          if (
            lines[i].includes('return') &&
            (lines[i].includes('<') || lines[i + 1]?.includes('<'))
          ) {
            returnLine = i;
            break;
          }
        }

        if (returnLine !== -1) {
          issues.push({
            rule: 'A11Y-LANDMARKS',
            issue: 'Page missing semantic landmarks',
            file: toPosixPath(file.relPath),
            line: returnLine + 1,
            sample: lines[returnLine]?.trim().substring(0, 80) + '...',
            severity: 'medium',
            recommendation: 'Add semantic landmarks like <main>, <nav>, <header>, or <footer>',
            fixHint: '<main>...</main>',
            codemod: 'wrap-with-main',
          });
        }
      }
    } catch (error) {
      // Continue with next file
    }
  }

  return issues;
}

/**
 * Detect missing H1 headings in page components
 */
async function detectMissingH1Headings(files: FileInfo[]): Promise<AccessibilityIssue[]> {
  const issues: AccessibilityIssue[] = [];

  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;

    // Focus on page components
    const isPageComponent =
      file.relPath.includes('/page.') ||
      file.relPath.includes('/pages/') ||
      file.relPath.match(/\/[^\/]*\/page\./);

    if (!isPageComponent) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');

      // Check for H1 heading
      const hasH1 = /<h1[^>]*>|<H1[^>]*>/.test(content);
      const hasAnyHeading = /<h[1-6][^>]*>|<H[1-6][^>]*>/.test(content);

      if (!hasH1 && hasAnyHeading) {
        // Find first heading to suggest replacement
        const lines = content.split('\n');
        let firstHeadingLine = -1;
        let firstHeadingMatch = '';

        for (let i = 0; i < lines.length; i++) {
          const headingMatch = lines[i].match(/(<h[1-6][^>]*>|<H[1-6][^>]*>)/);
          if (headingMatch) {
            firstHeadingLine = i;
            firstHeadingMatch = headingMatch[1];
            break;
          }
        }

        if (firstHeadingLine !== -1) {
          issues.push({
            rule: 'A11Y-HEADING-ORDER',
            issue: 'Page missing H1 heading',
            file: toPosixPath(file.relPath),
            line: firstHeadingLine + 1,
            sample: firstHeadingMatch + '...',
            severity: 'medium',
            recommendation: 'Ensure each page has exactly one H1 heading',
            fixHint: 'Convert first heading to <h1>',
            codemod: 'insert-h1',
          });
        }
      }
    } catch (error) {
      // Continue with next file
    }
  }

  return issues;
}

/**
 * Detect icon-only buttons without labels (separate from general button check)
 */
async function detectIconButtonsWithoutLabels(files: FileInfo[]): Promise<AccessibilityIssue[]> {
  const issues: AccessibilityIssue[] = [];

  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Look for buttons that might contain only icons
        const buttonRegex = /<button\s+([^>]*)>([^<]*)(?:<[^>]*>[^<]*<\/[^>]*>)*<\/button>/gi;
        let match;

        while ((match = buttonRegex.exec(line)) !== null) {
          const buttonContent = match[2];
          const attributes = match[1];
          const fullButton = match[0];

          // Check if button content appears to be only an icon (no text)
          const hasTextContent = /[^\s]/.test(buttonContent) && !/<[^>]*>/.test(buttonContent);
          const hasIconLikeContent = /icon|Icon|svg|SVG|<[^>]*class[^>]*(?:icon|Icon)[^>]*>/.test(
            fullButton
          );
          const hasAriaLabel = /aria-label\s*=/.test(attributes);
          const hasAriaLabelledBy = /aria-labelledby\s*=/.test(attributes);

          // If it looks like an icon-only button without proper labeling
          if (!hasTextContent && hasIconLikeContent && !hasAriaLabel && !hasAriaLabelledBy) {
            issues.push({
              rule: 'A11Y-ICON-BUTTON-LABEL',
              issue: 'Icon button missing accessible label',
              file: toPosixPath(file.relPath),
              line: index + 1,
              sample: fullButton.substring(0, 80) + (fullButton.length > 80 ? '...' : ''),
              severity: 'high',
              recommendation: 'Add aria-label to describe the button action',
              fixHint: 'aria-label="TODO: Describe button action"',
              codemod: 'fix-icon-button-label',
            });
          }
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return issues;
}

/**
 * Detect inputs without proper labels (comprehensive check)
 */
async function detectInputsWithoutLabels(files: FileInfo[]): Promise<AccessibilityIssue[]> {
  const issues: AccessibilityIssue[] = [];

  for (const file of files) {
    if (!file.relPath.endsWith('.tsx') && !file.relPath.endsWith('.jsx')) continue;

    try {
      const content = await readFile(file.absPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Check for various input types
        const inputTypes = [
          'text',
          'email',
          'password',
          'search',
          'tel',
          'url',
          'number',
          'date',
          'datetime-local',
        ];
        const inputRegex = new RegExp(
          `<input\\s+([^>]*type\\s*=\\s*["'](?:${inputTypes.join('|')})["'][^>]*)>`,
          'gi'
        );
        let match;

        while ((match = inputRegex.exec(line)) !== null) {
          const inputTag = match[0];
          const attributes = match[1];

          // Check for labeling methods
          const hasAriaLabel = /aria-label\s*=/.test(attributes);
          const hasAriaLabelledBy = /aria-labelledby\s*=/.test(attributes);
          const hasId = /id\s*=/.test(attributes);

          let hasAssociatedLabel = false;
          if (hasId) {
            const idMatch = attributes.match(/id\s*=\s*["']([^"']+)["']/);
            if (idMatch) {
              const inputId = idMatch[1];
              // Look for associated label in nearby context (expanded search)
              const searchStart = Math.max(0, index - 10);
              const searchEnd = Math.min(lines.length, index + 10);

              for (let i = searchStart; i < searchEnd; i++) {
                if (
                  lines[i].includes(`htmlFor="${inputId}"`) ||
                  lines[i].includes(`for="${inputId}"`) ||
                  lines[i].includes(`htmlFor='${inputId}'`) ||
                  lines[i].includes(`for='${inputId}'`)
                ) {
                  hasAssociatedLabel = true;
                  break;
                }
              }
            }
          }

          if (!hasAriaLabel && !hasAriaLabelledBy && !hasAssociatedLabel) {
            issues.push({
              rule: 'A11Y-LABEL-FOR',
              issue: 'Form input missing accessible label',
              file: toPosixPath(file.relPath),
              line: index + 1,
              sample: inputTag.substring(0, 80) + (inputTag.length > 80 ? '...' : ''),
              severity: 'high',
              recommendation:
                'Add aria-label, aria-labelledby, or associate with a <label> element',
              fixHint: 'aria-label="TODO: Add field description"',
              codemod: 'attach-label',
            });
          }
        }
      });
    } catch (error) {
      // Continue with next file
    }
  }

  return issues;
}

/**
 * Analyze accessibility issues in files
 */
export async function analyzeAccessibility(files: FileInfo[]): Promise<AccessibilityAnalysis> {
  logger.info(`♿ Analyzing accessibility issues in ${files.length} files`);

  // Run all accessibility checks in parallel
  const [
    missingAltTags,
    missingAriaLabels,
    missingSecurityAttributes,
    semanticIssues,
    iconButtonsWithoutLabels,
    missingLandmarks,
    inputsWithoutLabels,
    missingH1Headings,
  ] = await Promise.all([
    detectMissingAltTags(files),
    detectMissingAriaLabels(files),
    detectMissingSecurityAttributes(files),
    detectSemanticIssues(files),
    detectIconButtonsWithoutLabels(files),
    detectMissingLandmarks(files),
    detectInputsWithoutLabels(files),
    detectMissingH1Headings(files),
  ]);

  const analysis: AccessibilityAnalysis = {
    missingAltTags,
    missingAriaLabels,
    missingSecurityAttributes,
    semanticIssues,
    iconButtonsWithoutLabels,
    missingLandmarks,
    inputsWithoutLabels,
    missingH1Headings,
  };

  const totalIssues =
    missingAltTags.length +
    missingAriaLabels.length +
    missingSecurityAttributes.length +
    semanticIssues.length +
    iconButtonsWithoutLabels.length +
    missingLandmarks.length +
    inputsWithoutLabels.length +
    missingH1Headings.length;

  logger.info(
    `♿ Accessibility analysis complete: ${totalIssues} issues found (${missingAltTags.length} alt tags, ${missingAriaLabels.length} labels, ${missingSecurityAttributes.length} security, ${semanticIssues.length} semantic, ${iconButtonsWithoutLabels.length} icon buttons, ${missingLandmarks.length} landmarks, ${inputsWithoutLabels.length} inputs, ${missingH1Headings.length} headings)`
  );
  return analysis;
}
