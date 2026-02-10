import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../Utils/logger.js';

describe('Logger', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  describe('level filtering', () => {
    it('should log at or above the configured level', () => {
      const log = new Logger('test');
      log.setLevel('warn');

      log.debug('skip');
      log.info('skip');
      log.warn('show');
      log.error('show');

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should log everything at debug level', () => {
      const log = new Logger('test');
      log.setLevel('debug');

      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');

      expect(spy).toHaveBeenCalledTimes(4);
    });

    it('should only log errors at error level', () => {
      const log = new Logger('test');
      log.setLevel('error');

      log.debug('skip');
      log.info('skip');
      log.warn('skip');
      log.error('show');

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('output format', () => {
    it('should include timestamp, level, context, and message', () => {
      const log = new Logger('my-service');
      log.setLevel('info');
      log.info('hello world');

      expect(spy).toHaveBeenCalledTimes(1);
      const output = spy.mock.calls[0][0] as string;

      // Format: [ISO_TIMESTAMP] [LEVEL] [CONTEXT] message
      expect(output).toMatch(/^\[.+\] \[INFO\] \[my-service\] hello world$/);
    });

    it('should include JSON data when provided', () => {
      const log = new Logger('svc');
      log.setLevel('info');
      log.info('with data', { key: 'value' });

      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain('{"key":"value"}');
    });

    it('should serialize Error objects with message and stack', () => {
      const log = new Logger('svc');
      log.setLevel('error');
      const err = new Error('boom');
      log.error('failed', err);

      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain('"message":"boom"');
      expect(output).toContain('"name":"Error"');
      expect(output).toContain('"stack"');
    });

    it('should serialize Error objects with code property', () => {
      const log = new Logger('svc');
      log.setLevel('error');
      const err = Object.assign(new Error('fail'), { code: 'ENOENT' });
      log.error('file missing', err);

      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain('"code":"ENOENT"');
    });

    it('should output to console.error (not stdout)', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const log = new Logger('test');
      log.setLevel('info');
      log.info('test message');

      expect(spy).toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
      stdoutSpy.mockRestore();
    });
  });

  describe('child logger', () => {
    it('should create a child with compound context', () => {
      const parent = new Logger('parent');
      parent.setLevel('info');
      const child = parent.child('child');
      child.info('from child');

      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain('[parent:child]');
    });

    it('should inherit parent log level', () => {
      const parent = new Logger('p');
      parent.setLevel('warn');
      const child = parent.child('c');

      child.info('skip');
      child.warn('show');

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('setLevel / getLevel', () => {
    it('should get and set the log level', () => {
      const log = new Logger('test');
      log.setLevel('debug');
      expect(log.getLevel()).toBe('debug');

      log.setLevel('error');
      expect(log.getLevel()).toBe('error');
    });
  });

  describe('setContext', () => {
    it('should change the context prefix', () => {
      const log = new Logger('old');
      log.setLevel('info');
      log.setContext('new');
      log.info('msg');

      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain('[new]');
      expect(output).not.toContain('[old]');
    });
  });

  describe('LOG_LEVEL env var', () => {
    const originalLevel = process.env.LOG_LEVEL;

    afterEach(() => {
      if (originalLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = originalLevel;
      }
    });

    it('should read initial level from LOG_LEVEL env var', () => {
      process.env.LOG_LEVEL = 'debug';
      const log = new Logger('test');
      expect(log.getLevel()).toBe('debug');
    });

    it('should default to info for invalid LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'invalid';
      const log = new Logger('test');
      expect(log.getLevel()).toBe('info');
    });

    it('should default to info when LOG_LEVEL not set', () => {
      delete process.env.LOG_LEVEL;
      const log = new Logger('test');
      expect(log.getLevel()).toBe('info');
    });
  });
});
