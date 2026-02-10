import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerTool } from '../Utils/register-tool.js';
import { ValidationError } from '../Types/errors.js';

function createMockServer() {
  return { registerTool: vi.fn() };
}

describe('registerTool', () => {
  it('should call server.registerTool with name, config, and handler', () => {
    const server = createMockServer();
    const schema = z.object({ query: z.string() });

    registerTool(server, {
      name: 'search',
      description: 'Search for things',
      inputSchema: schema,
      handler: async () => ({ success: true, data: 'ok' }),
    });

    expect(server.registerTool).toHaveBeenCalledOnce();
    const [name, config] = server.registerTool.mock.calls[0];
    expect(name).toBe('search');
    expect(config.description).toBe('Search for things');
  });

  it('should extract .shape from the Zod schema', () => {
    const server = createMockServer();
    const schema = z.object({ name: z.string(), age: z.number() });

    registerTool(server, {
      name: 'test',
      description: 'test tool',
      inputSchema: schema,
      handler: async () => ({ success: true }),
    });

    const [, config] = server.registerTool.mock.calls[0];
    expect(config.inputSchema).toBe(schema.shape);
    expect(config.inputSchema).toHaveProperty('name');
    expect(config.inputSchema).toHaveProperty('age');
  });

  it('should pass annotations through', () => {
    const server = createMockServer();
    const annotations = { readOnlyHint: true, destructiveHint: false };

    registerTool(server, {
      name: 'read',
      description: 'read-only tool',
      inputSchema: z.object({}),
      annotations,
      handler: async () => ({ success: true }),
    });

    const [, config] = server.registerTool.mock.calls[0];
    expect(config.annotations).toEqual(annotations);
  });

  describe('handler wrapper', () => {
    it('should wrap successful handler result in MCP content format', async () => {
      const server = createMockServer();

      registerTool(server, {
        name: 'test',
        description: 'test',
        inputSchema: z.object({}),
        handler: async () => ({ success: true, data: { count: 5 } }),
      });

      // Extract the registered handler (3rd argument to server.registerTool)
      const handler = server.registerTool.mock.calls[0][2] as (
        args: Record<string, unknown>
      ) => Promise<{ content: Array<{ type: string; text: string }> }>;

      const result = await handler({});
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ count: 5 });
    });

    it('should wrap thrown errors in MCP content format', async () => {
      const server = createMockServer();

      registerTool(server, {
        name: 'fail',
        description: 'fails',
        inputSchema: z.object({}),
        handler: async () => { throw new Error('Something went wrong'); },
      });

      const handler = server.registerTool.mock.calls[0][2] as (
        args: Record<string, unknown>
      ) => Promise<{ content: Array<{ type: string; text: string }> }>;

      const result = await handler({});
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Something went wrong');
    });

    it('should handle non-Error throws', async () => {
      const server = createMockServer();

      registerTool(server, {
        name: 'fail',
        description: 'fails',
        inputSchema: z.object({}),
        handler: async () => { throw 'string error'; },
      });

      const handler = server.registerTool.mock.calls[0][2] as (
        args: Record<string, unknown>
      ) => Promise<{ content: Array<{ type: string; text: string }> }>;

      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Unknown error');
    });

    it('should include errorCode and errorDetails when handler throws BaseError', async () => {
      const server = createMockServer();

      registerTool(server, {
        name: 'validate',
        description: 'validates',
        inputSchema: z.object({}),
        handler: async () => { throw new ValidationError('bad email', { field: 'email' }); },
      });

      const handler = server.registerTool.mock.calls[0][2] as (
        args: Record<string, unknown>
      ) => Promise<{ content: Array<{ type: string; text: string }> }>;

      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('bad email');
      expect(parsed.errorCode).toBe('VALIDATION_ERROR');
      expect(parsed.errorDetails).toEqual({ field: 'email' });
    });

    it('should pass input arguments to the handler', async () => {
      const server = createMockServer();
      const receivedInput = vi.fn();

      registerTool(server, {
        name: 'echo',
        description: 'echo',
        inputSchema: z.object({ msg: z.string() }),
        handler: async (input) => {
          receivedInput(input);
          return { success: true };
        },
      });

      const handler = server.registerTool.mock.calls[0][2] as (
        args: Record<string, unknown>
      ) => Promise<unknown>;

      await handler({ msg: 'hello' });
      expect(receivedInput).toHaveBeenCalledWith({ msg: 'hello' });
    });
  });
});
