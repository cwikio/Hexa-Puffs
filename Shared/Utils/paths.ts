
import { homedir } from 'os';
import { resolve, join } from 'path';

export class PathManager {
  private static instance: PathManager;
  private homeDir: string;

  private constructor() {
    this.homeDir = process.env.ANNABELLE_HOME 
      ? resolve(process.env.ANNABELLE_HOME)
      : join(homedir(), '.annabelle');
  }

  public static getInstance(): PathManager {
    if (!PathManager.instance) {
      PathManager.instance = new PathManager();
    }
    return PathManager.instance;
  }

  public getHomeDir(): string {
    return this.homeDir;
  }

  public getAgentsDir(): string {
    return join(this.homeDir, 'agents');
  }

  public getSkillsDir(): string {
    return join(this.homeDir, 'skills');
  }

  public getLogsDir(): string {
    return join(this.homeDir, 'logs');
  }

  public getSessionsDir(): string {
    return join(this.homeDir, 'sessions');
  }

  public getDataDir(): string {
    return join(this.homeDir, 'data');
  }

  /**
   * Resolve a path relative to ANNABELLE_HOME if it starts with ~/.annabelle or just ~
   */
  public resolvePath(path: string): string {
    if (path.startsWith(this.homeDir)) {
      return path;
    }
    if (path.startsWith('~/.annabelle')) {
      return path.replace('~/.annabelle', this.homeDir);
    }
    if (path.startsWith('~/')) {
        return path.replace('~', homedir());
    }
    return resolve(path);
  }
}
