// Mock implementation of globby for Jest tests
const globby = jest.fn().mockImplementation(async (patterns, options) => {
  // For testing, return some mock files that match the patterns
  const mockFiles = [
    'src/index.ts',
    'src/utils.ts',
    'src/processor.ts',
    'src/complex.ts',
    'src/index.js',
    'src/utils.js',
    'duplicate1.ts',
    'duplicate2.ts',
    'internal.ts',
    'exported.ts',
    'package.json'
  ];
  
  // Return empty array for non-existent paths to trigger error handling
  if (options && options.cwd && (
    options.cwd.includes('/non/existent/path') || 
    options.cwd.includes('\\non\\existent\\path') ||
    options.cwd.includes('definitely\\non\\existent\\path')
  )) {
    return [];
  }
  
  // Filter based on patterns if provided
  if (patterns && patterns.length > 0) {
    const filteredFiles = mockFiles.filter(file => {
      return patterns.some(pattern => {
        if (typeof pattern === 'string') {
          // Handle glob patterns like **/*.{ts,tsx,js,jsx}
          if (pattern.includes('**/*.{')) {
            const extensions = pattern.match(/\{([^}]+)\}/)?.[1]?.split(',') || [];
            const ext = file.split('.').pop();
            return extensions.some(e => e.trim() === ext);
          }
          return file.includes(pattern.replace('**', ''));
        }
        return true;
      });
    });
    
    // Apply ignore patterns if provided
    if (options && options.ignore) {
      return filteredFiles.filter(file => {
        return !options.ignore.some(ignorePattern => {
          if (ignorePattern.includes('**/*.test.*')) {
            return file.includes('.test.');
          }
          if (ignorePattern.includes('**/*.spec.*')) {
            return file.includes('.spec.');
          }
          if (ignorePattern.includes('node_modules/**')) {
            return file.includes('node_modules');
          }
          return false;
        });
      });
    }
    
    // Handle absolute option
    if (options && options.absolute) {
      const cwd = options.cwd || process.cwd();
      return filteredFiles.map(file => `${cwd}/${file}`);
    }
    
    return filteredFiles;
  }
  
  // Handle absolute option for default case
  if (options && options.absolute) {
    const cwd = options.cwd || process.cwd();
    return mockFiles.map(file => `${cwd}/${file}`);
  }
  
  return mockFiles;
});

module.exports = {
  globby
};
