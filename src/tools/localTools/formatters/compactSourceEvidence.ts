/** Remove repeated original lines after packing, without admitting more source. */
export function compactSourceEvidence(text: string): string {
  const seen = new Map<string, Map<number, string>>();
  const conflicts = new Map<string, Set<number>>();
  const rows = text.split('\n'), output: string[] = [];
  for (let at = 0; at < rows.length;) {
    const heading = /^### (.+) \((.+):(\d+)-(\d+)\)$/.exec(rows[at]);
    if (!heading) { output.push(rows[at++]); continue; }
    const [, symbol, file, first, last] = heading;
    const opening = /^(`{3,})([^\n]*)$/.exec(rows[at + 2] || '');
    const start = Number(first), end = Number(last), closing = at + 3 + end - start + 1;
    // Use the source range to find the closing fence. Code may itself contain
    // markdown examples; never interpret a nested source heading as a section.
    if (start < 1 || end < start || rows[at + 1] !== '' || !opening || rows[closing] !== opening[1]) return text;
    const [, fence, language] = opening;
    const lines = rows.slice(at + 3, closing);
    const note = (rows[closing + 1] || '').startsWith('Excerpt; read') ? rows[closing + 1] : undefined;
    const next = closing + 1 + (note ? 1 : 0);
    const original = rows.slice(at, next).join('\n');
    at = next;
    const previous = seen.get(file) || new Map<number, string>();
    const disputed = conflicts.get(file) || new Set<number>();
    const runs: { start: number; lines: string[] }[] = [];
    let current: { start: number; lines: string[] } | undefined;
    lines.forEach((line, i) => {
      const n = start + i;
      if (previous.has(n) && previous.get(n) !== line) disputed.add(n);
      if (!disputed.has(n) && previous.get(n) === line) { current = undefined; return; }
      if (!current) { current = { start: n, lines: [] }; runs.push(current); }
      current.lines.push(line);
    });
    lines.forEach((line, i) => { if (!disputed.has(start + i)) previous.set(start + i, line); });
    seen.set(file, previous);conflicts.set(file, disputed);
    if (!runs.length) continue;
    if (runs.length === 1 && runs[0].lines.length === lines.length) { output.push(original); continue; }
    const label = note || `Excerpt; read ${file}:${start}-${end} for the full source range.`;
    const replacement = runs.map(run => `### ${symbol} (${file}:${run.start}-${run.start + run.lines.length - 1})\n\n${fence}${language}\n${run.lines.join('\n')}\n${fence}\n${label}`).join('\n\n');
    // Fragment headings must not make an otherwise small block larger.
    output.push(replacement.length < original.length ? replacement : original);
  }
  return output.join('\n');
}
