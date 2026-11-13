import * as path from 'path';
import type { BundleSnippet, JumpTarget, LocalContextResponse } from '../enhancedLocalContext';
import { estimateTokens } from '../../utils/toolHelpers';
import { compactSourceEvidence } from './compactSourceEvidence';

/** Preserve frontier navigation, then pack attributable original source atomically. */
export function formatEnhancedContextOutput(
  result: LocalContextResponse,
  query = '',
  maxTokens = 3000,
  format = 'enhanced',
  projectPath?: string
): string {
  const limit = Math.max(0, Math.floor(maxTokens));
  const sections: string[] = [];
  const canonical = (file: string) =>
    (projectPath && path.isAbsolute(file) ? path.relative(projectPath, file) : file)
      .replace(/\\/g, '/');
  const clip = (value: string, tokens: number) => {
    const chars = Math.max(0, Math.floor(tokens) * 4);
    return value.length <= chars ? value : chars >= 3 ? value.slice(0, chars - 3) + '...' : '';
  };
  const add = (section: string) => {
    if (!section || estimateTokens([...sections, section].join('\n\n')) > limit) return false;
    sections.push(section);
    return true;
  };
  const targetFor = (snippet: BundleSnippet) =>
    result.jumpTargets.find(t => canonical(t.file) === canonical(snippet.file) && t.symbol === snippet.symbol);
  const targets = result.jumpTargets;
  const location = (target: JumpTarget) =>
    `${canonical(target.file)}${target.start ? `:${target.start}${target.end ? `-${target.end}` : ''}` : ''}`;
  add('## Source evidence');
  if (query) add(`Query: ${clip(query, Math.min(128, limit * 0.08))}`);

  // Reserve navigation before source bodies. Otherwise a full source budget
  // can silently erase the only route to a different relevant subsystem.
  const navigationLimit = format === 'index' ? limit : Math.min(limit, Math.max(80, limit * 0.25));
  const navigation: string[] = [];
  for (const target of targets) {
    const row = `- ${target.symbol}: ${location(target)}`;
    const block = ['## Key locations', ...navigation, row].join('\n');
    if (estimateTokens(block) <= navigationLimit &&
        estimateTokens([...sections, block].join('\n\n')) <= limit) navigation.push(row);
  }
  if (navigation.length) add(['## Key locations', ...navigation].join('\n'));

  if (format !== 'index') {
    const rank = (snippet: BundleSnippet) => {
      const index = targets.indexOf(targetFor(snippet)!);
      return index < 0 ? targets.length : index;
    };
    const snippets = [...result.miniBundle].sort((a, b) => rank(a) - rank(b));
    for (const snippet of snippets) {
      const target = targetFor(snippet);
      const file = canonical(snippet.file);
      const language = /\.py$/.test(file) ? 'python' : /\.[cm]?jsx?$/.test(file) ? 'javascript' : 'typescript';
      const sourceLocation = snippet.start ? `${file}:${snippet.start}-${snippet.end ?? snippet.start}` : target ? location(target) : file;
      const heading = `### ${snippet.symbol} (${sourceLocation})`;
      const note = `Excerpt; read ${target ? location(target) : file} for the full implementation.`;
      if (add(`${heading}\n\n\`\`\`${language}\n${snippet.snippet}\n\`\`\`${snippet.truncated ? `\n${note}` : ''}`)) continue;
      // An oversized block retains its exact pointer and a bounded target preview.
      // Never cut a later function's body by truncating the fully rendered envelope.
      const preview = (snippet.start ? snippet.snippet : target?.snippet || snippet.snippet).split('\n');
      let excerpt = '';
      for (const line of preview) {
        const candidate = excerpt ? `${excerpt}\n${line}` : line;
        const previewLocation = snippet.start ? `${file}:${snippet.start}-${snippet.start + candidate.split('\n').length - 1}` : target ? location(target) : file;
        const block = `### ${snippet.symbol} (${previewLocation})\n\n\`\`\`${language}\n${candidate}\n\`\`\`\n${note}`;
        if (estimateTokens([...sections, block].join('\n\n')) > limit) break;
        excerpt = candidate;
      }
      if (excerpt) {
        const previewLocation = snippet.start ? `${file}:${snippet.start}-${snippet.start + excerpt.split('\n').length - 1}` : target ? location(target) : file;
        add(`### ${snippet.symbol} (${previewLocation})\n\n\`\`\`${language}\n${excerpt}\n\`\`\`\n${note}`);
      }
      else add(`- ${snippet.symbol}: ${target ? location(target) : file}`);
    }
  }

  if (result.answerDraft) add(`## Query analysis\n${clip(result.answerDraft, Math.min(180, limit * 0.1))}`);
  if (result.next) {
    add(`## Next actions\nMode: ${result.next.mode}`);
    for (const file of result.next.openFiles) add(`- Read ${canonical(file)}`);
    for (const check of result.next.checks) add(`- Check: \`${check}\``);
  }
  add(`Analysis: ${result.metadata.filesScanned} files; ${result.jumpTargets.length} locations.`);
  return compactSourceEvidence(sections.join('\n\n'));
}
