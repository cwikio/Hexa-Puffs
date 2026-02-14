import { describe, it, expect } from 'vitest';
import { relaxSchemaTypes, stripNullValues, injectChatId } from '../../src/orchestrator/tools.js';

describe('relaxSchemaTypes', () => {
  it('does NOT add "null" for required properties', () => {
    const schema = {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['chat_id', 'message'],
    };

    const relaxed = relaxSchemaTypes(schema);
    const props = relaxed.properties as Record<string, Record<string, unknown>>;

    expect(props.chat_id.type).toBe('string');
    expect(props.message.type).toBe('string');
  });

  it('adds "null" to non-required string properties', () => {
    const schema = {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        label: { type: 'string' },
      },
      required: ['chat_id'],
    };

    const relaxed = relaxSchemaTypes(schema);
    const props = relaxed.properties as Record<string, Record<string, unknown>>;

    expect(props.chat_id.type).toBe('string');
    expect(props.label.type).toEqual(['string', 'null']);
  });

  it('adds "null" to non-required numeric properties alongside string relaxation', () => {
    const schema = {
      type: 'object',
      properties: {
        reply_to: { type: 'number' },
      },
      required: [],
    };

    const relaxed = relaxSchemaTypes(schema);
    const props = relaxed.properties as Record<string, Record<string, unknown>>;

    // Numeric relaxation runs first (number → [number, string])
    // Then null addition appends null → [number, string, null]
    expect(props.reply_to.type).toContain('number');
    expect(props.reply_to.type).toContain('string');
    expect(props.reply_to.type).toContain('null');
  });

  it('preserves existing numeric/boolean relaxation for required properties', () => {
    const schema = {
      type: 'object',
      properties: {
        count: { type: 'number' },
        enabled: { type: 'boolean' },
      },
      required: ['count', 'enabled'],
    };

    const relaxed = relaxSchemaTypes(schema);
    const props = relaxed.properties as Record<string, Record<string, unknown>>;

    expect(props.count.type).toEqual(['number', 'string']);
    expect(props.enabled.type).toEqual(['boolean', 'string']);
  });

  it('does not duplicate "null" if already present', () => {
    const schema = {
      type: 'object',
      properties: {
        field: { type: ['string', 'null'] },
      },
      required: [],
    };

    const relaxed = relaxSchemaTypes(schema);
    const props = relaxed.properties as Record<string, Record<string, unknown>>;

    const nullCount = (props.field.type as string[]).filter((t) => t === 'null').length;
    expect(nullCount).toBe(1);
  });

  it('handles schema with no required array', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    };

    const relaxed = relaxSchemaTypes(schema);
    const props = relaxed.properties as Record<string, Record<string, unknown>>;

    expect(props.name.type).toEqual(['string', 'null']);
  });

  it('does not mutate the original schema', () => {
    const schema = {
      type: 'object',
      properties: {
        reply_to: { type: 'number' },
      },
      required: [],
    };

    relaxSchemaTypes(schema);
    const props = schema.properties as Record<string, Record<string, unknown>>;

    expect(props.reply_to.type).toBe('number');
  });

  it('handles the telegram_send_message schema pattern', () => {
    const schema = {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        message: { type: 'string' },
        reply_to: { type: 'number' },
      },
      required: ['chat_id', 'message'],
    };

    const relaxed = relaxSchemaTypes(schema);
    const props = relaxed.properties as Record<string, Record<string, unknown>>;

    // Required string props unchanged
    expect(props.chat_id.type).toBe('string');
    expect(props.message.type).toBe('string');
    // Optional number: gets string + null relaxation
    expect(props.reply_to.type).toContain('number');
    expect(props.reply_to.type).toContain('string');
    expect(props.reply_to.type).toContain('null');
  });
});

describe('stripNullValues', () => {
  it('removes null entries from args', () => {
    const args = { chat_id: '123', reply_to: null, message: 'hello' };
    const result = stripNullValues(args);

    expect(result).not.toHaveProperty('reply_to');
    expect(result).toEqual({ chat_id: '123', message: 'hello' });
  });

  it('preserves falsy non-null values', () => {
    const args = { count: 0, enabled: false, label: '', items: null };
    const result = stripNullValues(args);

    expect(result.count).toBe(0);
    expect(result.enabled).toBe(false);
    expect(result.label).toBe('');
    expect(result).not.toHaveProperty('items');
  });

  it('returns the same object (mutates in-place)', () => {
    const args = { a: 1, b: null };
    const result = stripNullValues(args);

    expect(result).toBe(args);
  });

  it('handles empty object', () => {
    expect(stripNullValues({})).toEqual({});
  });

  it('keeps undefined values (only strips null)', () => {
    const args: Record<string, unknown> = { a: undefined, b: null };
    const result = stripNullValues(args);

    expect(result).toHaveProperty('a');
    expect(result).not.toHaveProperty('b');
  });
});

describe('injectChatId', () => {
  const PRIMARY_CHAT = '8304042211';

  it('injects chat_id when missing from telegram_send_message', () => {
    const args = { message: 'hello' };
    const result = injectChatId('telegram_send_message', args, PRIMARY_CHAT);

    expect(result.chat_id).toBe(PRIMARY_CHAT);
  });

  it('preserves valid short chat_id', () => {
    const args = { chat_id: '99999', message: 'hello' };
    const result = injectChatId('telegram_send_message', args, PRIMARY_CHAT);

    expect(result.chat_id).toBe('99999');
  });

  it('replaces hallucinated long chat_id', () => {
    const args = { chat_id: "the user's chat id or username", message: 'hello' };
    const result = injectChatId('telegram_send_message', args, PRIMARY_CHAT);

    expect(result.chat_id).toBe(PRIMARY_CHAT);
  });

  it('replaces hallucinated @username', () => {
    const args = { chat_id: '@some_long_username_here', message: 'hello' };
    const result = injectChatId('telegram_send_message', args, PRIMARY_CHAT);

    expect(result.chat_id).toBe(PRIMARY_CHAT);
  });

  it('does nothing for non-telegram tools', () => {
    const args = { query: 'AI news' };
    const result = injectChatId('searcher_web_search', args, PRIMARY_CHAT);

    expect(result).not.toHaveProperty('chat_id');
    expect(result.query).toBe('AI news');
  });

  it('does nothing when no primaryChatId is available', () => {
    const args = { message: 'hello' };
    const result = injectChatId('telegram_send_message', args, undefined);

    expect(result).not.toHaveProperty('chat_id');
  });

  it('injects when chat_id is null (after stripNullValues would have removed it)', () => {
    // After stripNullValues, chat_id would be deleted. But if it somehow remains as
    // a non-string falsy value, injectChatId should still inject.
    const args: Record<string, unknown> = { chat_id: '', message: 'hello' };
    const result = injectChatId('telegram_send_message', args, PRIMARY_CHAT);

    expect(result.chat_id).toBe(PRIMARY_CHAT);
  });

  it('preserves numeric chat_id string (valid Telegram ID)', () => {
    const args = { chat_id: '-1001234567890', message: 'hello' };
    const result = injectChatId('telegram_send_message', args, PRIMARY_CHAT);

    // 15 chars — under the 20-char threshold
    expect(result.chat_id).toBe('-1001234567890');
  });

  it('mutates the args object in-place', () => {
    const args = { message: 'hello' };
    const result = injectChatId('telegram_send_message', args, PRIMARY_CHAT);

    expect(result).toBe(args);
  });
});
