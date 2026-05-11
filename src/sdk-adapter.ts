import type { StreamMessage, WorkerStats } from './types.js';
import { updateWorkerStatus, logEvent } from './db.js';

// Claude Code stream-json message format (actual output)
interface ClaudeMessage {
  type: string;
  subtype?: string;
  message?: {
    role: string;
    content?: Array<{
      type: string;
      thinking?: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }> | string;
  };
  // For tool_result messages
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  error?: string;
  thinking?: string;
  content?: string;
  usage?: { input_tokens: number; output_tokens: number };
  // Result message
  result?: string;
  is_error?: boolean;
}

export class SDKAdapter {
  private buffer = '';

  parseChunk(data: Buffer): StreamMessage[] {
    this.buffer += data.toString();
    const messages: StreamMessage[] = [];
    const lines = this.buffer.split('\n');

    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as ClaudeMessage;
        // Convert Claude format to our StreamMessage format
        messages.push(this.normalizeMessage(msg));
      } catch {
        // Not valid JSON, internal log line
      }
    }

    return messages;
  }

  private normalizeMessage(msg: ClaudeMessage): StreamMessage {
    // Handle assistant messages with content array (thinking + tool_use blocks)
    if (msg.type === 'assistant' && msg.message?.content) {
      const content = msg.message.content;
      if (Array.isArray(content)) {
        // Find text content
        const textBlock = content.find(c => c.type === 'text');
        const thinkingBlock = content.find(c => c.type === 'thinking');
        const toolUseBlock = content.find(c => c.type === 'tool_use');

        if (toolUseBlock) {
          return {
            type: 'tool_use',
            content: textBlock?.text || thinkingBlock?.thinking || '',
            tool_name: toolUseBlock.name,
            tool_input: toolUseBlock.input as Record<string, unknown>,
            thinking: thinkingBlock?.thinking,
          };
        }

        return {
          type: 'assistant',
          content: textBlock?.text || thinkingBlock?.thinking || '',
          thinking: thinkingBlock?.thinking,
        };
      }
    }

    // Handle tool_result messages
    if (msg.type === 'tool_result') {
      return {
        type: 'tool_result',
        tool_name: msg.tool_name,
        tool_output: msg.tool_output,
        error: msg.error,
      };
    }

    // Handle result messages
    if (msg.type === 'result') {
      return {
        type: 'done',
        content: msg.result,
      };
    }

    // Pass through other messages
    return {
      type: msg.type as StreamMessage['type'],
      content: msg.content,
      tool_name: msg.tool_name,
      tool_input: msg.tool_input,
      tool_output: msg.tool_output,
      error: msg.error,
      thinking: msg.thinking,
      usage: msg.usage,
    };
  }

  processMessage(workerId: string, goalId: string, message: StreamMessage): Partial<WorkerStats> | null {
    // Event-driven logging: only key events, not every message
    switch (message.type) {
      case 'tool_use': {
        return this.handleToolUse(workerId, goalId, message);
      }
      case 'done': {
        logEvent({
          worker_id: workerId,
          goal_id: goalId,
          event_type: 'task_complete',
          summary: message.content?.slice(0, 500) || 'Task completed',
        });
        updateWorkerStatus(workerId, 'stopped');
        return null;
      }
      case 'error': {
        logEvent({
          worker_id: workerId,
          goal_id: goalId,
          event_type: 'task_error',
          summary: message.error?.slice(0, 500) || 'Unknown error',
          details: { error: message.error },
        });
        updateWorkerStatus(workerId, 'error');
        return null;
      }
      default:
        return null;
    }
  }

  private handleToolUse(workerId: string, goalId: string, message: StreamMessage): Partial<WorkerStats> | null {
    if (!message.tool_name) return null;

    const update: Partial<WorkerStats> = {
      toolsUsed: { [message.tool_name]: 1 },
    };

    // Only log key file operations as events
    if (message.tool_name === 'Edit' || message.tool_name === 'Write') {
      const input = message.tool_input || {};
      const filePath = (input.file_path || input.path || '') as string;
      if (filePath) {
        logEvent({
          worker_id: workerId,
          goal_id: goalId,
          event_type: 'file_write',
          file_path: filePath,
          tool_name: message.tool_name,
          summary: `${message.tool_name}: ${filePath}`,
        });
      }
    }

    if (message.tool_name === 'Read') {
      const input = message.tool_input || {};
      const filePath = (input.file_path || input.path || '') as string;
      if (filePath) {
        logEvent({
          worker_id: workerId,
          goal_id: goalId,
          event_type: 'file_read',
          file_path: filePath,
          tool_name: message.tool_name,
          summary: `Read: ${filePath}`,
        });
      }
    }

    return update;
  }

  extractResult(messages: StreamMessage[]): { output: string; filesModified: string[] } {
    const output: string[] = [];
    const files = new Set<string>();

    for (const msg of messages) {
      if (msg.type === 'assistant' && msg.content) {
        output.push(msg.content);
      }
      if (msg.type === 'tool_use') {
        const input = msg.tool_input || {};
        const filePath = (input.file_path || input.path || '') as string;
        if (filePath && (msg.tool_name === 'Edit' || msg.tool_name === 'Write')) {
          files.add(filePath);
        }
      }
    }

    return {
      output: output.join('\n\n'),
      filesModified: Array.from(files),
    };
  }
}
