import { describe, it, expect } from 'vitest';
import { createSuccess, createError } from '../Types/StandardResponse.js';
import type { StandardResponse } from '../Types/StandardResponse.js';

describe('StandardResponse', () => {
  describe('createSuccess', () => {
    it('should return success: true with data', () => {
      const result = createSuccess({ name: 'test' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });

    it('should not include error field', () => {
      const result = createSuccess('hello');
      expect(result.error).toBeUndefined();
    });

    it('should preserve complex data shapes', () => {
      const data = { items: [1, 2, 3], nested: { deep: true } };
      const result = createSuccess(data);
      expect(result.data).toEqual(data);
    });

    it('should handle null data', () => {
      const result = createSuccess(null);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('should handle primitive data types', () => {
      expect(createSuccess(42).data).toBe(42);
      expect(createSuccess('str').data).toBe('str');
      expect(createSuccess(true).data).toBe(true);
    });
  });

  describe('createError', () => {
    it('should return success: false with error message', () => {
      const result = createError('something broke');
      expect(result.success).toBe(false);
      expect(result.error).toBe('something broke');
    });

    it('should not include data field', () => {
      const result = createError('fail');
      expect(result.data).toBeUndefined();
    });
  });

  describe('type compatibility', () => {
    it('should satisfy StandardResponse interface', () => {
      const success: StandardResponse<number> = createSuccess(42);
      const error: StandardResponse<number> = createError('nope');
      expect(success.success).toBe(true);
      expect(error.success).toBe(false);
    });
  });
});
