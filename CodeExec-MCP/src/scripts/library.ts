/**
 * Script Library — filesystem-based storage for reusable code scripts.
 *
 * Each script is a directory containing a code file + metadata.json.
 * A consolidated index.json enables fast listing/searching.
 */

import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getConfig, isForbiddenPath, expandHome } from '../config.js';
import { executeInSubprocess } from '../executor/subprocess.js';
import type {
  ScriptLanguage,
  ScriptMetadata,
  SaveScriptResult,
  GetScriptResult,
  RunScriptResult,
  DeleteScriptResult,
} from './types.js';

const EXTENSIONS: Record<ScriptLanguage, string> = {
  python: 'script.py',
  node: 'script.mjs',
  bash: 'script.sh',
};

export class ScriptLibrary {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? getConfig().scriptsDir;
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async save(opts: {
    name: string;
    description: string;
    language: ScriptLanguage;
    code: string;
    tags?: string[];
    packages?: string[];
  }): Promise<SaveScriptResult> {
    const slug = this.slugify(opts.name);
    if (!slug) {
      throw new Error('Script name must contain at least one alphanumeric character');
    }

    const scriptDir = this.getScriptDir(slug);
    const isNew = !existsSync(scriptDir);
    await mkdir(scriptDir, { recursive: true });

    const now = new Date().toISOString();
    const existing = isNew ? null : await this.readMetadata(slug).catch(() => null);

    const metadata: ScriptMetadata = {
      name: slug,
      description: opts.description,
      language: opts.language,
      tags: opts.tags ?? [],
      packages: opts.packages ?? [],
      created_at: existing?.created_at ?? now,
      updated_at: now,
      last_run_at: existing?.last_run_at ?? null,
      run_count: existing?.run_count ?? 0,
      last_run_success: existing?.last_run_success ?? null,
    };

    // Write code file and metadata
    const codeFile = join(scriptDir, EXTENSIONS[opts.language]);
    await writeFile(codeFile, opts.code, 'utf-8');
    await writeFile(
      join(scriptDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8',
    );

    // If language changed, remove old code file
    if (existing && existing.language !== opts.language) {
      const oldFile = join(scriptDir, EXTENSIONS[existing.language]);
      await rm(oldFile, { force: true });
    }

    // Update index
    await this.updateIndex(slug, metadata);

    return { name: slug, language: opts.language, created: isNew };
  }

  // ── Get ──────────────────────────────────────────────────────────────────

  async get(name: string): Promise<GetScriptResult> {
    const slug = this.slugify(name);
    const metadata = await this.readMetadata(slug);
    const codeFile = join(this.getScriptDir(slug), EXTENSIONS[metadata.language]);

    let code: string;
    try {
      code = await readFile(codeFile, 'utf-8');
    } catch {
      throw new Error(`Script code file not found for "${slug}"`);
    }

    return { code, metadata };
  }

  // ── List ─────────────────────────────────────────────────────────────────

  async list(filters?: {
    language?: ScriptLanguage;
    tag?: string;
  }): Promise<ScriptMetadata[]> {
    const index = await this.readIndex();

    let results = index;
    if (filters?.language) {
      results = results.filter((s) => s.language === filters.language);
    }
    if (filters?.tag) {
      const tagLower = filters.tag.toLowerCase();
      results = results.filter((s) =>
        s.tags.some((t) => t.toLowerCase() === tagLower),
      );
    }

    return results;
  }

  // ── Search ───────────────────────────────────────────────────────────────

  async search(query: string): Promise<ScriptMetadata[]> {
    const index = await this.readIndex();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    if (terms.length === 0) return index;

    return index.filter((script) => {
      const searchable = [
        script.name,
        script.description,
        ...script.tags,
      ]
        .join(' ')
        .toLowerCase();

      return terms.every((term) => searchable.includes(term));
    });
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async delete(name: string): Promise<DeleteScriptResult> {
    const slug = this.slugify(name);
    const scriptDir = this.getScriptDir(slug);

    if (!existsSync(scriptDir)) {
      throw new Error(`Script "${slug}" not found`);
    }

    await rm(scriptDir, { recursive: true, force: true });
    await this.removeFromIndex(slug);

    return { name: slug, deleted: true };
  }

  // ── Run ──────────────────────────────────────────────────────────────────

  async run(opts: {
    name: string;
    args?: string[];
    timeout_ms?: number;
    working_dir?: string;
  }): Promise<RunScriptResult> {
    const { code, metadata } = await this.get(opts.name);
    const config = getConfig();

    // Validate working_dir if provided
    let workingDir = '';
    if (opts.working_dir) {
      workingDir = expandHome(opts.working_dir);
      if (isForbiddenPath(workingDir)) {
        throw new Error(`forbidden path: ${opts.working_dir}`);
      }
    }

    // Build code with args injection
    const args = opts.args ?? [];
    const wrappedCode = this.injectArgs(metadata.language, code, args);

    const timeout = Math.min(
      opts.timeout_ms ?? config.defaultTimeoutMs,
      config.maxTimeoutMs,
    );

    const result = await executeInSubprocess({
      language: metadata.language,
      code: wrappedCode,
      timeout_ms: timeout,
      working_dir: workingDir,
    });

    // Update run stats
    const success = result.exit_code === 0;
    await this.updateRunStats(metadata.name, success);

    return {
      name: metadata.name,
      execution_id: result.execution_id,
      language: metadata.language,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      duration_ms: result.duration_ms,
      timed_out: result.timed_out,
      truncated: result.truncated,
    };
  }

  // ── Private: Args Injection ──────────────────────────────────────────────

  private injectArgs(
    language: ScriptLanguage,
    code: string,
    args: string[],
  ): string {
    if (args.length === 0) return code;

    const argsJson = JSON.stringify(args);
    switch (language) {
      case 'python':
        return `import sys\nsys.argv = ['script.py'] + ${argsJson}\n${code}`;
      case 'node':
        return `process.argv = ['node', 'script.mjs', ...${argsJson}];\n${code}`;
      case 'bash':
        // For bash, args are passed via the subprocess command line
        // We use `set --` to inject positional parameters
        const escaped = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
        return `set -- ${escaped}\n${code}`;
    }
  }

  // ── Private: Index Management ────────────────────────────────────────────

  private get indexPath(): string {
    return join(this.baseDir, 'index.json');
  }

  async readIndex(): Promise<ScriptMetadata[]> {
    try {
      const raw = await readFile(this.indexPath, 'utf-8');
      return JSON.parse(raw) as ScriptMetadata[];
    } catch {
      // Index missing or corrupt — rebuild from disk
      return this.rebuildIndex();
    }
  }

  private async writeIndex(index: ScriptMetadata[]): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  private async updateIndex(slug: string, metadata: ScriptMetadata): Promise<void> {
    const index = await this.readIndex();
    const existing = index.findIndex((s) => s.name === slug);
    if (existing >= 0) {
      index[existing] = metadata;
    } else {
      index.push(metadata);
    }
    await this.writeIndex(index);
  }

  private async removeFromIndex(slug: string): Promise<void> {
    const index = await this.readIndex();
    const filtered = index.filter((s) => s.name !== slug);
    await this.writeIndex(filtered);
  }

  private async updateRunStats(slug: string, success: boolean): Promise<void> {
    const now = new Date().toISOString();

    // Update metadata.json
    try {
      const metadata = await this.readMetadata(slug);
      metadata.run_count++;
      metadata.last_run_at = now;
      metadata.last_run_success = success;
      await writeFile(
        join(this.getScriptDir(slug), 'metadata.json'),
        JSON.stringify(metadata, null, 2),
        'utf-8',
      );

      // Update index
      await this.updateIndex(slug, metadata);
    } catch {
      // Non-critical — don't fail the run if stats update fails
    }
  }

  private async rebuildIndex(): Promise<ScriptMetadata[]> {
    const index: ScriptMetadata[] = [];

    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const metadataPath = join(this.baseDir, entry.name, 'metadata.json');
          const raw = await readFile(metadataPath, 'utf-8');
          index.push(JSON.parse(raw) as ScriptMetadata);
        } catch {
          // Skip directories without valid metadata
        }
      }
    } catch {
      // Base directory doesn't exist yet — empty index
    }

    // Persist the rebuilt index
    await this.writeIndex(index).catch(() => {});
    return index;
  }

  // ── Private: Helpers ─────────────────────────────────────────────────────

  private async readMetadata(slug: string): Promise<ScriptMetadata> {
    const metaPath = join(this.getScriptDir(slug), 'metadata.json');
    try {
      const raw = await readFile(metaPath, 'utf-8');
      return JSON.parse(raw) as ScriptMetadata;
    } catch {
      throw new Error(`Script "${slug}" not found`);
    }
  }

  private getScriptDir(slug: string): string {
    return join(this.baseDir, slug);
  }

  slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
