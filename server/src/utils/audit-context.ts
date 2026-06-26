import { AsyncLocalStorage } from 'async_hooks';

export interface AuditContext {
  actor: 'user' | 'agent';
  actor_name?: string;
  /** Correlates every audit row produced by a single inbound request. */
  request_id?: string;
  /**
   * Free-text "why" attached to subsequent audit writes in this context.
   * Agent runs set this to the originating user message + tool name; manual
   * server-side scripts set it to a short note. Optional.
   */
  reason?: string;
}

export const auditContext = new AsyncLocalStorage<AuditContext>();
