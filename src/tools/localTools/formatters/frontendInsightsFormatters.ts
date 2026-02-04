/**
 * @fileOverview: Formatters for frontend insights output
 * @module: FrontendInsightsFormatters
 * @keyFunctions:
 *   - formatFrontendInsights(): Format FrontendInsights data in various output formats
 * @context: Provides consistent formatting for frontend analysis results
 */

import type { FrontendInsights } from '../frontendInsights';

/**
 * Format frontend insights data in various output formats
 */
export function formatFrontendInsights(
  data: FrontendInsights,
  format: 'structured' | 'json' | 'compact' | 'markdown'
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);

    case 'compact':
      return formatCompactFrontendInsights(data);

    case 'markdown':
      return formatMarkdownFrontendInsights(data);

    case 'structured':
    default:
      return formatStructuredFrontendInsights(data);
  }
}

/**
 * Format as structured text output
 */
function formatStructuredFrontendInsights(data: FrontendInsights): string {
  let output = `🔍 Frontend Insights Analysis\n`;
  output += `Generated: ${data.generatedAt}\n\n`;

  // Summary
  output += `📊 SUMMARY\n`;
  output += `Pages: ${data.summary.pages}`;
  if (data.routes.pages?.length) {
    const examples = data.routes.pages
      .slice(0, 3)
      .map((p: { path: string }) => p.path)
      .join(', ');
    output += ` (e.g., ${examples})`;
  }
  output += `\n`;
  output += `Components: ${data.summary.clientComponents} client, ${data.summary.serverComponents} server\n`;
  output += `State Stores: ${data.summary.stateStores.join(', ') || 'None detected'}\n`;
  output += `Data Libraries: ${data.summary.dataLibraries.join(', ') || 'None detected'}\n`;
  output += `Design System: ${data.summary.designSystem.join(', ') || 'None detected'}\n\n`;

  // File Composition
  if (data.summary.fileComposition) {
    output += `📁 FILE COMPOSITION\n`;
    output += `Total Files: ${data.summary.fileComposition.totalFiles}\n`;
    output += `Analyzed Files: ${data.summary.fileComposition.analyzedFiles}\n`;

    // Sort file types by count (descending)
    const sortedTypes = Object.entries(data.summary.fileComposition.byType)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10); // Show top 10

    if (sortedTypes.length > 0) {
      output += `Top File Types: ${sortedTypes.map(([ext, count]) => `${ext}: ${count}`).join(', ')}\n`;
    }

    // Show filtered out files if any
    const filteredTypes = Object.entries(data.summary.fileComposition.filteredOut)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    if (filteredTypes.length > 0) {
      const filteredCount = Object.values(data.summary.fileComposition.filteredOut).reduce(
        (sum, count) => sum + count,
        0
      );
      output += `Filtered Out: ${filteredCount} files (${filteredTypes.map(([ext, count]) => `${ext}: ${count}`).join(', ')}`;
      if (Object.keys(data.summary.fileComposition.filteredOut).length > 5) {
        output += ', ...';
      }
      output += ')\n';
    }
    output += '\n';
  }

  // Routes
  const totalRoutes = data.routes.pages.length + data.routes.handlers.length;
  if (totalRoutes > 0) {
    output += `🛣️ ROUTES (${totalRoutes})\n`;

    if (data.routes.pages.length > 0) {
      output += `  Pages (${data.routes.pages.length}):\n`;
      data.routes.pages
        .slice(0, 5)
        .forEach(
          (page: {
            path: string;
            clientIslandExamples?: string[];
            clientIslands: number;
            layout?: string;
            routeGroup?: string;
            parallelRoutes?: string[];
          }) => {
            const ex =
              page.clientIslandExamples && page.clientIslandExamples.length
                ? ` [e.g., ${page.clientIslandExamples.join(', ')}]`
                : '';
            output += `    ${page.path} (${page.clientIslands} client islands)${ex}\n`;
            if (page.layout) output += `      Layout: ${page.layout}\n`;
            if (page.routeGroup) output += `      Group: (${page.routeGroup})\n`;
            if (page.parallelRoutes && page.parallelRoutes.length > 0) {
              output += `      Parallel: @${page.parallelRoutes.join(', @')}\n`;
            }
          }
        );
      if (data.routes.pages.length > 5)
        output += `    ... and ${data.routes.pages.length - 5} more pages\n`;
    }

    if (data.routes.handlers.length > 0) {
      output += `  Handlers (${data.routes.handlers.length}):\n`;
      data.routes.handlers
        .slice(0, 5)
        .forEach((handler: { method: string; path: string; file: string }) => {
          output += `    ${handler.method} ${handler.path} in ${handler.file}\n`;
        });
      if (data.routes.handlers.length > 5)
        output += `    ... and ${data.routes.handlers.length - 5} more handlers\n`;
    }
    output += '\n';
  }

  // Boundaries
  if (data.boundaries && data.boundaries.length > 0) {
    const clientBoundaries = data.boundaries.filter((b: any) => b.kind === 'client');
    const serverBoundaries = data.boundaries.filter((b: any) => b.kind === 'server');

    output += `🔄 BOUNDARIES\n`;
    output += `  Client Components: ${clientBoundaries.length}\n`;
    output += `  Server Components: ${serverBoundaries.length}\n`;

    if (clientBoundaries.length > 0) {
      output += `  Client files (${Math.min(clientBoundaries.length, 3)}):\n`;
      clientBoundaries.slice(0, 3).forEach((boundary: any) => {
        output += `    ${boundary.file}\n`;
      });
      if (clientBoundaries.length > 3)
        output += `    ... and ${clientBoundaries.length - 3} more\n`;
    }
    output += '\n';
  }

  // Components
  if (data.components.length > 0) {
    output += `⚛️ COMPONENTS (${data.components.length})\n`;
    data.components
      .slice(0, 10)
      .forEach((comp: { name: string; file: string; kind: string; hooks: string[] }) => {
        output += `  ${comp.name} (${comp.kind})\n`;
        output += `    File: ${comp.file}\n`;
        if (comp.hooks.length > 0) output += `    Hooks: ${comp.hooks.join(', ')}\n`;
        output += '\n';
      });
    if (data.components.length > 10) {
      output += `  ... and ${data.components.length - 10} more components\n\n`;
    }
  }

  // Data Flow
  if (data.dataFlow.endpoints.length > 0 || data.summary.stateStores.length > 0) {
    output += `🔄 DATA FLOW\n`;

    if (data.dataFlow.endpoints.length > 0) {
      output += `  Endpoints: ${data.dataFlow.endpoints.length}\n`;
      data.dataFlow.endpoints
        .slice(0, 5)
        .forEach((ep: { method: string; path: string; usedBy: string[] }) => {
          output += `    ${ep.method} ${ep.path} (used by ${ep.usedBy.length} components)\n`;
        });
      if (data.dataFlow.endpoints.length > 5)
        output += `    ... and ${data.dataFlow.endpoints.length - 5} more\n`;
    }

    if (data.dataFlow.duplicateEndpoints.length > 0) {
      output += `  ⚠️ Duplicate calls: ${data.dataFlow.duplicateEndpoints.length} detected\n`;
      data.dataFlow.duplicateEndpoints
        .slice(0, 3)
        .forEach(
          (dup: {
            fingerprint: string;
            method: string;
            path: string;
            count: number;
            files: string[];
            suggestion: string;
          }) => {
            output += `    ${dup.method} ${dup.path} used ${dup.count} times in ${dup.files.length} files\n`;
          }
        );
      if (data.dataFlow.duplicateEndpoints.length > 3) {
        output += `    ... and ${data.dataFlow.duplicateEndpoints.length - 3} more duplicate patterns\n`;
      }
    }

    if (data.summary.stateStores.length > 0) {
      output += `  State Stores: ${data.summary.stateStores.join(', ')}\n`;
    }
  }

  // Environment & Leaks
  if (
    data.env.nextPublic.length > 0 ||
    data.env.clientLeaks.length > 0 ||
    data.env.leaks.length > 0
  ) {
    output += `\n🌍 ENVIRONMENT & LEAKS\n`;
    if (data.env.nextPublic.length > 0) {
      output += `  Public vars: ${data.env.nextPublic.join(', ')}\n`;
    }
    if (data.env.clientLeaks.length > 0) {
      output += `  ⚠️ Client env leaks: ${data.env.clientLeaks.length} detected\n`;
    }
    if (data.env.leaks.length > 0) {
      const leaksByCategory = data.env.leaks.reduce(
        (acc: Record<string, number>, leak: { category: string }) => {
          acc[leak.category] = (acc[leak.category] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      output += `  🚨 Security Issues: ${data.env.leaks.length} detected\n`;
      Object.entries(leaksByCategory).forEach(([category, count]) => {
        output += `    ${category}: ${count}\n`;
      });

      // Show top 5 leaks
      data.env.leaks.slice(0, 5).forEach((leak: any) => {
        output += `    ⚠️ ${leak.category} in ${leak.file}:${leak.line} - ${leak.why}\n`;
        if (leak.fixHint) {
          output += `      💡 ${leak.fixHint}\n`;
        }
        if (leak.replacement) {
          output += `      🔧 Replace with: ${leak.replacement}\n`;
        }
      });
      if (data.env.leaks.length > 5) {
        output += `    ... and ${data.env.leaks.length - 5} more leaks\n`;
      }
    }
  }

  // Performance
  if (
    data.performance.heavyClientImports.length > 0 ||
    data.performance.noDynamicCandidates.length > 0 ||
    (data.performance as any).perRouteAnalysis?.length > 0
  ) {
    output += `\n⚡ PERFORMANCE\n`;

    // Per-route analysis
    const perRouteAnalysis = (data.performance as any).perRouteAnalysis;
    if (perRouteAnalysis && perRouteAnalysis.length > 0) {
      output += `📊 PER-ROUTE ANALYSIS\n`;
      perRouteAnalysis.slice(0, 5).forEach((route: any) => {
        // Show top 5 routes
        output += `  🛣️ Route: ${route.path}\n`;
        output += `    Total: ${route.totalSizeKB}KB, Client: ${route.clientSizeKB}KB\n`;

        if (route.topDeps && route.topDeps.length > 0) {
          output += `    Top dependencies:\n`;
          route.topDeps.slice(0, 3).forEach((dep: any) => {
            output += `      ${dep.name} (${dep.sizeKB}KB, ${dep.category})\n`;
          });
        }

        if (route.splitCandidates && route.splitCandidates.length > 0) {
          output += `    Split candidates: ${route.splitCandidates.length}\n`;
          route.splitCandidates.slice(0, 2).forEach((candidate: any) => {
            output += `      ${candidate.component.split('/').pop()} (${candidate.potentialSavingsKB}KB savings)\n`;
          });
        }
        output += `\n`;
      });

      if (perRouteAnalysis.length > 5) {
        output += `  ... and ${perRouteAnalysis.length - 5} more routes\n`;
      }
    }

    if (data.performance.heavyClientImports.length > 0) {
      output += `⚠️ HEAVY IMPORTS (${data.performance.heavyClientImports.length})\n`;
      data.performance.heavyClientImports.slice(0, 3).forEach((imp: any) => {
        output += `  ${imp.import} in ${imp.file} (${imp.sizeHint})\n`;
      });
      if (data.performance.heavyClientImports.length > 3) {
        output += `  ... and ${data.performance.heavyClientImports.length - 3} more\n`;
      }
    }

    if (data.performance.noDynamicCandidates.length > 0) {
      output += `📦 DYNAMIC IMPORT CANDIDATES (${data.performance.noDynamicCandidates.length})\n`;
      data.performance.noDynamicCandidates.slice(0, 3).forEach((file: string) => {
        output += `  ${file}\n`;
      });
      if (data.performance.noDynamicCandidates.length > 3) {
        output += `  ... and ${data.performance.noDynamicCandidates.length - 3} more\n`;
      }
    }
  }

  // Accessibility
  if (data.accessibility.length > 0) {
    output += `\n♿ ACCESSIBILITY (${data.accessibility.length} issues)\n`;

    // Group by rule for better organization
    const issuesByRule = data.accessibility.reduce(
      (acc: Record<string, typeof data.accessibility>, issue) => {
        if (!acc[issue.rule]) acc[issue.rule] = [];
        acc[issue.rule].push(issue);
        return acc;
      },
      {} as Record<string, typeof data.accessibility>
    );

    Object.entries(issuesByRule)
      .slice(0, 5)
      .forEach(([rule, issues]: [string, typeof data.accessibility]) => {
        output += `  ${rule} (${issues.length} issues):\n`;
        issues.slice(0, 3).forEach((issue: (typeof data.accessibility)[0]) => {
          output += `    ⚠️ ${issue.file}:${issue.line} - ${issue.issue || issue.sample}\n`;
          if (issue.fixHint) {
            output += `      💡 ${issue.fixHint}\n`;
          }
          if (issue.codemod) {
            output += `      🔧 pnpm fix:a11y --rule=${issue.codemod}\n`;
          }
        });
        if (issues.length > 3) {
          output += `    ... and ${issues.length - 3} more ${rule} issues\n`;
        }
      });

    if (Object.keys(issuesByRule).length > 5) {
      const remainingRules = Object.keys(issuesByRule).length - 5;
      output += `  ... and ${remainingRules} more rule categories\n`;
    }

    output += `\n  💡 Run 'pnpm fix:a11y' to apply automated fixes\n`;
  }

  // Risks
  const trustedScore = (data.risks as any).trustedScore || data.risks.score;
  const scoreReductionActions = (data.risks as any).scoreReductionActions || [];

  if (trustedScore > 0 || data.risks.rules.length > 0) {
    output += `\n🚨 RISKS (Trusted Score: ${trustedScore})\n\n`;

    if (data.risks.rules.length > 0) {
      output += `Issues Found:\n`;
      data.risks.rules.forEach((rule: { id: string; why: string; evidence: string[] }) => {
        output += `  ${rule.id}: ${rule.why}\n`;
        if (rule.evidence.length > 0) {
          output += `    Evidence: ${rule.evidence.slice(0, 2).join(', ')}\n`;
          if (rule.evidence.length > 2) {
            output += `    ... and ${rule.evidence.length - 2} more\n`;
          }
        }
      });
      output += '\n';
    }

    // Score Reduction Actions (Top 5)
    if (scoreReductionActions.length > 0) {
      output += `🎯 TOP ACTIONS TO REDUCE SCORE BY 15+ POINTS:\n`;
      scoreReductionActions.forEach((action: any, index: number) => {
        const priorityEmoji =
          action.priority === 'high' ? '🔴' : action.priority === 'medium' ? '🟡' : '🟢';
        output += `  ${index + 1}. ${priorityEmoji} ${action.action}\n`;
        output += `     📉 Estimated reduction: -${action.estimatedReduction} points\n`;
        output += `     📂 Category: ${action.category}\n`;
        if (action.files && action.files.length > 0) {
          output += `     📄 Files: ${action.files.slice(0, 2).join(', ')}\n`;
          if (action.files.length > 2) {
            output += `     ... and ${action.files.length - 2} more files\n`;
          }
        }
        output += '\n';
      });
    }
  }

  // Recommendations
  if (data.recommendedNextSteps.length > 0) {
    output += `\n💡 RECOMMENDED NEXT STEPS\n`;
    data.recommendedNextSteps.forEach((step: { title: string; files?: string[] }) => {
      output += `  • ${step.title}\n`;
      if (step.files && step.files.length > 0) {
        output += `    Files: ${step.files.slice(0, 3).join(', ')}\n`;
        if (step.files.length > 3) output += `    ... and ${step.files.length - 3} more\n`;
      }
    });
  }

  return output;
}

/**
 * Format as compact output
 */
function formatCompactFrontendInsights(data: FrontendInsights): string {
  const totalRoutes = data.routes.pages.length + data.routes.handlers.length;
  const clientBoundaries = data.boundaries?.filter((b: any) => b.kind === 'client').length || 0;
  const duplicates = data.dataFlow.duplicateEndpoints?.length || 0;
  const trustedScore = (data.risks as any).trustedScore || data.risks.score;
  const summary = [
    `Pages: ${data.summary.pages}`,
    `Components: ${data.summary.clientComponents + data.summary.serverComponents}`,
    `Routes: ${totalRoutes}`,
    `Client: ${clientBoundaries}`,
    `Duplicates: ${duplicates}`,
    `Risks: ${trustedScore}`,
  ].join(' | ');

  const issues = [];
  if (data.env.clientLeaks.length > 0) issues.push(`Env: ${data.env.clientLeaks.length} leaks`);
  if (data.env.leaks.length > 0) issues.push(`Security: ${data.env.leaks.length} issues`);
  if (data.performance.heavyClientImports.length > 0)
    issues.push(`Perf: ${data.performance.heavyClientImports.length} heavy`);
  if (data.accessibility.length > 0) {
    const highPriority = data.accessibility.filter(
      (a: (typeof data.accessibility)[0]) => a.severity === 'high'
    ).length;
    issues.push(`A11y: ${data.accessibility.length} (${highPriority} high)`);
  }

  return `${summary}${issues.length > 0 ? ' | ' + issues.join(' | ') : ''}`;
}

/**
 * Format as markdown
 */
function formatMarkdownFrontendInsights(data: FrontendInsights): string {
  let output = `# Frontend Insights Analysis\n\n`;
  output += `*Generated: ${data.generatedAt}*\n\n`;

  // Summary
  output += `## 📊 Summary\n\n`;
  output += `- **Pages:** ${data.summary.pages}\n`;
  output += `- **Components:** ${data.summary.clientComponents} client, ${data.summary.serverComponents} server\n`;
  const totalRoutes = data.routes.pages.length + data.routes.handlers.length;
  output += `- **Routes:** ${totalRoutes}\n`;
  const clientBoundaries = data.boundaries?.filter((b: any) => b.kind === 'client').length || 0;
  const serverBoundaries = data.boundaries?.filter((b: any) => b.kind === 'server').length || 0;
  output += `- **Boundaries:** ${clientBoundaries} client, ${serverBoundaries} server\n`;
  const duplicates = data.dataFlow.duplicateEndpoints?.length || 0;
  output += `- **Duplicate Calls:** ${duplicates}\n`;
  output += `- **Risk Score:** ${data.risks.score}\n\n`;

  // Routes
  if (totalRoutes > 0) {
    output += `## 🛣️ Routes\n\n`;

    if (data.routes.pages.length > 0) {
      output += `### Pages\n\n`;
      output += `| Path | Client Islands |\n`;
      output += `|------|---------------|\n`;
      data.routes.pages.slice(0, 5).forEach((page: (typeof data.routes.pages)[0]) => {
        output += `| \`${page.path}\` | ${page.clientIslands} |\n`;
      });
      output += '\n';
    }

    if (data.routes.handlers.length > 0) {
      output += `### Handlers\n\n`;
      output += `| Method | Path | File |\n`;
      output += `|--------|------|------|\n`;
      data.routes.handlers.slice(0, 5).forEach((handler: (typeof data.routes.handlers)[0]) => {
        output += `| ${handler.method} | \`${handler.path}\` | ${handler.file} |\n`;
      });
      output += '\n';
    }
  }

  // Duplicate Endpoints
  if (data.dataFlow.duplicateEndpoints && data.dataFlow.duplicateEndpoints.length > 0) {
    output += `## 🔄 Duplicate API Calls\n\n`;
    data.dataFlow.duplicateEndpoints
      .slice(0, 5)
      .forEach((dup: (typeof data.dataFlow.duplicateEndpoints)[0]) => {
        output += `- **${dup.method} ${dup.path}** (${dup.count} calls in ${dup.files.length} files)\n`;
        output += `  - Suggestion: ${dup.suggestion}\n`;
      });
    if (data.dataFlow.duplicateEndpoints.length > 5) {
      output += `- ... and ${data.dataFlow.duplicateEndpoints.length - 5} more duplicate patterns\n`;
    }
    output += '\n';
  }

  // Issues
  const issues = [
    ...data.env.clientLeaks.map(
      (l: { key: string; file: string; line: number }) =>
        `🚨 **ENV-${l.key}** leak in ${l.file}:${l.line}`
    ),
    ...data.env.leaks.map(
      (l: { category: string; symbol: string; file: string; line: number; why: string }) =>
        `🚨 **${l.category}** ${l.symbol} in ${l.file}:${l.line} - ${l.why}`
    ),
    ...data.performance.heavyClientImports.map(
      (h: { file: string }) => `⚡ **PERF** heavy import in ${h.file}`
    ),
    ...data.accessibility.map(
      (a: { rule: string; issue?: string; file: string; line: number; fixHint?: string }) =>
        `♿ **${a.rule}** ${a.issue || 'Accessibility issue'} in ${a.file}:${a.line}${a.fixHint ? ` - *Fix: ${a.fixHint}*` : ''}`
    ),
  ];

  if (issues.length > 0) {
    output += `## ⚠️ Issues\n\n`;
    issues.slice(0, 15).forEach(issue => {
      output += `- ${issue}\n`;
    });
    if (issues.length > 15) output += `- ... and ${issues.length - 15} more issues\n`;
    output += '\n';
  }

  return output;
}
