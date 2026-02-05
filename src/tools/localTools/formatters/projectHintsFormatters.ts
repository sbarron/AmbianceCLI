/**
 * @fileOverview: Enhanced project hints output formatters with actionable intelligence
 * @module: ProjectHintsFormatters
 * @keyFunctions:
 *   - formatProjectHints(): Main formatter dispatcher for project analysis
 *   - formatFolderHints(): Main formatter dispatcher for folder analysis
 *   - formatEnhancedProjectHints(): New enhanced format with capabilities and hints
 *   - formatCompactProjectHints(): Compact project overview
 *   - formatStructuredProjectHints(): Detailed project analysis
 * @context: Provides multiple output formats including new enhanced schema with actionable hints
 */

import * as path from 'path';

/**
 * Main formatter dispatcher for project hints
 */
export function formatProjectHints(hints: any, format: string): string | any {
  switch (format) {
    case 'json':
      // Return raw object for JSON format - let the CLI handle stringification
      // This prevents double JSON encoding
      return hints;

    case 'enhanced':
      return formatEnhancedProjectHints(hints);

    case 'structured':
      return formatStructuredProjectHints(hints);

    case 'compact':
    default:
      return formatCompactProjectHints(hints);
  }
}

/**
 * Main formatter dispatcher for folder hints
 */
export function formatFolderHints(folderHints: any, format: string): string | any {
  switch (format) {
    case 'json':
      // Return raw object for JSON format - let the CLI handle stringification
      return folderHints;

    case 'structured':
      return formatStructuredFolderHints(folderHints);

    case 'compact':
    default:
      return formatCompactFolderHints(folderHints);
  }
}

/**
 * Format project hints in compact format for quick overview
 * Enhanced with surfaces, capabilities, and actionable hints
 */
export function formatCompactProjectHints(hints: any): string {
  // Handle both legacy ProjectHints and new EnhancedProjectSummary
  if (hints.surfaces && hints.capabilities) {
    return formatCompactEnhancedHints(hints);
  }

  // Legacy format with safeguards for missing properties
  const topFunctions =
    hints.symbolHints?.functions
      ?.slice(0, 10)
      ?.map((f: any) => f.word)
      ?.join(', ') || 'No functions detected';

  const topFolders = hints.folderHints
    ? Object.entries(hints.folderHints)
        .slice(0, 5)
        .map(([folder, hint]: [string, any]) => `${folder}: ${hint.purpose}`)
        .join(' | ')
    : 'No folders analyzed';

  return `🏗️ ARCHITECTURE: ${hints.architectureKeywords?.join(', ') || 'Pattern analysis in progress'}
🎯 DOMAIN: ${hints.domainKeywords?.join(', ') || 'Domain detection in progress'}  
📝 LANGUAGES: ${hints.primaryLanguages?.join(', ') || 'Unknown'}
📊 FILES: ${hints.totalFiles || 0} (${hints.codebaseSize || '0 B'})

📁 KEY FOLDERS:
${topFolders}

🔧 TOP FUNCTIONS: ${topFunctions}

🚀 ENTRY POINTS: ${hints.entryPoints?.slice(0, 3)?.join(', ') || 'None detected'}
⚙️ CONFIG: ${hints.configFiles?.slice(0, 3)?.join(', ') || 'None detected'}`;
}

/**
 * Format project hints in structured markdown format for detailed analysis
 * Enhanced with capabilities, surfaces, and actionable intelligence
 */
export function formatStructuredProjectHints(hints: any): string {
  // Handle both legacy ProjectHints and new EnhancedProjectSummary
  if (hints.surfaces && hints.capabilities) {
    return formatStructuredEnhancedHints(hints);
  }

  // Enhanced legacy format with safeguards
  const folderEntries = hints.folderHints ? Object.entries(hints.folderHints) : [];
  const functions = hints.symbolHints?.functions || [];
  const classes = hints.symbolHints?.classes || [];

  return `# 📊 Project Analysis Report

## 🏗️ Architecture Overview
- **Languages:** ${hints.primaryLanguages?.join(', ') || 'Unknown'}
- **Architecture Patterns:** ${hints.architectureKeywords?.join(', ') || 'Analysis in progress'}
- **Domain Focus:** ${hints.domainKeywords?.join(', ') || 'Analysis in progress'}
- **Codebase Size:** ${hints.totalFiles || 0} files (${hints.codebaseSize || '0 B'})

## 📁 Folder Structure
${
  folderEntries.length > 0
    ? folderEntries
        .map(
          ([folder, hint]: [string, any]) =>
            `### ${folder}/
- **Purpose:** ${hint.purpose || 'Unknown purpose'}
- **File Types:** ${hint.fileTypes?.join(', ') || 'Mixed'}
- **Confidence:** ${hint.confidence ? Math.round(hint.confidence * 100) : 0}%`
        )
        .join('\n\n')
    : '- No folders analyzed'
}

## 🔧 Most Common Symbols
### Functions (Top 10)
${
  functions.length > 0
    ? functions
        .slice(0, 10)
        .map(
          (f: any) => `- **${f.word}** (used ${f.count}x across ${f.folders?.length || 0} folders)`
        )
        .join('\n')
    : '- No functions detected'
}

### Classes & Types (Top 5)
${
  classes.length > 0
    ? classes
        .slice(0, 5)
        .map((c: any) => `- **${c.word}** (defined ${c.count}x)`)
        .join('\n')
    : '- No classes detected'
}

## 🚀 Project Entry Points
${
  hints.entryPoints?.length > 0
    ? hints.entryPoints.map((ep: string) => `- ${ep}`).join('\n')
    : '- No entry points detected'
}

## ⚙️ Configuration Files  
${
  hints.configFiles?.length > 0
    ? hints.configFiles.map((cf: string) => `- ${cf}`).join('\n')
    : '- No configuration files detected'
}

---
*Analysis completed: ${hints.lastAnalyzed || new Date().toISOString()}*`;
}

/**
 * Format enhanced project hints with actionable intelligence
 */
export function formatEnhancedProjectHints(summary: any): string {
  const { summary: projectSummary, surfaces, systems, capabilities, risks, hints, next } = summary;

  // Build answer draft if available
  const answerDraft = summary.answerDraft ? `💡 **Quick Answer:** ${summary.answerDraft}\n\n` : '';

  return `${answerDraft}🏗️ **Architecture:** ${projectSummary.languages.join(', ')} • ${projectSummary.files} files (${projectSummary.codebaseSize})
🎯 **Capabilities:** ${capabilities.domains.slice(0, 5).join(', ')}
⚡ **Focus Areas:** ${capabilities.operations.slice(0, 4).join(', ')}

📊 **Public Surfaces:**
• Exports: ${surfaces.exports
    .slice(0, 5)
    .map((exp: any) => `${exp.name} (${exp.kind})`)
    .join(', ')}
• Routes: ${
    surfaces.routes.length > 0
      ? surfaces.routes
          .slice(0, 3)
          .map((r: any) => `${r.method.toUpperCase()} ${r.path}`)
          .join(', ')
      : 'None'
  }
• MCP Tools: ${
    surfaces.mcpTools.length > 0
      ? surfaces.mcpTools
          .slice(0, 3)
          .map((t: any) => t.name)
          .join(', ')
      : 'None'
  }
• Env Keys: ${surfaces.envKeys.slice(0, 5).join(', ')}

🔍 **Top Hints (Ranked):**
${hints
  .slice(0, 5)
  .map(
    (hint: any, i: number) =>
      `${i + 1}. **${hint.symbol || path.basename(hint.file)}** • ${hint.role} (${hint.confidence}) — ${hint.why.join(', ')}`
  )
  .join('\n')}

⚙️ **Systems:**
${systems.db ? `• Database: ${systems.db.engine} (confidence: ${Math.round(systems.db.confidence * 100)}%)` : ''}${systems.db && systems.provider ? '\n' : ''}${systems.provider ? `• Provider: ${systems.provider.initializer} (confidence: ${Math.round(systems.provider.confidence * 100)}%)` : ''}
${systems.architecture.length > 0 ? `• Architecture: ${systems.architecture.join(', ')}` : ''}

${
  risks.flags.length > 0
    ? `⚠️ **Risks (Score: ${risks.score}/100):**\n${risks.flags
        .slice(0, 3)
        .map((flag: any) => `• ${flag.severity.toUpperCase()}: ${flag.message}`)
        .join('\n')}\n\n`
    : ''
}🚀 **Next Actions (${next.mode}):**
• **Open Files:** ${next.openFiles.slice(0, 3).join(', ')}
• **Focus:** ${next.focus}
${next.checks.length > 0 ? `• **Quick Checks:** ${next.checks.slice(0, 2).join(' && ')}` : ''}`;
}

/**
 * Format folder hints in compact format for quick overview
 */
export function formatCompactFolderHints(folderHints: any): string {
  return `📁 ${folderHints.name} | ${folderHints.purpose} | Confidence: ${Math.round(folderHints.confidence * 100)}%
🔧 Key Files: ${folderHints.keyFiles.slice(0, 3).join(', ')}
📦 Dependencies: ${folderHints.dependencies.imports.slice(0, 3).join(', ')}
📁 Subfolders: ${
    folderHints.subFolders.length > 0
      ? folderHints.subFolders
          .map((sf: any) => sf.name)
          .slice(0, 3)
          .join(', ')
      : 'None'
  }`;
}

/**
 * Format folder hints in structured markdown format for detailed analysis
 */
export function formatStructuredFolderHints(folderHints: any): string {
  return `# 📁 Folder Analysis: ${folderHints.name}

## Overview
- **Path:** ${folderHints.path}
- **Purpose:** ${folderHints.purpose}
- **Confidence:** ${Math.round(folderHints.confidence * 100)}%

## 📄 Key Files
${folderHints.keyFiles.map((file: string) => `- ${file}`).join('\n')}

## 🔗 Dependencies
### Imports
${folderHints.dependencies.imports.map((imp: string) => `- ${imp}`).join('\n')}

## 📁 Subfolders (${folderHints.subFolders.length})
${folderHints.subFolders
  .map(
    (sf: any) =>
      `### ${sf.name}/
- ${sf.purpose} (${Math.round(sf.confidence * 100)}% confidence)`
  )
  .join('\n\n')}

## 📝 Analysis
${folderHints.documentation}

---
*Generated: ${folderHints.lastAnalyzed}*`;
}

/**
 * Enhanced compact format using new intelligence
 */
function formatCompactEnhancedHints(summary: any): string {
  const { summary: proj, surfaces, capabilities, hints } = summary;

  // Top actionable items with confidence
  const topHints = hints
    .slice(0, 3)
    .map((h: any, i: number) => `${i + 1}. ${h.symbol || path.basename(h.file)} (${h.confidence})`)
    .join(' • ');

  const exportTypes = surfaces.exports
    .slice(0, 5)
    .map((e: any) => `${e.name}(${e.kind})`)
    .join(', ');

  return `🏗️ **${proj.languages.join('/')}** • ${proj.files} files (${proj.codebaseSize})
🎯 **Capabilities:** ${capabilities.domains.slice(0, 4).join(', ')}
🚀 **Operations:** ${capabilities.operations.slice(0, 4).join(', ')}
⚡ **Integrations:** ${capabilities.integrations.slice(0, 3).join(', ') || 'None detected'}

📊 **Public API:** ${exportTypes}${
    surfaces.mcpTools.length > 0
      ? `
🛠️ **MCP Tools:** ${surfaces.mcpTools
          .slice(0, 3)
          .map((t: any) => t.name)
          .join(', ')}`
      : ''
  }
🌐 **Routes:** ${
    surfaces.routes
      .slice(0, 3)
      .map((r: any) => `${r.method} ${r.path}`)
      .join(', ') || 'None'
  }
🔑 **Env Keys:** ${surfaces.envKeys.slice(0, 5).join(', ')}

🎯 **Top Hints:** ${topHints}
🚀 **Entry Points:** ${proj.entryPoints.slice(0, 3).join(', ')}`;
}

/**
 * Enhanced structured format with full intelligence
 */
function formatStructuredEnhancedHints(summary: any): string {
  const { summary: proj, surfaces, capabilities, systems, risks, hints, next } = summary;

  return `# 🏗️ Project Intelligence Report

## 📋 Executive Summary
- **Languages:** ${proj.languages.join(', ')} (${proj.files} files, ${proj.codebaseSize})
- **Primary Capabilities:** ${capabilities.domains.slice(0, 6).join(', ')}
- **Operations Supported:** ${capabilities.operations.join(', ')}
- **External Integrations:** ${capabilities.integrations.join(', ') || 'Self-contained'}
- **Risk Assessment:** ${risks.score}/100 (${risks.flags.length} issues identified)

## 🔍 Public API Surfaces

### Exported Functions & Classes
${surfaces.exports
  .slice(0, 10)
  .map(
    (exp: any) =>
      `- **${exp.name}** (${exp.kind}) - ${exp.role} \`${path.basename(exp.file)}:${exp.line}\``
  )
  .join('\n')}

### HTTP Routes ${surfaces.routes.length > 0 ? `(${Math.min(surfaces.routes.length, 8)})` : '(None)'}
${
  surfaces.routes
    .slice(0, 8)
    .map(
      (route: any) =>
        `- **${route.method.toUpperCase()} ${route.path}** \`${path.basename(route.file)}:${route.line}\``
    )
    .join('\n') || '- No HTTP routes detected'
}

${
  surfaces.mcpTools.length > 0
    ? `### MCP Tools (${surfaces.mcpTools.length})
${surfaces.mcpTools
  .slice(0, 8)
  .map((tool: any) => `- **${tool.name}** \`${path.basename(tool.file)}:${tool.line}\``)
  .join('\n')}`
    : ''
}

### Environment Configuration
${
  surfaces.envKeys.length > 0
    ? surfaces.envKeys.map((key: string) => `- \`${key}\``).join('\n')
    : '- No environment variables detected'
}

## 🎯 Actionable Intelligence

### Top Ranked Components
${hints
  .slice(0, 7)
  .map((hint: any, i: number) => {
    const symbol = hint.symbol ? `${hint.symbol}` : path.basename(hint.file);
    const location = hint.line ? `:${hint.line}` : '';
    return `${i + 1}. **${symbol}** • ${hint.role} (confidence: ${hint.confidence})\n   📁 \`${hint.file}${location}\`\n   💡 ${hint.why.join(', ')}`;
  })
  .join('\n\n')}

### System Architecture
${systems.db ? `- **Database:** ${systems.db.engine} (${Math.round(systems.db.confidence * 100)}% confidence)\n  - Initializers: ${systems.db.initializers.join(', ')}\n` : ''}${systems.provider ? `- **Provider:** ${systems.provider.initializer} (${Math.round(systems.provider.confidence * 100)}% confidence)\n` : ''}${systems.architecture.length > 0 ? `- **Architecture Patterns:** ${systems.architecture.join(', ')}` : ''}

## ⚠️ Risk Assessment (Score: ${risks.score}/100)
${risks.flags
  .map(
    (flag: any) =>
      `### ${flag.severity.toUpperCase()}: ${flag.type}\n${flag.message}${flag.file ? ` (\`${flag.file}\`)` : ''}`
  )
  .join('\n\n')}

${
  risks.recommendations.length > 0
    ? `### Recommendations\n${risks.recommendations.map((rec: string) => `- ${rec}`).join('\n')}`
    : ''
}

## 🚀 Recommended Next Steps

**Mode:** ${next.mode.replace('_', ' ').toUpperCase()} • **Focus:** ${next.focus}

### Files to Examine
${next.openFiles
  .slice(0, 5)
  .map((file: string) => `- \`${file}\``)
  .join('\n')}

### Quick Validation Commands
${next.checks.map((check: string) => `\`\`\`bash\n${check}\n\`\`\``).join('\n\n')}

---
*Analysis generated: ${new Date().toISOString()}*`;
}

/**
 * Enhanced JSON format with full intelligence data
 */
export function formatEnhancedJSON(summary: any): string {
  // Return enhanced summary with additional metadata
  const enhanced = {
    ...summary,
    _metadata: {
      version: '2.0',
      generatedAt: new Date().toISOString(),
      format: 'enhanced-json',
      capabilities: {
        queryAware: true,
        confidenceScoring: true,
        actionableHints: true,
        riskAssessment: true,
        publicSurfaces: true,
      },
    },
    _quickActions: {
      topFiles: summary.hints.slice(0, 3).map((h: any) => h.file),
      searchTerms: summary.capabilities.domains.slice(0, 5),
      riskLevel: summary.risks.score > 50 ? 'high' : summary.risks.score > 25 ? 'medium' : 'low',
    },
  };

  return JSON.stringify(enhanced, null, 2);
}

/**
 * Enhanced markdown format optimized for AI consumption
 */
export function formatEnhancedMarkdown(summary: any): string {
  const { summary: proj, surfaces, capabilities, systems, risks, hints, next } = summary;

  // Add answer draft if available
  const answerSection = summary.answerDraft
    ? `## 💡 Quick Answer\n\n${summary.answerDraft}\n\n`
    : '';

  return `# Project Intelligence Report\n\n${answerSection}## 🏗️ Architecture & Capabilities\n\n**Languages:** ${proj.languages.join(', ')} • **Files:** ${proj.files} (${proj.codebaseSize})  \n**Domains:** ${capabilities.domains.join(', ')}  \n**Operations:** ${capabilities.operations.join(', ')}  \n**Integrations:** ${capabilities.integrations.join(', ') || 'None'}\n\n## 📊 Public API Surfaces\n\n### Exports (${surfaces.exports.length})\n${surfaces.exports
    .slice(0, 10)
    .map(
      (exp: any) =>
        `- \`${exp.name}\` (${exp.kind}) • ${exp.role} • \`${path.basename(exp.file)}:${exp.line}\``
    )
    .join('\n')}${
    surfaces.mcpTools.length > 0
      ? `\n\n### MCP Tools (${surfaces.mcpTools.length})\n${surfaces.mcpTools
          .map((tool: any) => `- \`${tool.name}\` • \`${path.basename(tool.file)}:${tool.line}\``)
          .join('\n')}`
      : ''
  }\n\n### HTTP Routes (${surfaces.routes.length})\n${
    surfaces.routes
      .map(
        (route: any) =>
          `- \`${route.method.toUpperCase()} ${route.path}\` • \`${path.basename(route.file)}:${route.line}\``
      )
      .join('\n') || '- No HTTP routes detected'
  }\n\n### Environment Variables\n${
    surfaces.envKeys.length > 0
      ? surfaces.envKeys.map((key: string) => `- \`${key}\``).join('\n')
      : '- No environment variables detected'
  }\n\n## 🎯 Actionable Hints (Ranked by Relevance)\n\n${hints
    .map((hint: any, i: number) => {
      const symbol = hint.symbol ? `${hint.symbol}` : path.basename(hint.file);
      const location = hint.line ? `:${hint.line}` : '';
      return `### ${i + 1}. ${symbol} (${hint.confidence})\n\n**Role:** ${hint.role}  \n**File:** \`${hint.file}${location}\`  \n**Reasoning:** ${hint.why.join(', ')}`;
    })
    .join(
      '\n\n'
    )}\n\n## ⚙️ System Detection\n\n${systems.db ? `**Database:** ${systems.db.engine} (${Math.round(systems.db.confidence * 100)}% confidence)\n- Initializers: ${systems.db.initializers.join(', ')}\n\n` : ''}${systems.provider ? `**Provider:** ${systems.provider.initializer} (${Math.round(systems.provider.confidence * 100)}% confidence)\n\n` : ''}${systems.architecture.length > 0 ? `**Architecture:** ${systems.architecture.join(', ')}\n\n` : ''}## ⚠️ Risk Assessment (${risks.score}/100)\n\n${risks.flags
    .map(
      (flag: any) =>
        `**${flag.severity.toUpperCase()}:** ${flag.message}${flag.file ? ` (\`${flag.file}\`)` : ''}`
    )
    .join('\n\n')}\n\n${
    risks.recommendations.length > 0
      ? `### Recommendations\n\n${risks.recommendations.map((rec: string) => `- ${rec}`).join('\n')}`
      : ''
  }\n\n## 🚀 Next Steps\n\n**Mode:** ${next.mode.replace('_', ' ')} • **Focus:** ${next.focus}\n\n### Priority Files\n${next.openFiles.map((file: string) => `- \`${file}\``).join('\n')}\n\n### Validation Commands\n\n${next.checks.map((check: string) => `\`\`\`bash\n${check}\n\`\`\``).join('\n\n')}\n\n---\n*Generated: ${new Date().toISOString()}*`;
}
