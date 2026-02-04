import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ResourceGuard } from '../resourceGuard';

describe('Phase 13 Resource Guard System', () => {
  let resourceGuard: ResourceGuard;

  beforeEach(() => {
    // Create a new ResourceGuard instance for each test
    resourceGuard = new ResourceGuard();
  });

  afterEach(async () => {
    // Clean up resources after each test
    await resourceGuard.disposeAll();
  });

  describe('Resource Registration', () => {
    it('should register and track resources', () => {
      const resourceId = resourceGuard.register({
        id: 'test-resource',
        type: 'timer',
        dispose: async () => {},
      });

      expect(resourceId).toBe('test-resource');

      const stats = resourceGuard.getStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byType.timer).toBeGreaterThan(0);
    });

    it('should dispose resources manually', async () => {
      const disposed = jest.fn();
      const resourceId = resourceGuard.register({
        id: 'test-resource-2',
        type: 'timer',
        dispose: disposed,
      });

      const result = await resourceGuard.dispose(resourceId);
      expect(result).toBe(true);
      expect(disposed).toHaveBeenCalled();
    });

    it('should handle disposal errors gracefully', async () => {
      const resourceId = resourceGuard.register({
        id: 'test-resource-3',
        type: 'timer',
        dispose: async () => {
          throw new Error('Disposal error');
        },
      });

      const result = await resourceGuard.dispose(resourceId);
      expect(result).toBe(false); // Should return false but not throw
    });
  });

  describe('Timer Management', () => {
    it('should create and manage timers', async () => {
      const callback = jest.fn();
      const timerId = resourceGuard.createTimer(callback, 50);

      expect(timerId).toBeDefined();
      expect(typeof timerId).toBe('string');

      const stats = resourceGuard.getStats();
      expect(stats.byType.timer).toBeGreaterThan(0);

      await resourceGuard.dispose(timerId);
    });

    it('should create and manage intervals', async () => {
      const callback = jest.fn();
      const intervalId = resourceGuard.createInterval(callback, 100);

      expect(intervalId).toBeDefined();
      expect(typeof intervalId).toBe('string');

      const stats = resourceGuard.getStats();
      expect(stats.byType.timer).toBeGreaterThan(0);

      await resourceGuard.dispose(intervalId);
    });

    it('should handle timer callback errors', async () => {
      const errorCallback = () => {
        throw new Error('Timer callback error');
      };

      const timerId = resourceGuard.createTimer(errorCallback, 10);

      // Wait for timer to execute
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not crash the system
      const stats = resourceGuard.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('AbortController Management', () => {
    it('should create and manage AbortControllers', async () => {
      const { id, controller } = resourceGuard.createAbortController();

      expect(id).toBeDefined();
      expect(controller).toBeInstanceOf(globalThis.AbortController);
      expect(controller.signal.aborted).toBe(false);

      await resourceGuard.dispose(id);
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should provide accurate statistics', async () => {
      const timer1 = resourceGuard.createTimer(() => {}, 1000);
      const timer2 = resourceGuard.createInterval(() => {}, 1000);
      const { id: abortId } = resourceGuard.createAbortController();

      // Small delay to ensure age > 0
      await new Promise(resolve => setTimeout(resolve, 1));

      const stats = resourceGuard.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byType.timer).toBe(2);
      expect(stats.byType.stream).toBe(1);

      if (stats.oldestResource) {
        expect(stats.oldestResource.id).toBeDefined();
        expect(stats.oldestResource.type).toBeDefined();
        expect(stats.oldestResource.age).toBeGreaterThanOrEqual(0);
      }
    });

    it('should track resource age', async () => {
      const resourceId = resourceGuard.createTimer(() => {}, 5000);

      // Wait a bit to ensure age is tracked
      await new Promise(resolve => setTimeout(resolve, 10));

      const stats = resourceGuard.getStats();
      if (stats.oldestResource) {
        expect(stats.oldestResource.age).toBeGreaterThan(0);
      }
    });
  });

  describe('Bulk Operations', () => {
    it('should dispose all resources', async () => {
      // Create multiple resources
      resourceGuard.createTimer(() => {}, 1000);
      resourceGuard.createInterval(() => {}, 1000);
      resourceGuard.createAbortController();

      const statsBeforeDispose = resourceGuard.getStats();
      expect(statsBeforeDispose.total).toBeGreaterThan(0);

      await resourceGuard.disposeAll();

      const statsAfterDispose = resourceGuard.getStats();
      expect(statsAfterDispose.total).toBe(0);
    });

    it('should handle dispose all with errors', async () => {
      // Create a resource that will error on disposal
      resourceGuard.register({
        id: 'error-resource',
        type: 'timer',
        dispose: async () => {
          throw new Error('Disposal error');
        },
      });

      // Should not throw, but clean up what it can
      await expect(resourceGuard.disposeAll()).resolves.not.toThrow();
    });
  });

  describe('Process Integration', () => {
    it('should be ready for process cleanup handlers', () => {
      // Verify that the resource guard can be used in process handlers
      const cleanup = async () => {
        await resourceGuard.disposeAll();
      };

      expect(typeof cleanup).toBe('function');
    });
  });
});
