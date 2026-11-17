const { checkReleaseTag } = require('../scripts/check-release-tag.cjs');

describe('release publication tags', () => {
  test('prereleases require an explicit non-latest tag', () => {
    expect(() => checkReleaseTag('0.7.0-rc.1')).toThrow(/prerelease/);
    expect(() => checkReleaseTag('0.7.0-rc.1', 'latest')).toThrow(/prerelease/);
    expect(() => checkReleaseTag('0.7.0-rc.1', 'rc')).not.toThrow();
    expect(() => checkReleaseTag('0.7.0-rc.1', 'beta')).not.toThrow();
    expect(() => checkReleaseTag('0.7.0', 'latest')).not.toThrow();
  });
});
