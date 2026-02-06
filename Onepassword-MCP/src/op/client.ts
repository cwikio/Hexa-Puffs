import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Vault {
  id: string;
  name: string;
}

export interface ItemOverview {
  id: string;
  title: string;
  vault: {
    id: string;
    name: string;
  };
  category: string;
  created_at: string;
  updated_at: string;
}

export interface ItemField {
  id: string;
  type: string;
  label: string;
  value?: string;
  reference: string;
}

export interface ItemDetails {
  id: string;
  title: string;
  vault: {
    id: string;
    name: string;
  };
  category: string;
  fields: ItemField[];
  created_at: string;
  updated_at: string;
}

export class OpClientError extends Error {
  constructor(
    message: string,
    public readonly stderr: string
  ) {
    super(message);
    this.name = "OpClientError";
  }
}

async function runOp<T>(args: string[]): Promise<T> {
  try {
    const { stdout } = await execFileAsync("op", [...args, "--format=json"], {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    return JSON.parse(stdout) as T;
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      const stderr = String((error as { stderr: unknown }).stderr);
      throw new OpClientError(`1Password CLI error: ${stderr}`, stderr);
    }
    throw error;
  }
}

async function runOpRaw(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("op", args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      const stderr = String((error as { stderr: unknown }).stderr);
      throw new OpClientError(`1Password CLI error: ${stderr}`, stderr);
    }
    throw error;
  }
}

export async function listVaults(): Promise<Vault[]> {
  return runOp<Vault[]>(["vault", "list"]);
}

export async function listItems(
  vault: string,
  categories?: string[]
): Promise<ItemOverview[]> {
  const args = ["item", "list", "--vault", vault];
  if (categories && categories.length > 0) {
    args.push("--categories", categories.join(","));
  }
  return runOp<ItemOverview[]>(args);
}

export async function getItem(
  item: string,
  vault?: string
): Promise<ItemDetails> {
  const args = ["item", "get", item];
  if (vault) {
    args.push("--vault", vault);
  }
  return runOp<ItemDetails>(args);
}

export async function readSecret(reference: string): Promise<string> {
  return runOpRaw(["read", reference]);
}

export async function checkAuth(): Promise<{ authenticated: boolean; account?: string; error?: string }> {
  try {
    const output = await runOpRaw(["whoami"]);
    return { authenticated: true, account: output };
  } catch (error) {
    if (error instanceof OpClientError) {
      // op CLI exists but not signed in
      return { authenticated: false, error: error.stderr };
    }
    // op CLI not found or other system error
    return { authenticated: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
