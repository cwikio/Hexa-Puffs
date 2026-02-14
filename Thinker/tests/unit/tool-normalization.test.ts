import { describe, it, expect } from 'vitest';
import { relaxSchemaTypes, stripNullValues } from '../../src/orchestrator/tools.js';

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
