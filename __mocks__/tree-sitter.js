// Mock tree-sitter Parser
class MockParser {
  constructor() {
    this.language = null;
  }

  setLanguage(language) {
    this.language = language;
  }

  parse(source) {
    return {
      rootNode: {
        type: 'program',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 10, column: 0 },
        children: []
      }
    };
  }
}

module.exports = MockParser;