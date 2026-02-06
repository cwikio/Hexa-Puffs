import { describe, it, expect } from 'vitest';
import {
  BaseError,
  ConfigurationError,
  ValidationError,
  DatabaseError,
  NetworkError,
  TimeoutError,
} from '../Types/errors.js';

describe('BaseError', () => {
  it('should set message, code, and details', () => {
    const err = new BaseError('test message', 'TEST_CODE', { key: 'val' });
    expect(err.message).toBe('test message');
    expect(err.code).toBe('TEST_CODE');
    expect(err.details).toEqual({ key: 'val' });
  });

  it('should be instanceof Error', () => {
    const err = new BaseError('msg', 'CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BaseError);
  });

  it('should have name set to BaseError', () => {
    const err = new BaseError('msg', 'CODE');
    expect(err.name).toBe('BaseError');
  });

  it('should have a stack trace', () => {
    const err = new BaseError('msg', 'CODE');
    expect(err.stack).toBeDefined();
  });

  it('should make details optional', () => {
    const err = new BaseError('msg', 'CODE');
    expect(err.details).toBeUndefined();
  });
});

describe('Error subclasses', () => {
  const subclasses = [
    { Class: ConfigurationError, name: 'ConfigurationError', code: 'CONFIGURATION_ERROR' },
    { Class: ValidationError, name: 'ValidationError', code: 'VALIDATION_ERROR' },
    { Class: DatabaseError, name: 'DatabaseError', code: 'DATABASE_ERROR' },
    { Class: NetworkError, name: 'NetworkError', code: 'NETWORK_ERROR' },
    { Class: TimeoutError, name: 'TimeoutError', code: 'TIMEOUT_ERROR' },
  ] as const;

  for (const { Class, name, code } of subclasses) {
    describe(name, () => {
      it(`should have code "${code}"`, () => {
        const err = new Class('test');
        expect(err.code).toBe(code);
      });

      it(`should have name "${name}"`, () => {
        const err = new Class('test');
        expect(err.name).toBe(name);
      });

      it('should be instanceof BaseError and Error', () => {
        const err = new Class('test');
        expect(err).toBeInstanceOf(BaseError);
        expect(err).toBeInstanceOf(Error);
      });

      it('should preserve details when provided', () => {
        const details = { field: 'email', reason: 'invalid' };
        const err = new Class('test', details);
        expect(err.details).toEqual(details);
      });
    });
  }
});
