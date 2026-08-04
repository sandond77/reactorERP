import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';

// Single Anthropic client shared across every AI subagent (vision, moderation,
// summarization, chat). Reusing one instance means we don't pay to re-init
// HTTP connections, and the SDK's internal retry budget is process-scoped.
export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3 });
