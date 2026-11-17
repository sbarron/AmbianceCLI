const { version } = require('../package.json');

function checkReleaseTag(packageVersion, tag = 'latest') {
  if (/^\d+\.\d+\.\d+-/.test(packageVersion) && tag === 'latest') {
    throw new Error(
      `Version ${packageVersion} is a prerelease. Publish with --tag rc, beta, or alpha; latest requires a stable version.`
    );
  }
}

module.exports = { checkReleaseTag };

if (require.main === module) {
  try {
    checkReleaseTag(version, process.env.npm_config_tag || 'latest');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
