const { FileDiscovery } = require('../dist/src/core/compactor/fileDiscovery.js');

async function debugFiles() {
  const discovery = new FileDiscovery('C:\\Dev\\Ambiance');
  const files = await discovery.discoverFiles();

  console.log('Total files found:', files.length);

  // Look for files that contain 'web' in their path
  const webFiles = files.filter(f => f.relPath.includes('web'));
  console.log('\nFiles containing "web":', webFiles.length);
  webFiles.slice(0, 10).forEach(f => console.log(`  ${f.relPath} (ext: ${f.ext})`));

  // Look specifically for web/app files
  const webAppFiles = files.filter(f => f.relPath.includes('web/app') || f.relPath.includes('web\\app'));
  console.log('\nFiles containing "web/app" or "web\\\\app":', webAppFiles.length);
  webAppFiles.slice(0, 5).forEach(f => console.log(`  ${f.relPath} (ext: ${f.ext})`));

  // Look for any files that start with web/app
  const webAppStartsWith = files.filter(f => f.relPath.startsWith('web/app') || f.relPath.startsWith('web\\app'));
  console.log('\nFiles starting with "web/app" or "web\\\\app":', webAppStartsWith.length);
  webAppStartsWith.slice(0, 5).forEach(f => console.log(`  ${f.relPath} (ext: ${f.ext})`));

  // Look for React files
  const reactFiles = files.filter(f => ['.tsx', '.jsx', '.ts', '.js'].includes(f.ext));
  console.log('\nReact/TypeScript files:', reactFiles.length);

  // Check if any React files are in web directories
  const reactWebFiles = reactFiles.filter(f => f.relPath.toLowerCase().includes('web'));
  console.log('React files containing "web":', reactWebFiles.length);
  reactWebFiles.slice(0, 5).forEach(f => console.log(`  ${f.relPath}`));

  // Check what the first few React files look like
  console.log('\nFirst 5 React files:');
  reactFiles.slice(0, 5).forEach(f => console.log(`  ${f.relPath}`));

  // Test the frontend insights filtering logic
  const normalizedSubtree = 'web/app';
  console.log(`\nTesting frontend insights filtering for subtree: "${normalizedSubtree}"`);

  const frontendFiles = reactFiles.filter(file => {
    // Must be in the specified subtree (frontend directory)
    const isInSubtree = file.relPath.startsWith(normalizedSubtree + '/') ||
                       file.relPath.startsWith(normalizedSubtree + '\\') ||
                       file.relPath === normalizedSubtree ||
                       (file.relPath.startsWith(normalizedSubtree) && (file.relPath[normalizedSubtree.length] === '/' || file.relPath[normalizedSubtree.length] === '\\'));

    // For broader analysis, also include files that might be in src/ if no specific subtree is found
    const isInSrc = (file.relPath.startsWith('src/') || file.relPath.startsWith('src\\'));

    // Exclude known non-app contexts
    const isExcluded = (
      /[\\/](test|tests|__tests__)[\\/]/.test(file.relPath) ||
      /\.(spec|test)\.(ts|tsx|js|jsx)$/.test(file.relPath) ||
      /[\\/]jest\.setup\./.test(file.relPath) ||
      /[\\/]scripts[\\/]/.test(file.relPath) ||
      /[\\/]tooling[\\/]/.test(file.relPath)
    );

    const shouldInclude = isInSubtree || isInSrc;
    const finalResult = shouldInclude && !isExcluded;

    // Debug ALL files that should be in web/app subtree
    if (file.relPath.startsWith('web\\app') || file.relPath.startsWith('web/app')) {
      console.log(`Web/app file: ${file.relPath}`);
      console.log(`  isInSubtree: ${isInSubtree}, isInSrc: ${isInSrc}, isExcluded: ${isExcluded}, final: ${finalResult}`);
      console.log(`  Path starts check: startsWith('web/app/')=${file.relPath.startsWith('web/app/')}, startsWith('web\\\\app\\\\')=${file.relPath.startsWith('web\\app\\')}`);
    }

    return finalResult;
  });

  console.log(`\nFrontend files after filtering: ${frontendFiles.length}`);
  frontendFiles.slice(0, 5).forEach(f => console.log(`  ${f.relPath}`));
}

debugFiles().catch(console.error);
