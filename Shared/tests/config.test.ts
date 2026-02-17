import { describe, it, expect, afterEach } from 'vitest';
import { homedir } from 'os';
import {
  expandPath,
  getEnvString,
  getEnvNumber,
  getEnvFloat,
  getEnvBoolean,
  requireEnvString,
} from '../Utils/config.js';

const TEST_KEY = '__SHARED_TEST_VAR__';

describe('expandPath', () => {
  it('should expand ~ to home directory', () => {
    expect(expandPath('~/foo/bar')).toBe(`${homedir()}/foo/bar`);
  });

  it('should expand bare ~', () => {
    expect(expandPath('~')).toBe(homedir());
  });

  it('should leave absolute paths unchanged', () => {
    expect(expandPath('/usr/local/bin')).toBe('/usr/local/bin');
  });

  it('should leave relative paths unchanged', () => {
    expect(expandPath('relative/path')).toBe('relative/path');
  });

  it('should not expand ~ in the middle of a path', () => {
    const path = '/some/~/path';
    expect(expandPath(path)).toBe(path);
  });
});

describe('getEnvString', () => {
  afterEach(() => { delete process.env[TEST_KEY]; });

  it('should return value when set', () => {
    process.env[TEST_KEY] = 'hello';
    expect(getEnvString(TEST_KEY)).toBe('hello');
  });

  it('should return default when not set', () => {
    expect(getEnvString(TEST_KEY, 'fallback')).toBe('fallback');
  });

  it('should return undefined when not set and no default', () => {
    expect(getEnvString(TEST_KEY)).toBeUndefined();
  });

  it('should return empty string if env var is empty', () => {
    process.env[TEST_KEY] = '';
    expect(getEnvString(TEST_KEY)).toBe('');
  });
});

describe('getEnvNumber', () => {
  afterEach(() => { delete process.env[TEST_KEY]; });

  it('should parse integer values', () => {
    process.env[TEST_KEY] = '8080';
    expect(getEnvNumber(TEST_KEY)).toBe(8080);
  });

  it('should return default for non-numeric', () => {
    process.env[TEST_KEY] = 'abc';
    expect(getEnvNumber(TEST_KEY, 3000)).toBe(3000);
  });

  it('should return default when not set', () => {
    expect(getEnvNumber(TEST_KEY, 42)).toBe(42);
  });

  it('should return undefined when not set and no default', () => {
    expect(getEnvNumber(TEST_KEY)).toBeUndefined();
  });

  it('should truncate floats (parseInt behavior)', () => {
    process.env[TEST_KEY] = '3.14';
    expect(getEnvNumber(TEST_KEY)).toBe(3);
  });
});

describe('getEnvFloat', () => {
  afterEach(() => { delete process.env[TEST_KEY]; });

  it('should parse float values', () => {
    process.env[TEST_KEY] = '3.14';
    expect(getEnvFloat(TEST_KEY)).toBeCloseTo(3.14);
  });

  it('should parse integer values as floats', () => {
    process.env[TEST_KEY] = '42';
    expect(getEnvFloat(TEST_KEY)).toBe(42);
  });

  it('should return default for non-numeric', () => {
    process.env[TEST_KEY] = 'not-a-number';
    expect(getEnvFloat(TEST_KEY, 1.0)).toBe(1.0);
  });

  it('should return default when not set', () => {
    expect(getEnvFloat(TEST_KEY, 0.5)).toBe(0.5);
  });
});

describe('getEnvBoolean', () => {
  afterEach(() => { delete process.env[TEST_KEY]; });

  it('should recognize "true"', () => {
    process.env[TEST_KEY] = 'true';
    expect(getEnvBoolean(TEST_KEY)).toBe(true);
  });

  it('should recognize "TRUE" (case-insensitive)', () => {
    process.env[TEST_KEY] = 'TRUE';
    expect(getEnvBoolean(TEST_KEY)).toBe(true);
  });

  it('should recognize "1"', () => {
    process.env[TEST_KEY] = '1';
    expect(getEnvBoolean(TEST_KEY)).toBe(true);
  });

  it('should recognize "false"', () => {
    process.env[TEST_KEY] = 'false';
    expect(getEnvBoolean(TEST_KEY)).toBe(false);
  });

  it('should recognize "0"', () => {
    process.env[TEST_KEY] = '0';
    expect(getEnvBoolean(TEST_KEY)).toBe(false);
  });

  it('should return default for unrecognized values', () => {
    process.env[TEST_KEY] = 'maybe';
    expect(getEnvBoolean(TEST_KEY, true)).toBe(true);
  });

  it('should return default when not set', () => {
    expect(getEnvBoolean(TEST_KEY, false)).toBe(false);
  });
});

describe('requireEnvString', () => {
  afterEach(() => { delete process.env[TEST_KEY]; });

  it('should return value when set', () => {
    process.env[TEST_KEY] = 'required-value';
    expect(requireEnvString(TEST_KEY)).toBe('required-value');
  });

  it('should throw when not set', () => {
    expect(() => requireEnvString(TEST_KEY)).toThrow(
      `Required environment variable ${TEST_KEY} is not defined`
    );
  });

  it('should throw when set to empty string', () => {
    process.env[TEST_KEY] = '';
    expect(() => requireEnvString(TEST_KEY)).toThrow(
      `Required environment variable ${TEST_KEY} is not defined`
    );
  });
});
