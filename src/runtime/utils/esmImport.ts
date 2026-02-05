export function importEsm<TModule = unknown>(specifier: string): Promise<TModule> {
  // Jest executes modules inside a VM context where Function-constructed dynamic imports can fail.
  // When running tests, prefer require() so moduleNameMapper/__mocks__ can intercept.
  if (process.env.JEST_WORKER_ID) {
    return Promise.resolve(require(specifier) as TModule);
  }

  // In CommonJS output, TypeScript may downlevel `import()` to `require()`.
  // Using Function forces Node's native dynamic import, which works for ESM-only deps.
  const importer = new Function('s', 'return import(s)') as (s: string) => Promise<TModule>;
  return importer(specifier);
}
