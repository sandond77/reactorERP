import { AsyncLocalStorage } from 'async_hooks';

export const auditContext = new AsyncLocalStorage<{ actor: 'user' | 'agent'; actor_name?: string }>();
