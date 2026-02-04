# Contributing to Ambiance MCP Server

We love your input! We want to make contributing to Ambiance MCP Server as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Development Process

We use GitHub to host code, track issues and feature requests, and accept pull requests.

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code follows our style guidelines
6. Issue that pull request!

## Code Quality Standards

### Required Checks

Before submitting a PR, ensure:

```bash
# Build succeeds
npm run build

# All tests pass
npm test
npm run test:coverage

# Performance benchmarks pass
npm run benchmark:current

# No console.log in production code
npm run lint  # (when available)
```

### Coding Standards

- **TypeScript**: Use strict typing throughout
- **Error Handling**: Always include proper error context
- **Logging**: Use the centralized logger, never console.*
- **Security**: Validate all inputs, sanitize file paths
- **Performance**: Consider memory usage and processing time
- **Documentation**: Add JSDoc comments for public APIs

### Example Code Style

```typescript
/**
 * Compacts code context using semantic analysis
 * @param projectPath - Absolute path to project root
 * @param options - Compaction configuration options
 * @returns Promise resolving to compacted context
 * @throws {Error} When project path is invalid or inaccessible
 */
export async function compactContext(
  projectPath: string,
  options: CompactionOptions
): Promise<CompactedProject> {
  // Validate inputs
  if (!path.isAbsolute(projectPath)) {
    throw new Error('Project path must be absolute');
  }

  try {
    // Implementation with proper error handling
    const result = await processProject(projectPath, options);
    
    logger.info('Context compaction completed', {
      projectPath,
      originalSize: result.originalTokens,
      compactedSize: result.compactedTokens,
      compressionRatio: result.compressionRatio
    });
    
    return result;
  } catch (error) {
    logger.error('Context compaction failed', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}
```

## Testing Guidelines

### Test Structure

```typescript
describe('SemanticCompactor', () => {
  beforeEach(() => {
    // Setup test environment
  });

  afterEach(() => {
    // Cleanup resources
  });

  it('should compress TypeScript files with proper context preservation', async () => {
    // Arrange
    const projectPath = '/path/to/test/project';
    const options = { maxTokens: 4000 };

    // Act
    const result = await compactor.compact(projectPath, options);

    // Assert
    expect(result.compressionRatio).toBeGreaterThan(0.6);
    expect(result.compactedTokens).toBeLessThan(options.maxTokens);
    expect(result.compactedContent).toContain('function');
  });

  it('should handle errors gracefully for invalid paths', async () => {
    // Arrange
    const invalidPath = '/nonexistent/path';

    // Act & Assert
    await expect(compactor.compact(invalidPath)).rejects.toThrow('Project path');
  });
});
```

### Coverage Requirements

- Minimum 85% line coverage
- Test error handling paths
- Include integration tests for tool combinations
- Performance regression tests for large codebases

## Architecture Guidelines

### File Organization

```
src/
├── compactor/          # Semantic analysis and compression
├── tools/             # MCP tool definitions and handlers  
├── local/             # Local project detection and indexing
├── client/            # Cloud service integration
├── core/              # Shared utilities and validation
├── utils/             # Logging and helper functions
└── lightweightServer.ts # Main MCP server entry point
```

### Design Principles

1. **Layered Architecture**: Clear separation between tools, core logic, and integrations
2. **Dependency Injection**: Configurable backends (local vs OpenAI vs cloud)
3. **Fail-Safe Design**: Always provide basic functionality when external services fail
4. **Resource Management**: Proper cleanup of file handles, parsers, and memory
5. **Extensibility**: Plugin-friendly architecture for new language support

## Issue Reporting

### Bug Reports

Please include:

- Node.js version and OS
- MCP server version
- IDE being used (Claude Code, Cursor, VS Code)
- Minimal reproduction case
- Expected vs actual behavior
- Relevant log output

### Feature Requests

Please include:

- Clear description of the problem you're trying to solve
- Proposed solution or API design
- Alternative solutions you've considered
- Examples of how it would be used

## Commit Guidelines

### Commit Message Format

```
type(scope): description

[optional body]

[optional footer]
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, etc.)
- **refactor**: Code changes that neither fix bugs nor add features
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **chore**: Maintenance tasks

### Examples

```
feat(compactor): add Python AST parsing support

Implements tree-sitter based Python parsing with symbol extraction
for functions, classes, and imports. Includes comprehensive test
coverage and performance benchmarks.

Closes #123
```

```
fix(tools): handle file permission errors gracefully

Previously, permission errors would crash the tool execution.
Now they're logged as warnings and the tool continues processing
other files.

Fixes #456
```

## Performance Considerations

### Memory Usage

- Keep peak memory under 100MB for typical projects
- Implement proper disposal patterns for large objects
- Use streaming approaches for large file processing

### Processing Speed

- Target <5 seconds for 100-file projects
- Cache expensive operations when possible
- Provide progress feedback for long operations

### Token Efficiency

- Maintain 60-80% compression ratios
- Preserve semantic meaning in compressed output
- Optimize for common LLM context windows (4K, 8K, 16K tokens)

## Documentation Standards

### Code Documentation

- JSDoc comments for all public APIs
- Inline comments for complex algorithms
- README files for major components
- Architecture decision records (ADRs) for significant changes

### User Documentation

- Clear installation instructions for all supported IDEs
- Usage examples with real-world scenarios
- Troubleshooting guides for common issues
- Performance tuning recommendations

## Security Guidelines

### Input Validation

- Validate all file paths for traversal attacks
- Sanitize user queries for regex injection
- Limit file sizes and processing time
- Never log sensitive information (API keys, tokens, etc.)

### API Key Handling

- Store keys in environment variables only
- Validate key formats before use
- Handle authentication failures gracefully
- Provide clear error messages for key issues

## Release Process

### Version Management

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes to MCP tools or APIs
- **MINOR**: New features, new tools, or enhanced functionality
- **PATCH**: Bug fixes and performance improvements

### Release Checklist

- [ ] All tests pass
- [ ] Performance benchmarks meet targets
- [ ] Documentation is updated
- [ ] CHANGELOG.md is updated
- [ ] Version number is bumped
- [ ] Release notes are prepared

## Questions?

Feel free to:

- Open an issue for bugs or feature requests
- Start a discussion for questions about contributing
- Reach out to maintainers for architectural discussions

Thanks for contributing! 🚀