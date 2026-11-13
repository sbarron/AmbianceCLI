import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildImportGraph } from './indexers';
import type { FileInfo } from '../../core/compactor/fileDiscovery';

jest.mock('../../utils/logger', () => ({ logger: { warn() {}, info() {}, debug() {} } }));

describe('project-relative import graph', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambiance-import-graph-'));
  });
  afterEach(() => {
    if (
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith('ambiance-import-graph-')
    )
      throw new Error('Unexpected fixture path');
    fs.rmSync(root, { recursive: true, force: true });
  });
  function file(relPath: string, content = '', language = 'typescript'): FileInfo {
    const absolute = path.join(root, relPath.replace(/\\/g, '/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
    return { absPath: absolute, relPath, language } as FileInfo;
  }

  it('resolves files and directory indexes in the target project when cwd is elsewhere', async () => {
    const files = [
      file(
        'src/main.ts',
        "import { a } from './helper';\nimport { b } from './folder';\nimport { c } from '../config.json';"
      ),
      file('src/helper.ts'),
      file('src/folder/index.ts'),
      file('config.json', '{}', 'json'),
    ];
    const graph = await buildImportGraph(files);
    expect(graph.get('src/main.ts')).toEqual([
      'src/helper.ts',
      'src/folder/index.ts',
      'config.json',
    ]);
    for (const edge of graph.get('src/main.ts')!)
      expect(fs.existsSync(path.join(root, edge))).toBe(true);
  });

  it('supports emitted JavaScript specifiers while preferring an actual exact file', async () => {
    const files = [
      file(
        'src/main.ts',
        "import { a } from './typed.js';\nimport { b } from './actual.js';\nimport { c } from './modern.mjs';"
      ),
      file('src/typed.ts'),
      file('src/actual.js', '', 'javascript'),
      file('src/actual.ts'),
      file('src/modern.mts'),
    ];
    expect((await buildImportGraph(files)).get('src/main.ts')).toEqual([
      'src/typed.ts',
      'src/actual.js',
      'src/modern.mts',
    ]);
  });

  it('uses platform casing while returning the discovered file spelling', async () => {
    const files = [file('src/main.ts', "import { a } from './HELPER';"), file('src/helper.ts')];
    expect((await buildImportGraph(files)).get('src/main.ts')).toEqual(
      process.platform === 'win32' ? ['src/helper.ts'] : []
    );
  });

  it('normalizes Windows keys, deduplicates edges and omits missing, external and out-of-project targets', async () => {
    const files = [
      file(
        'src\\main.ts',
        "import { a } from './helper';\nimport { b } from './helper.ts';\nimport { c } from './missing';\nimport { d } from '../../outside';\nimport { e } from 'external';\nimport { f } from './main';"
      ),
      file('src\\helper.ts'),
    ];
    const graph = await buildImportGraph(files);
    expect([...graph.keys()]).toEqual(['src/main.ts', 'src/helper.ts']);
    expect(graph.get('src/main.ts')).toEqual(['src/helper.ts']);
  });
});
