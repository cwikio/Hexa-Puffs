/**
 * Trace context for request tracking across MCPs
 */
export interface TraceContext {
  traceId: string;
  startedAt: number;
  mcp: string;
}

/**
 * Trace log entry structure
 */
export interface TraceEntry {
  trace_id: string;
  ts: string;
  mcp: string;
  event: string;
  data: Record<string, unknown>;
}

/**
 * Common trace event types
 */
export type TraceEvent =
  | 'message_received'
  | 'context_loaded'
  | 'llm_call_start'
  | 'llm_call_complete'
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'tool_call_error'
  | 'response_sent'
  | 'error'
  | 'complete';

/**
 * Header name for trace ID propagation
 */
export const TRACE_ID_HEADER = 'X-Trace-Id';
