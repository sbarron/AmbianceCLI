/** Agent-directed source exploration. No provider, embedding, or model calls. */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomUUID } from 'crypto';
import { parseExpression } from '@babel/parser';
import { FileDiscovery } from '../../core/compactor/fileDiscovery';
import { ASTParser, ParsedFile } from '../../core/compactor/astParser';

type Action = 'search' | 'discover' | 'read' | 'follow' | 'status';
type Relation = 'dependencies' | 'references' | 'routes';
interface Target {
  id: string;
  file: string;
  symbol: string;
  start: number;
  end: number;
  hash: string;
  reason: { kind: string; line?: number; from?: string; detail?: string };
}
interface State {
  version: 1;
  project: string;
  targets: Record<string, Target>;
  returned: Record<string, string>;
}
export interface ExploreRequest {
  projectPath: string;
  action?: Action;
  sessionId?: string;
  query?: string;
  queries?: string[];
  mode?: 'lexical' | 'hybrid';
  ref?: string;
  selections?: ExploreSelection[];
  scope?: string;
  filePath?: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  targetIds?: string[];
  relation?: Relation;
  maxTargets?: number;
  maxTokens?: number;
  /** Transport adapter allowance for JSON plus its JSON-string representation. */
  maxEncodedChars?: number;
}
export interface ExploreSelection {
  ref?: string;
  targetIds?: string[];
  filePath?: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const makeRef = (session: string, target: string) =>
  'e1.' + Buffer.from(`${session}:${target}`).toString('base64url');
function parseRef(ref: string): { sessionId: string; targetId: string } {
  if (typeof ref !== 'string' || ref.length > 160 || !/^e1\.[A-Za-z0-9_-]+$/.test(ref))
    throw Error('Invalid exploration reference');
  const decoded = Buffer.from(ref.slice(3), 'base64url').toString('utf8');
  const match = decoded.match(/^([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}):(t_[a-f\d]{20})$/i);
  if (!match || makeRef(match[1], match[2]) !== ref) throw Error('Invalid exploration reference');
  return { sessionId: match[1], targetId: match[2] };
}
const posix = (s: string) => s.replace(/\\/g, '/');
const within = (root: string, file: string) => {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const sensitive = (s: string) =>
  /(?:^|\/)(?:\.env(?:\..*)?|auth\.json|\.git)(?:\/|$)|\.(?:pem|key|pfx|p12)$/i.test(s);
const isCode = (s: string) => /\.(?:[cm]?[jt]sx?|py|go|rs|java|cpp|c|h)$/i.test(s);

/** Parse JSONC without evaluating configuration code. */
function configValue(node: any): any {
  if (node.type === 'ObjectExpression')
    return Object.fromEntries(
      node.properties.map((p: any) => {
        if (p.type !== 'ObjectProperty' || p.computed) throw Error('Unsupported config property');
        return [p.key.name ?? p.key.value, configValue(p.value)];
      })
    );
  if (node.type === 'ArrayExpression') return node.elements.map(configValue);
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return node.value;
  if (node.type === 'NullLiteral') return null;
  throw Error('Unsupported config value');
}

export async function handleExplore(args: ExploreRequest): Promise<any> {
  const action = args.action || 'search';
  if (!['search', 'discover', 'read', 'follow', 'status'].includes(action))
    throw Error('Unknown exploration action');
  const root = await fs.realpath(path.resolve(args.projectPath || process.cwd()));
  const limit = args.maxTargets ?? 12,
    budget = args.maxTokens ?? 6000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw Error('maxTargets must be 1–50');
  if (!Number.isInteger(budget) || budget < 256 || budget > 16000)
    throw Error('maxTokens must be 256–16000');
  if (
    args.maxEncodedChars !== undefined &&
    (!Number.isFinite(args.maxEncodedChars) || args.maxEncodedChars < 1024)
  )
    throw Error('Invalid encoded response allowance');
  if (
    (action === 'search' || action === 'follow') &&
    args.query !== undefined &&
    (!args.query.trim() || args.query.length > 300)
  )
    throw Error('query must be 1–300 characters');
  if (action === 'search' && !args.query?.trim())
    throw Error('Search requires a literal identifier, path, or text fragment');
  if (args.mode && !['lexical', 'hybrid'].includes(args.mode))
    throw Error('Unknown discovery mode');
  if (action === 'discover') {
    if (!!args.query === !!args.queries) throw Error('Provide query or queries for discovery');
    const queries = args.queries || [args.query!];
    if (
      !Array.isArray(queries) ||
      !queries.length ||
      queries.length > 10 ||
      queries.some(q => typeof q !== 'string' || !q.trim() || q.length > 300)
    )
      throw Error('queries must contain 1-10 nonempty strings of at most 300 characters');
  }
  if (
    args.selections &&
    (action !== 'read' ||
      !Array.isArray(args.selections) ||
      !args.selections.length ||
      args.selections.length > 10 ||
      args.ref ||
      args.filePath ||
      args.targetIds)
  )
    throw Error('selections must contain 1-10 items and cannot be combined with other locators');
  if (args.ref && (args.filePath || args.targetIds || !['read', 'follow'].includes(action)))
    throw Error('ref cannot be combined with another locator');
  // A batch can contain malformed items; report those independently below.
  const refs = [args.ref, ...(args.selections || []).map(s => s?.ref)].filter(Boolean) as string[];
  const parsedRefs = refs.flatMap(ref => {
    try {
      return [parseRef(ref)];
    } catch (error) {
      if (!args.selections) throw error;
      return [];
    }
  });
  const inferredSession = parsedRefs[0]?.sessionId;
  if (
    parsedRefs.some(r => r.sessionId !== inferredSession) ||
    (args.sessionId && inferredSession && args.sessionId !== inferredSession)
  )
    throw Error('References and sessionId must identify the same session');
  if (args.sessionId && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(args.sessionId))
    throw Error('Invalid sessionId');
  if (!args.sessionId && !inferredSession && ['follow', 'status'].includes(action))
    throw Error('sessionId is required');
  if (
    args.targetIds &&
    (!Array.isArray(args.targetIds) ||
      args.targetIds.length > 10 ||
      args.targetIds.some(id => typeof id !== 'string'))
  )
    throw Error('targetIds must contain at most ten IDs');
  const id = args.sessionId || inferredSession || randomUUID();
  const dir = path.join(
    process.env.AMBIANCE_HOME || path.join(os.homedir(), '.ambiance'),
    'exploration'
  );
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, id + '.json'),
    lock = file + '.lock';
  let handle;
  try {
    handle = await fs.open(lock, 'wx', 0o600);
  } catch (error: any) {
    if (error.code === 'EEXIST')
      throw Error('Exploration session is busy; retry after the pending call finishes');
    throw error;
  }
  const parser = new ASTParser();
  try {
    const state: State =
      args.sessionId || inferredSession
        ? JSON.parse(await fs.readFile(file, 'utf8'))
        : { version: 1, project: root, targets: {}, returned: {} };
    if (state.version !== 1 || state.project !== root)
      throw Error('Session belongs to another project');
    const originalTargetIds = new Set(Object.keys(state.targets));
    const originalReturnedIds = new Set(Object.keys(state.returned));
    const discovered = await new FileDiscovery(root, { maxFileSize: 200000 }).discoverFiles();
    const files = discovered
      .filter(f => !sensitive(posix(f.relPath)))
      .sort(
        (a, b) =>
          Number(isCode(b.relPath)) - Number(isCode(a.relPath)) ||
          posix(a.relPath).localeCompare(posix(b.relPath))
      );
    const index = new Map(files.map(f => [posix(f.relPath), f]));
    let searchFiles = files;
    if (args.scope) {
      const scoped = await fs.realpath(path.resolve(root, args.scope));
      if (!within(root, scoped)) throw Error('Search scope leaves project');
      const relative = posix(path.relative(root, scoped));
      searchFiles = files.filter(
        f =>
          !relative || posix(f.relPath) === relative || posix(f.relPath).startsWith(relative + '/')
      );
    }
    const loaded = new Map<
      string,
      { text: string; lines: string[]; hash: string; parsed?: ParsedFile }
    >();
    const warnings: string[] = [],
      unresolved: any[] = [];
    async function load(relative: string, parse = false) {
      if (!index.has(relative))
        throw Error('File is outside the discovered, non-ignored source set: ' + relative);
      let value = loaded.get(relative);
      if (!value) {
        const absolute = await fs.realpath(path.resolve(root, relative));
        if (!within(root, absolute)) throw Error('Source symlink leaves the project');
        const text = await fs.readFile(absolute, 'utf8');
        value = { text, lines: text.split(/\r?\n/), hash: hash(text) };
        loaded.set(relative, value);
      }
      const info = index.get(relative)!;
      if (
        parse &&
        !value.parsed &&
        ['typescript', 'javascript', 'python'].includes(info.language)
      ) {
        value.parsed = await parser.parseFile(info.absPath, info.language as any);
        if (hash(await fs.readFile(info.absPath, 'utf8')) !== value.hash)
          throw Error('Source changed during parsing; retry selection');
        if (value.parsed.errors.length) warnings.push('Parser degraded for ' + relative);
      }
      return value;
    }
    async function target(
      relative: string,
      line: number,
      reason: Target['reason'],
      symbol?: string
    ): Promise<Target> {
      const source = await load(relative, true);
      const candidates = (source.parsed?.symbols || []).filter(
        s =>
          !['import', 'export'].includes(s.type) &&
          (symbol || s.type !== 'variable') &&
          (symbol
            ? s.name === symbol || `${s.className}.${s.name}` === symbol
            : s.startLine <= line && line <= s.endLine)
      );
      candidates.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine));
      if (symbol && candidates.length !== 1)
        throw Error(
          `Symbol ${symbol} is missing or ambiguous in ${relative}; use a source line instead`
        );
      const selected = candidates[0];
      const start = selected?.startLine ?? Math.max(1, line - 3),
        end = selected?.endLine ?? Math.min(source.lines.length, line + 3);
      const name = selected
        ? selected.className
          ? `${selected.className}.${selected.name}`
          : selected.name
        : '(source range)';
      return {
        id: 't_' + hash(`${relative}\0${source.hash}\0${start}\0${end}`).slice(0, 20),
        file: relative,
        symbol: name,
        start,
        end,
        hash: source.hash,
        reason,
      };
    }
    const output: any = {
      success: true,
      kind: 'exploration',
      sessionId: id,
      action,
      targets: [],
      known: [],
      evidence: [],
      deferred: [],
      unresolved,
      warnings,
      metadata: {
        filesAvailable: files.length,
        sourceFilesRead: 0,
        scannedFiles: 0,
        truncated: false,
        retrieval: 'deterministic-agent-directed',
        scope: args.scope || '.',
      },
    };
    const fits = () => {
      const json = JSON.stringify(output);
      return (
        json.length <= budget * 4 &&
        (args.maxEncodedChars === undefined ||
          json.length + JSON.stringify(json).length <= args.maxEncodedChars)
      );
    };
    const emitted = new Set<string>();
    function offer(t: Target) {
      if (emitted.has(t.id)) return;
      emitted.add(t.id);
      const known = state.targets[t.id];
      const bucket = known ? output.known : output.targets;
      if (bucket.length >= limit) {
        output.metadata.truncated = true;
        return;
      }
      bucket.push(
        known
          ? {
              id: t.id,
              ref: makeRef(id, t.id),
              file: t.file,
              symbol: t.symbol,
              start: t.start,
              end: t.end,
            }
          : { ...t, ref: makeRef(id, t.id) }
      );
      if (!fits()) {
        bucket.pop();
        output.metadata.truncated = true;
        return;
      }
      if (!known) state.targets[t.id] = t;
    }
    async function getTargets(selection: ExploreSelection = args): Promise<Target[]> {
      if (
        selection.ref &&
        (selection.targetIds ||
          selection.filePath ||
          selection.symbol ||
          selection.startLine !== undefined ||
          selection.endLine !== undefined)
      )
        throw Error('ref cannot be combined with other locator fields');
      if (
        selection.targetIds &&
        (!Array.isArray(selection.targetIds) ||
          selection.targetIds.length > 10 ||
          selection.targetIds.some(key => typeof key !== 'string'))
      )
        throw Error('targetIds must contain at most ten IDs');
      const selected = (
        selection.ref ? [parseRef(selection.ref).targetId] : selection.targetIds || []
      ).map(key => {
        if (!state.targets[key]) throw Error('Unknown target ID: ' + key);
        return state.targets[key];
      });
      if (selection.filePath) {
        const absolute = path.resolve(root, selection.filePath);
        if (!within(root, absolute)) throw Error('File leaves project');
        const relative = posix(path.relative(root, absolute));
        const source = await load(relative);
        if (
          selection.startLine !== undefined &&
          (!Number.isInteger(selection.startLine) ||
            selection.startLine < 1 ||
            selection.startLine > source.lines.length)
        )
          throw Error('startLine is outside the source file');
        const chosen = await target(
          relative,
          selection.startLine || 1,
          { kind: 'agent_selection' },
          selection.symbol
        );
        if (!selection.symbol && selection.startLine === undefined) {
          chosen.start = 1;
          chosen.end = source.lines.length;
          chosen.symbol = '(file)';
          chosen.id =
            't_' + hash(`${relative}\0${source.hash}\0${chosen.start}\0${chosen.end}`).slice(0, 20);
        }
        selected.push(chosen);
      }
      if (!selected.length) throw Error('Select targetIds or filePath with symbol/startLine');
      for (const t of selected) {
        if ((await load(t.file)).hash !== t.hash)
          throw Error(`Stale target ${t.id}: source changed; search/select it again`);
        state.targets[t.id] = t;
      }
      return selected;
    }
    async function search(query: string, kind: string, from?: string) {
      for (const info of searchFiles) {
        const relative = posix(info.relPath),
          source = await load(relative);
        output.metadata.scannedFiles++;
        if (query.includes('/') && relative.includes(query.replace(/^\//, ''))) {
          const parsed = await load(relative, true);
          const symbols = (parsed.parsed?.symbols || []).filter(
            s => s.isExported && !['import', 'export'].includes(s.type)
          );
          for (const symbol of symbols)
            offer(
              await target(
                relative,
                symbol.startLine,
                { kind: 'file_path_match', from, detail: query },
                symbol.className ? `${symbol.className}.${symbol.name}` : symbol.name
              )
            );
          if (!symbols.length) {
            const whole = await target(relative, 1, {
              kind: 'file_path_match',
              from,
              detail: query,
            });
            whole.start = 1;
            whole.end = source.lines.length;
            whole.symbol = '(file)';
            whole.id = 't_' + hash(`${relative}\0${source.hash}\0${1}\0${whole.end}`).slice(0, 20);
            offer(whole);
          }
          if (output.targets.length >= limit) {
            output.metadata.truncated = true;
            break;
          }
          continue;
        }
        const offset = source.text.indexOf(query);
        if (offset < 0 && !relative.includes(query)) continue;
        const line = offset < 0 ? 1 : source.text.slice(0, offset).split('\n').length;
        // A file may contain several occurrences in distinct functions.
        const lines = source.lines.map((s, i) => (s.includes(query) ? i + 1 : 0)).filter(Boolean);
        for (const at of lines.length ? lines : [line])
          offer(await target(relative, at, { kind, line: at, from, detail: query }));
        if (output.targets.length >= limit) {
          output.metadata.truncated = true;
          break;
        }
      }
    }
    async function discover(queries: string[]) {
      const stop = new Set([
        'the',
        'and',
        'for',
        'with',
        'after',
        'before',
        'from',
        'that',
        'this',
        'does',
        'where',
        'when',
        'how',
        'what',
        'which',
        'into',
        'use',
        'using',
        'are',
        'can',
        'a',
        'an',
        'to',
        'of',
        'in',
      ]);
      const terms = queries.map(query => [
        ...new Set(
          query
            .replace(/([a-z\d])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .split(/[^\p{L}\p{N}_$]+/u)
            .flatMap(w => w.split(/[_$]+/))
            .filter(w => w.length > 0 && (!stop.has(w) || query.trim().toLowerCase() === w))
        ),
      ]);
      const candidates: Array<Map<string, { target: Target; score: number; exact: boolean }>> =
        queries.map(() => new Map());
      for (const info of searchFiles) {
        const relative = posix(info.relPath);
        const source = await load(relative);
        output.metadata.scannedFiles++;
        const text = source.text.toLowerCase(),
          pathText = relative.toLowerCase();
        const active = terms.map(
          (ts, i) =>
            ts.some(t => text.includes(t) || pathText.includes(t)) ||
            text.includes(queries[i].toLowerCase()) ||
            pathText.includes(queries[i].toLowerCase())
        );
        if (!active.some(Boolean)) continue;
        const parsed = await load(relative, true);
        const symbols = (parsed.parsed?.symbols || []).filter(
          s => !['import', 'export'].includes(s.type)
        );
        for (let qi = 0; qi < queries.length; qi++) {
          if (!active[qi]) continue;
          const query = queries[qi].toLowerCase(),
            words = terms[qi];
          const pathExact =
            pathText.includes(query) && (query.includes('/') || query.includes('.'));
          const matches = symbols
            .map(s => {
              const name = (s.className ? `${s.className}.${s.name}` : s.name).toLowerCase();
              const body = source.lines
                .slice(s.startLine - 1, s.endLine)
                .join('\n')
                .toLowerCase();
              const matched = words.filter(
                w => name.includes(w) || pathText.includes(w) || body.includes(w)
              );
              const exact = name === query || s.name.toLowerCase() === query || pathExact;
              const score =
                (exact ? 1000 : 0) +
                matched.length * 12 +
                (words.length ? (matched.length / words.length) * 20 : 0) +
                words.filter(w => name.includes(w)).length * 12 +
                words.filter(w => pathText.includes(w)).length * 5 +
                (body.includes(query) ? 8 : 0);
              return { s, matched, exact, score };
            })
            .filter(m => m.exact || m.matched.length > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 30);
          for (const match of matches) {
            const reason = {
              kind: match.exact ? 'exact_identifier_or_path' : 'lexical_terms',
              detail: match.matched.join(', ') || queries[qi],
            };
            let t: Target;
            try {
              t = await target(
                relative,
                match.s.startLine,
                reason,
                match.s.className ? `${match.s.className}.${match.s.name}` : match.s.name
              );
            } catch {
              t = await target(relative, match.s.startLine, reason);
            }
            const old = candidates[qi].get(t.id);
            if (!old || old.score < match.score)
              candidates[qi].set(t.id, { target: t, score: match.score, exact: match.exact });
          }
          // Unsupported languages and files with no parsed symbol still supply a useful source range.
          if (!matches.length) {
            const line = source.lines.findIndex(
              s => s.toLowerCase().includes(query) || words.some(w => s.toLowerCase().includes(w))
            );
            if (line >= 0 || pathExact) {
              const t = await target(relative, Math.max(0, line) + 1, {
                kind: pathExact ? 'exact_identifier_or_path' : 'lexical_terms',
                detail: words.join(', '),
              });
              candidates[qi].set(t.id, {
                target: t,
                score: pathExact ? 1000 : 1,
                exact: pathExact,
              });
            }
          }
        }
      }
      const groups = queries.map((query, i) => ({
        index: i,
        query,
        effectiveMode: 'lexical',
        targets: [] as any[],
        known: [] as any[],
        outcome: candidates[i].size ? 'candidates' : 'no_matches',
        indexStatus: undefined as string | undefined,
        indexReason: undefined as string | undefined,
      }));
      const sorted = candidates.map(map =>
        [...map.values()].sort(
          (a, b) =>
            b.score - a.score ||
            a.target.file.localeCompare(b.target.file) ||
            a.target.start - b.target.start
        )
      );
      if (args.mode === 'hybrid') {
        const { queryReadyIndexBatch } = await import('./readyIndexDiscovery');
        const indexResults = await queryReadyIndexBatch({
          projectPath: root,
          queries,
          scopeFiles: searchFiles.map(f => posix(f.relPath)),
          scope: args.scope,
          maxResults: limit * 3,
        });
        for (let i = 0; i < queries.length; i++) {
          const result = indexResults[i];
          groups[i].indexStatus = result.status;
          groups[i].indexReason = result.reason;
          if (result.status !== 'ready') continue;
          const semantic: (typeof sorted)[number] = [];
          for (const match of result.matches) {
            try {
              const absolute = await fs.realpath(path.resolve(root, match.file));
              if (
                !within(root, absolute) ||
                (await load(match.file)).hash !== match.sourceHash ||
                hash(await fs.readFile(absolute, 'utf8')) !== match.sourceHash
              )
                throw Error('Indexed source changed');
              const t = await target(match.file, match.startLine, {
                kind: 'semantic_index',
                detail: `similarity ${match.similarity.toFixed(3)}`,
              });
              semantic.push({ target: t, score: match.similarity, exact: false });
            } catch {
              groups[i].indexStatus = 'stale';
              groups[i].indexReason = 'Source changed while querying the index';
              semantic.length = 0;
              break;
            }
          }
          if (groups[i].indexStatus !== 'ready') continue;
          groups[i].effectiveMode = 'hybrid';
          const exact = sorted[i].filter(c => c.exact),
            lexical = sorted[i].filter(c => !c.exact);
          const merged: (typeof sorted)[number] = [],
            seen = new Set<string>();
          const add = (c: (typeof sorted)[number][number] | undefined) => {
            if (c && !seen.has(c.target.id)) {
              seen.add(c.target.id);
              merged.push(c);
            }
          };
          exact.forEach(add);
          for (let j = 0; j < Math.max(lexical.length, semantic.length); j++) {
            add(lexical[j]);
            add(semantic[j]);
          }
          sorted[i] = merged;
          groups[i].outcome = merged.length ? 'candidates' : 'no_matches';
        }
      }
      output.results = groups;
      // Round-robin allocation keeps a broad first query from consuming the response.
      for (let rank = 0; rank < limit; rank++)
        for (let i = 0; i < groups.length; i++) {
          const candidate = sorted[i][rank];
          if (!candidate) continue;
          const t = candidate.target,
            known = !!state.targets[t.id];
          const bucket = known ? groups[i].known : groups[i].targets;
          bucket.push({ ...t, ref: makeRef(id, t.id), rank: rank + 1 });
          if (!fits()) {
            bucket.pop();
            groups[i].outcome = 'budget_deferred';
            output.metadata.truncated = true;
          } else state.targets[t.id] = t;
        }
      for (let i = 0; i < groups.length; i++) {
        if (sorted[i].length > limit) output.metadata.truncated = true;
        if (
          groups[i].outcome === 'candidates' &&
          !groups[i].targets.length &&
          groups[i].known.length
        )
          groups[i].outcome = 'known_targets';
        if (groups[i].outcome === 'budget_deferred')
          (groups[i] as any).nextAction = {
            action: 'discover',
            query: queries[i],
            mode: args.mode || 'lexical',
            scope: args.scope,
            advice: 'Retry this query with a larger maxTokens budget or fewer maxTargets.',
          };
        if (groups[i].outcome === 'no_matches')
          (groups[i] as any).nextAction = {
            action: 'discover',
            query: queries[i],
            scope: args.scope,
            advice: 'Try fewer terms or a broader scope.',
          };
      }
      if (groups.length === 1) {
        output.targets = groups[0].targets;
        output.known = groups[0].known;
        // Do not duplicate candidate lists in the serialized response.
        delete output.results;
        output.outcome = groups[0].outcome;
        output.effectiveMode = groups[0].effectiveMode;
        output.indexStatus = groups[0].indexStatus;
        output.indexReason = groups[0].indexReason;
        if ((groups[0] as any).nextAction) output.nextAction = (groups[0] as any).nextAction;
      }
    }
    async function resolveImport(relative: string, spec: string): Promise<string | undefined> {
      let candidates: string[] = [];
      if (spec.startsWith('.')) candidates = [path.resolve(root, path.dirname(relative), spec)];
      else {
        let folder = path.dirname(path.resolve(root, relative));
        while (within(root, folder)) {
          let config: any;
          for (const name of ['tsconfig.json', 'jsconfig.json']) {
            try {
              const configPath = await fs.realpath(path.join(folder, name));
              if (!within(root, configPath)) continue;
              config = configValue(parseExpression(await fs.readFile(configPath, 'utf8')));
              break;
            } catch {
              /* Absent or unsupported configuration remains unresolved. */
            }
          }
          if (config) {
            const options = config.compilerOptions || {},
              base = path.resolve(folder, options.baseUrl || '.');
            for (const [pattern, values] of Object.entries(options.paths || {})) {
              const [prefix, suffix = ''] = pattern.split('*');
              if (
                !spec.startsWith(prefix) ||
                !spec.endsWith(suffix) ||
                (!pattern.includes('*') && spec !== pattern) ||
                !Array.isArray(values)
              )
                continue;
              const middle = spec.slice(prefix.length, suffix ? -suffix.length : undefined);
              for (const value of values)
                if (typeof value === 'string')
                  candidates.push(path.resolve(base, value.replace('*', middle)));
            }
            break;
          }
          if (folder === root) break;
          folder = path.dirname(folder);
        }
      }
      for (const candidate of candidates) {
        const stems = [candidate, candidate.replace(/\.[cm]?js$/, '')];
        for (const stem of stems)
          for (const suffix of [
            '',
            '.ts',
            '.tsx',
            '.js',
            '.jsx',
            '.mjs',
            '.cjs',
            '.d.ts',
            '/index.ts',
            '/index.tsx',
            '/index.js',
          ]) {
            const relativePath = posix(path.relative(root, stem + suffix));
            if (index.has(relativePath)) return relativePath;
          }
      }
      return undefined;
    }
    if (action === 'search') {
      await search(args.query!.trim(), 'literal_match');
      output.outcome = output.targets.length
        ? 'candidates'
        : output.known.length
          ? 'known_targets'
          : 'no_matches';
      output.interpretation = 'literal substring';
      if (output.outcome === 'no_matches')
        output.nextAction = { action: 'discover', query: args.query!.trim(), scope: args.scope };
    } else if (action === 'discover')
      await discover((args.queries || [args.query!]).map(q => q.trim()));
    else if (action === 'read') {
      const selections = args.selections || [args];
      const batch = !!args.selections;
      if (batch)
        output.results = selections.map((_, index) => ({
          index,
          outcome: 'pending',
          targetIds: [] as string[],
        }));
      const delivered = new Set<string>();
      for (let i = 0; i < selections.length; i++) {
        const selection = selections[i];
        let selected: Target[];
        try {
          if (!selection || typeof selection !== 'object')
            throw Error('Selection must be an object');
          selected = await getTargets(selection);
        } catch (error: any) {
          if (!batch) throw error;
          output.results[i].outcome = 'error';
          output.results[i].error = error.message;
          continue;
        }
        try {
          for (const original of selected) {
            let t = original;
            const source = await load(t.file);
            let start = t.start,
              end = t.end;
            if (selection.endLine !== undefined) {
              if (
                !Number.isInteger(selection.startLine) ||
                !Number.isInteger(selection.endLine) ||
                selection.startLine! < 1 ||
                selection.endLine! < selection.startLine! ||
                selection.endLine! > source.lines.length
              )
                throw Error('Specify a valid startLine/endLine pair');
              start = selection.startLine!;
              end = selection.endLine!;
              if (start !== t.start || end !== t.end) {
                t = {
                  ...t,
                  id: 't_' + hash(`${t.file}\0${source.hash}\0${start}\0${end}`).slice(0, 20),
                  start,
                  end,
                  symbol: '(source range)',
                };
                state.targets[t.id] = t;
              }
            }
            const identity = `${t.id}:${start}:${end}`;
            if (batch) output.results[i].targetIds.push(t.id);
            if (delivered.has(identity)) {
              if (batch && output.results[i].outcome !== 'budget_deferred')
                output.results[i].outcome = 'delivered';
              continue;
            }
            const entry = {
              targetId: t.id,
              ref: makeRef(id, t.id),
              file: t.file,
              symbol: t.symbol,
              start,
              end,
              completeSymbol:
                !original.symbol.startsWith('(') && start <= original.start && end >= original.end,
              hash: source.hash,
              content: source.lines.slice(start - 1, end).join('\n'),
            };
            output.evidence.push(entry);
            if (!fits()) {
              output.evidence.pop();
              output.deferred.push({
                id: t.id,
                ref: makeRef(id, t.id),
                file: t.file,
                start,
                end,
                reason:
                  'Complete requested source exceeds budget; increase maxTokens or explicitly select a smaller line range',
              });
              if (batch) output.results[i].outcome = 'budget_deferred';
            } else {
              delivered.add(identity);
              if (batch && output.results[i].outcome !== 'budget_deferred')
                output.results[i].outcome = 'delivered';
              state.targets[t.id] = t;
              state.returned[t.id] = source.hash;
            }
          }
        } catch (error: any) {
          if (!batch) throw error;
          output.results[i].outcome = 'error';
          output.results[i].error = error.message;
        }
      }
    } else if (action === 'follow') {
      const relation = args.relation || 'dependencies';
      if (!['dependencies', 'references', 'routes'].includes(relation))
        throw Error('Unknown relation');
      for (const t of await getTargets()) {
        const source = await load(t.file, true),
          body = source.lines.slice(t.start - 1, t.end).join('\n');
        if (relation === 'references') {
          await search(t.symbol.split('.').pop()!, 'lexical_reference_candidate', t.id);
          continue;
        }
        if (relation === 'routes') {
          const paths = args.query
            ? [args.query]
            : [...body.matchAll(/["'`]((?:\/[\w.:[\]-]+)+)\/?["'`]/g)].map(m => m[1]);
          if (!paths.length)
            unresolved.push({
              from: t.id,
              reason:
                'No literal endpoint resolved; inspect base URL and dynamic path construction, then supply the verified full path as query.',
            });
          for (const route of new Set(paths)) {
            let found = false;
            for (const info of files) {
              const relative = posix(info.relPath),
                match = relative.match(/(?:^|\/)app\/(.+)\/route\.[jt]sx?$/);
              if (!match) continue;
              const routePath =
                '/' +
                match[1]
                  .split('/')
                  .filter(s => !/^\(.*\)$/.test(s))
                  .join('/');
              if (routePath !== route.replace(/\/$/, '')) continue;
              const parsed = await load(relative, true);
              for (const symbol of parsed.parsed?.symbols || [])
                if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(symbol.name)) {
                  offer(
                    await target(
                      relative,
                      symbol.startLine,
                      { kind: 'route_path_candidate', from: t.id, detail: route },
                      symbol.name
                    )
                  );
                  found = true;
                }
            }
            if (!found)
              unresolved.push({
                from: t.id,
                route,
                reason:
                  'No exact file-derived route match. Resolve base URL/prefix or dynamic routing before choosing a handler.',
              });
          }
          continue;
        }
        // These are static/lexical candidates, never claimed as resolved runtime call edges.
        if (!source.parsed)
          unresolved.push({
            from: t.id,
            reason:
              'Dependency parsing is unavailable for this file; use a targeted literal search or explicit source reads.',
          });
        const names = new Set(
          [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\(/g)].map(m => m[1])
        );
        for (const symbol of source.parsed?.symbols || [])
          if (names.has(symbol.name) && !(symbol.startLine === t.start && symbol.endLine === t.end))
            offer(
              await target(
                t.file,
                symbol.startLine,
                { kind: 'local_call_name_candidate', from: t.id },
                symbol.className ? `${symbol.className}.${symbol.name}` : symbol.name
              )
            );
        for (const imported of source.parsed?.imports || []) {
          const used = imported.specifiers.filter(s =>
            new RegExp(`\\b${(s.alias || s.name).replace(/[$]/g, '\\$&')}\\b`).test(body)
          );
          if (!used.length) continue;
          const resolved = await resolveImport(t.file, imported.source);
          if (!resolved) {
            unresolved.push({
              from: t.id,
              module: imported.source,
              reason:
                'Import unresolved inside the source set; package/alias/re-export/dynamic resolution may need a targeted search',
            });
            continue;
          }
          const destination = await load(resolved, true);
          const matches = (destination.parsed?.symbols || []).filter(
            s => names.has(s.name) || used.some(u => u.name === s.name)
          );
          if (!matches.length)
            offer(
              await target(resolved, 1, {
                kind: 'static_import_file',
                from: t.id,
                detail: imported.source,
              })
            );
          for (const symbol of matches)
            offer(
              await target(
                resolved,
                symbol.startLine,
                { kind: 'imported_name_candidate', from: t.id, detail: imported.source },
                symbol.className ? `${symbol.className}.${symbol.name}` : symbol.name
              )
            );
        }
      }
    } else {
      const stale: string[] = [];
      for (const t of Object.values(state.targets)) {
        try {
          if ((await load(t.file)).hash !== t.hash) stale.push(t.id);
        } catch {
          stale.push(t.id);
        }
      }
      output.state = {
        knownTargets: Object.keys(state.targets).length,
        returnedSourceTargets: Object.keys(state.returned).length,
        staleTargets: stale,
      };
    }
    output.unresolved = unresolved.slice(0, 12);
    output.warnings = [...new Set(warnings)].slice(0, 3);
    if (unresolved.length > 12) output.metadata.truncated = true;
    output.metadata.sourceFilesRead = loaded.size;
    if (Object.keys(state.targets).length > 2000)
      throw Error('Session target limit reached; start a new task session');
    // Drop metadata lists, never slice source bodies or pretend a deferred symbol was read.
    if (action === 'discover') {
      const groups = output.results || [output];
      // Final outcomes and warnings also consume space; discard lowest-ranked
      // pointers rather than exceed the serialized budget.
      while (!fits()) {
        const group = [...groups].reverse().find(g => g.targets.length || g.known.length);
        if (!group) break;
        (group.targets.length ? group.targets : group.known).pop();
        group.outcome = 'budget_deferred';
        output.metadata.truncated = true;
      }
      if (output.results) {
        // At very tight budgets, identify inputs by their stable array index
        // instead of echoing arbitrarily long query strings.
        for (let i = groups.length - 1; i >= 0 && !fits(); i--) {
          groups[i] = { index: i, outcome: 'budget_deferred' };
          output.metadata.truncated = true;
        }
        if (groups.some((g: any) => g.outcome === 'budget_deferred')) {
          output.nextAction =
            'Retry deferred query indexes separately with a larger maxTokens budget.';
          for (let i = groups.length - 1; i >= 0 && !fits(); i--)
            groups[i] = { index: i, outcome: 'budget_deferred' };
        }
      }
      const visible = new Set<string>(
        groups.flatMap((g: any) => [...(g.targets || []), ...(g.known || [])].map((t: any) => t.id))
      );
      for (const key of Object.keys(state.targets))
        if (!originalTargetIds.has(key) && !visible.has(key)) delete state.targets[key];
    }
    if (action === 'read' && args.selections && !fits()) {
      // Preserve a disposition for every input even when detailed errors or
      // source bodies cannot fit in the transport envelope.
      for (const result of output.results) if (!fits()) delete result.error;
      while (!fits() && output.evidence.length) {
        const entry = output.evidence.pop();
        if (!originalReturnedIds.has(entry.targetId)) delete state.returned[entry.targetId];
        for (const result of output.results)
          if (result.targetIds?.includes(entry.targetId)) result.outcome = 'budget_deferred';
        output.metadata.truncated = true;
      }
      while (!fits() && output.deferred.length) output.deferred.pop();
      for (const result of output.results) if (!fits()) delete result.targetIds;
      if (output.results.some((result: any) => result.outcome === 'budget_deferred')) {
        output.nextAction =
          'Retry deferred selection indexes separately with a larger maxTokens budget.';
        for (const result of output.results) if (!fits()) delete result.targetIds;
        if (!fits()) delete output.nextAction;
      }
    }
    while (!fits() && output.known.length) output.known.pop();
    while (!fits() && output.unresolved.length) {
      output.unresolved.pop();
      output.metadata.truncated = true;
    }
    if (!fits()) throw Error('Response metadata exceeds budget; increase maxTokens');
    const temporary = file + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await fs.rename(temporary, file);
    return output;
  } finally {
    parser.dispose();
    await handle.close();
    await fs.unlink(lock);
  }
}
