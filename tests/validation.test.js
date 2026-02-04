const {
  validateDynamicSignal,
  validateContextItems,
  validateEnhancedContext,
  ValidationError
} = require('../dist/src/core/validation.js');

describe('Context Validation Functions', () => {
  describe('validateContextItems', () => {
    it('should fail with empty context array', () => {
      expect(() => {
        validateContextItems([]);
      }).toThrow(ValidationError);
      
      try {
        validateContextItems([]);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.structured.code).toBe('INSUFFICIENT_CONTEXT');
      }
    });

    it('should fail with placeholder-only context', () => {
      expect(() => {
        validateContextItems([
          { path: 'enhanced_context', language: 'markdown', purpose: 'Enhanced embedding-based context' }
        ]);
      }).toThrow(ValidationError);
      
      try {
        validateContextItems([
          { path: 'enhanced_context', language: 'markdown', purpose: 'Enhanced embedding-based context' }
        ]);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.structured.code).toBe('INSUFFICIENT_CONTEXT');
      }
    });

    it('should pass with valid context', () => {
      expect(() => {
        validateContextItems([
          {
            path: 'src/main.ts',
            language: 'typescript',
            content: 'function main() { console.log("Hello World"); return true; }',
            symbols: ['main'],
            exports: ['main']
          }
        ]);
      }).not.toThrow();
    });
  });

  describe('validateEnhancedContext', () => {
    it('should fail with empty enhanced context', () => {
      expect(() => {
        validateEnhancedContext('', { tokenCount: 0 });
      }).toThrow(ValidationError);
      
      try {
        validateEnhancedContext('', { tokenCount: 0 });
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.structured.code).toBe('INSUFFICIENT_CONTEXT');
      }
    });
  });

  describe('validateDynamicSignal', () => {
    it('should fail with insufficient dynamic content in messages', () => {
      const messages = [
        { role: 'system', content: 'You are an expert software architect...' },
        { role: 'user', content: 'Analyze this code' }
      ];
      
      expect(() => {
        validateDynamicSignal(messages);
      }).toThrow(ValidationError);
      
      try {
        validateDynamicSignal(messages);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.structured.code).toBe('INSUFFICIENT_CONTEXT');
      }
    });
  });
});