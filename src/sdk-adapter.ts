import type { StreamMessage, WorkerStats } from './types.js';
import { updateWorkerStatus, logTranscriptMessage } from './db.js';

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
        const msg = JSON.parse(line) as StreamMessage;
        messages.push(msg);
      } catch {
        // Not valid JSON, internal log line
      }
    }

    return messages;
  }

  processMessage(workerId: string, goalId: string, message: StreamMessage): Partial<WorkerStats> | null {
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

  private handleToolUse(workerId: string, message: StreamMessage): Partial<WorkerStats> | null {
    if (!message.tool_name) return null;

    const update: Partial<WorkerStats> = {};

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
