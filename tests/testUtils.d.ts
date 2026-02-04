/**
 * TypeScript declarations for test utilities
 */

export function expectWithContext(value: any, context?: string): any;
export function captureTestError(testFn: () => Promise<void> | void, testName?: string): () => Promise<void>;
export function describeTest(testName: string, testFn: () => void): void;
export function itShould(description: string, testFn: () => Promise<void> | void): void;
export function expectAsync(promise: Promise<any>, expectedError?: string | null): Promise<any>;
