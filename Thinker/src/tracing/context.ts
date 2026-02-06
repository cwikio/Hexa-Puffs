import { nanoid } from 'nanoid';
import type { TraceContext } from './types.js';
import { TRACE_ID_HEADER } from './types.js';

/**
 * Create a new trace context
 */
export function createTrace(mcp: string = 'thinker'): TraceContext {
  return {
    traceId: `tr_${nanoid(12)}`,
    startedAt: Date.now(),
    mcp,
  };
}

/**
 * Extract trace context from HTTP headers
 */
export function getTraceFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  mcp: string = 'thinker'
): TraceContext | null {
  const traceId = headers[TRACE_ID_HEADER] || headers[TRACE_ID_HEADER.toLowerCase()];

  if (!traceId) {
    return null;
  }

  const id = Array.isArray(traceId) ? traceId[0] : traceId;

  return {
    traceId: id,
    startedAt: Date.now(),
    mcp,
  };
}

/**
 * Create headers object with trace ID for propagation
 */
export function createTraceHeaders(ctx: TraceContext): Record<string, string> {
  return {
    [TRACE_ID_HEADER]: ctx.traceId,
  };
}

/**
 * Get or create trace context from headers
 */
export function getOrCreateTrace(
  headers: Record<string, string | string[] | undefined>,
  mcp: string = 'thinker'
): TraceContext {
  return getTraceFromHeaders(headers, mcp) || createTrace(mcp);
}

/**
 * Calculate duration from trace start
 */
export function getTraceDuration(ctx: TraceContext): number {
  return Date.now() - ctx.startedAt;
}
