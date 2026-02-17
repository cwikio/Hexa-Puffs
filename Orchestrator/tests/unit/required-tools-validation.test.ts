import { describe, it, expect } from 'vitest';

/**
 * Extracted validation logic that mirrors what server.ts and http-handlers.ts do
 * when proxying memory_store_skill calls. Tests the filtering pattern in isolation.
 */
function validateRequiredTools(
  requiredTools: unknown,
  hasRoute: (name: string) => boolean,
  customHandlers: Record<string, unknown>,
): string[] {
  if (!Array.isArray(requiredTools) || requiredTools.length === 0) return [];
  return requiredTools.filter(
    (t) => typeof t === 'string' && !hasRoute(t) && !customHandlers[t],
  );
}

describe('required_tools validation logic', () => {
  const knownRoutes = new Set([
    'telegram_send_message',
    'gmail_send_email',
    'memory_store_fact',
    'memory_list_facts',
    'searcher_web_search',
    'filer_create_file',
  ]);
  const hasRoute = (name: string) => knownRoutes.has(name);
  const customHandlers: Record<string, unknown> = {
    get_status: true,
    queue_task: true,
    trigger_backfill: true,
    get_tool_catalog: true,
  };

  it('should return empty when all tools exist as routes', () => {
    const unknown = validateRequiredTools(
      ['telegram_send_message', 'gmail_send_email'],
      hasRoute,
      customHandlers,
    );
    expect(unknown).toEqual([]);
  });

  it('should return empty when all tools exist as custom handlers', () => {
    const unknown = validateRequiredTools(
      ['get_status', 'queue_task'],
      hasRoute,
      customHandlers,
    );
    expect(unknown).toEqual([]);
  });

  it('should return empty for mix of routes and custom handlers', () => {
    const unknown = validateRequiredTools(
      ['telegram_send_message', 'get_tool_catalog'],
      hasRoute,
      customHandlers,
    );
    expect(unknown).toEqual([]);
  });

  it('should detect unknown tool names', () => {
    const unknown = validateRequiredTools(
      ['telegram_send_message', 'nonexistent_tool', 'fake_search'],
      hasRoute,
      customHandlers,
    );
    expect(unknown).toEqual(['nonexistent_tool', 'fake_search']);
  });

  it('should return empty when required_tools is empty array', () => {
    const unknown = validateRequiredTools([], hasRoute, customHandlers);
    expect(unknown).toEqual([]);
  });

  it('should return empty when required_tools is undefined', () => {
    const unknown = validateRequiredTools(undefined, hasRoute, customHandlers);
    expect(unknown).toEqual([]);
  });

  it('should return empty when required_tools is not an array', () => {
    const unknown = validateRequiredTools('not_an_array', hasRoute, customHandlers);
    expect(unknown).toEqual([]);
  });

  it('should skip non-string items in the array', () => {
    const unknown = validateRequiredTools(
      ['telegram_send_message', 123, null, 'fake_tool'],
      hasRoute,
      customHandlers,
    );
    expect(unknown).toEqual(['fake_tool']);
  });

  it('should detect all unknown when none exist', () => {
    const unknown = validateRequiredTools(
      ['invented_tool_a', 'invented_tool_b'],
      hasRoute,
      customHandlers,
    );
    expect(unknown).toEqual(['invented_tool_a', 'invented_tool_b']);
  });
});
