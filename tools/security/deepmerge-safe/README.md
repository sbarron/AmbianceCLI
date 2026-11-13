# Development-only deepmerge security patch

This package replaces Jest's transitive `deepmerge` dependency through the root npm override. It is not a runtime dependency of the Ambiance CLI, and it is private: it must not be published separately.

The implementation and declarations are from deepmerge 4.3.1, with its original MIT license retained. Upstream has no published fix for [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).

The only implementation changes replace three assignments to a new merge result with `Object.defineProperty` calls that create writable, enumerable, configurable own data properties. An enumerable `__proto__` key can therefore no longer invoke the inherited prototype setter in either the target-copy or source-merge path. Array merging, custom merge callbacks, symbols, cloning and the exported API remain unchanged.

`tests/dependency-security.test.js` exercises the reported null-prototype, placeholder and own-key attacks, nested target copying, normal merge options and the actual override loaded by Jest. Remove this compatibility package when Jest adopts an upstream fix, retaining the security regression tests.

Upstream: https://github.com/TehShrike/deepmerge/tree/v4.3.1
