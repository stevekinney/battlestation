import { describe, expect, it } from 'bun:test';

import { greet, parseEnvironment } from './index.js';

it('loads the test preload', () => {
  expect((globalThis as Record<string, unknown>)['__BUN_TEST_SETUP_LOADED__']).toBe(true);
});

describe('greet', () => {
  it('greets by name', () => {
    expect(greet('World')).toBe('Hello, World!');
  });
});

describe('parseEnvironment', () => {
  it('applies defaults when variables are absent', () => {
    const environment = parseEnvironment({});
    expect(environment.NODE_ENV).toBe('development');
    expect(environment.PORT).toBe(3000);
  });

  it('coerces PORT to a number', () => {
    const environment = parseEnvironment({ PORT: '8080' });
    expect(environment.PORT).toBe(8080);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'staging' })).toThrow();
  });

  it('rejects a non-positive PORT', () => {
    expect(() => parseEnvironment({ PORT: '0' })).toThrow();
  });
});
