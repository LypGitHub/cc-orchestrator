import type { StreamMessage, WorkerStats } from './types.js';
import { updateWorkerStatus, logTranscriptMessage } from './db.js';

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
    // Log raw message
    logTranscriptMessage(workerId, goalId, {
      type: message.type,
      content: message.content,
      tool_name: message.tool_name,
      tool_input: message.tool_input ? JSON.stringify(message.tool_input) : undefined,
      tool_output: message.tool_output ? JSON.stringify(message.tool_output) : undefined,
      error: message.error,
      thinking: message.thinking,
      usage_input_tokens: message.usage?.input_tokens,
      usage_output_tokens: message.usage?.output_tokens,
    });

    switch (message.type) {
      case 'tool_use': {
        return this.handleToolUse(workerId, message);
      }
      case 'done': {
        updateWorkerStatus(workerId, 'stopped');
        return null;
      }
      case 'error': {
        updateWorkerStatus(workerId, 'error');
        return null;
      }
      default:
        return null;
    }
  }

  private handleToolUse(_workerId: string, message: StreamMessage): Partial<WorkerStats> | null {
    if (!message.tool_name) return null;

    const update: Partial<WorkerStats> = {
      toolsUsed: { [message.tool_name]: 1 },
    };

    if (message.tool_name === 'Edit' || message.tool_name === 'Write') {
      const input = message.tool_input || {};
      const filePath = (input.file_path || input.path || '') as string;
      if (filePath) {
        // File modification tracked at orchestrator level
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
