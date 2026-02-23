import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

const mockExistsSync = vi.fn().mockReturnValue(false);
const mockRealpathSync = vi.fn((p: string) => p);

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  realpathSync: (...args: unknown[]) => mockRealpathSync(...args),
}));

vi.mock('../../src/utils/config.js', () => ({
  getConfig: () => ({
    workspace: { path: '/home/test/workspace' },
  }),
  expandHome: (p: string) => p.replace('~', '/home/test'),
}));

import {
  isForbiddenPath,
  hasPathTraversal,
  isForbiddenExtension,
  resolvePath,
  isWorkspacePath,
  validateForCreation,
  generateBackupPath,
} from '../../src/utils/paths.js';

describe('paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockRealpathSync.mockImplementation((p: string) => p);
  });

  describe('isForbiddenPath', () => {
    it('blocks ~/.ssh/', () => {
      expect(isForbiddenPath('/home/test/.ssh/id_rsa')).toBe(true);
    });

    it('blocks /etc/', () => {
      expect(isForbiddenPath('/etc/passwd')).toBe(true);
    });

    it('blocks ~/.aws/', () => {
      expect(isForbiddenPath('/home/test/.aws/credentials')).toBe(true);
    });

    it('blocks ~/.config/', () => {
      expect(isForbiddenPath('/home/test/.config/some-app')).toBe(true);
    });

    it('blocks /var/', () => {
      expect(isForbiddenPath('/var/log/syslog')).toBe(true);
    });

    it('allows normal workspace path', () => {
      expect(isForbiddenPath('/home/test/workspace/docs/file.txt')).toBe(false);
    });

    it('allows paths outside forbidden list', () => {
      expect(isForbiddenPath('/home/test/projects/readme.md')).toBe(false);
    });
  });

  describe('hasPathTraversal', () => {
    it('detects ..', () => {
      expect(hasPathTraversal('../etc/passwd')).toBe(true);
    });

    it('detects .. in middle of path', () => {
      expect(hasPathTraversal('docs/../../../etc/passwd')).toBe(true);
    });

    it('detects encoded ..', () => {
      expect(hasPathTraversal('%2e%2e/etc/passwd')).toBe(true);
    });

    it('blocks malformed URI encoding', () => {
      expect(hasPathTraversal('%ZZmalformed%')).toBe(true);
    });

    it('allows normal relative paths', () => {
      expect(hasPathTraversal('docs/readme.md')).toBe(false);
    });

    it('allows absolute paths without traversal', () => {
      expect(hasPathTraversal('/home/test/file.txt')).toBe(false);
    });
  });

  describe('isForbiddenExtension', () => {
    it('blocks .exe', () => {
      expect(isForbiddenExtension('malware.exe')).toBe(true);
    });

    it('blocks .bat', () => {
      expect(isForbiddenExtension('script.bat')).toBe(true);
    });

    it('blocks .ps1', () => {
      expect(isForbiddenExtension('script.ps1')).toBe(true);
    });

    it('blocks .EXE (case insensitive)', () => {
      expect(isForbiddenExtension('file.EXE')).toBe(true);
    });

    it('allows .sh in Code/bash/ directory', () => {
      expect(isForbiddenExtension('Code/bash/deploy.sh')).toBe(false);
    });

    it('blocks .sh outside Code/bash/', () => {
      expect(isForbiddenExtension('/tmp/evil.sh')).toBe(true);
    });

    it('allows .txt', () => {
      expect(isForbiddenExtension('readme.txt')).toBe(false);
    });

    it('allows .json', () => {
      expect(isForbiddenExtension('config.json')).toBe(false);
    });

    it('allows .md', () => {
      expect(isForbiddenExtension('README.md')).toBe(false);
    });
  });

  describe('resolvePath', () => {
    it('resolves relative path to workspace domain', () => {
      const result = resolvePath('docs/readme.md');
      expect(result.domain).toBe('workspace');
      expect(result.fullPath).toContain('/home/test/workspace');
      expect(result.relativePath).toBe('docs/readme.md');
    });

    it('throws on traversal in relative path', () => {
      expect(() => resolvePath('../escape.txt')).toThrow('Path traversal');
    });

    it('classifies absolute path as external', () => {
      const result = resolvePath('/tmp/data.csv');
      expect(result.domain).toBe('external');
      expect(result.fullPath).toBe('/tmp/data.csv');
    });

    it('throws on forbidden absolute path', () => {
      expect(() => resolvePath('/etc/passwd')).toThrow('forbidden');
    });

    it('throws on forbidden ~ path', () => {
      expect(() => resolvePath('~/.ssh/id_rsa')).toThrow('forbidden');
    });

    it('detects symlink escaping workspace', () => {
      mockExistsSync.mockReturnValue(true);
      mockRealpathSync.mockReturnValue('/etc/shadow');

      expect(() => resolvePath('docs/sneaky-link')).toThrow('symlink');
    });

    it('detects symlink resolving to forbidden path for absolute paths', () => {
      mockExistsSync.mockReturnValue(true);
      mockRealpathSync.mockReturnValue('/home/test/.ssh/id_rsa');

      expect(() => resolvePath('/tmp/innocent-link')).toThrow('forbidden');
    });
  });

  describe('isWorkspacePath', () => {
    it('returns true for workspace path', () => {
      expect(isWorkspacePath('docs/readme.md')).toBe(true);
    });

    it('returns false for external path', () => {
      expect(isWorkspacePath('/tmp/data.csv')).toBe(false);
    });

    it('returns false for forbidden path (does not throw)', () => {
      expect(isWorkspacePath('/etc/passwd')).toBe(false);
    });
  });

  describe('validateForCreation', () => {
    it('throws on forbidden extension', () => {
      expect(() => validateForCreation('malware.exe')).toThrow('extension');
    });

    it('passes on allowed extension', () => {
      expect(() => validateForCreation('notes.md')).not.toThrow();
    });
  });

  describe('generateBackupPath', () => {
    it('produces timestamped .bak path in temp folder', () => {
      const result = generateBackupPath('/home/test/workspace/docs/report.txt');
      expect(result).toContain('/home/test/workspace/temp/');
      expect(result).toContain('report.txt_');
      expect(result).toMatch(/\.bak$/);
    });

    it('includes ISO-like timestamp in filename', () => {
      const result = generateBackupPath('/some/file.json');
      // Format: filename_YYYY-MM-DDTHHMMSSZ.bak (dashes kept, colons/dots stripped)
      expect(result).toMatch(/file\.json_\d{4}-\d{2}-\d{2}T\d+Z\.bak$/);
    });
  });
});
