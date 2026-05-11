import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SDKAdapter } from '../src/sdk-adapter.js';
import { initDatabase, getDb } from '../src/db.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SDKAdapter', () => {
  let adapter: SDKAdapter;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-orch-sdk-'));
    initDatabase(tempDir);
    adapter = new SDKAdapter();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('parses valid JSON lines from chunk', () => {
    const chunk = Buffer.from('{"type":"assistant","content":"Hello"}\n{"type":"done"}\n');
    const messages = adapter.parseChunk(chunk);
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('assistant');
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].type).toBe('done');
  });

  it('handles partial lines across chunks', () => {
    const chunk1 = Buffer.from('{"type":"assistant","content":"Hel');
    const chunk2 = Buffer.from('lo"}\n{"type":"done"}\n');
    const messages1 = adapter.parseChunk(chunk1);
    expect(messages1).toHaveLength(0);
    const messages2 = adapter.parseChunk(chunk2);
    expect(messages2).toHaveLength(2);
    expect(messages2[0].content).toBe('Hello');
  });

  it('ignores non-JSON lines', () => {
    const chunk = Buffer.from('some internal log\n{"type":"assistant","content":"OK"}\n');
    const messages = adapter.parseChunk(chunk);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('assistant');
  });

  it('extracts result from messages', () => {
    const messages = [
      { type: 'assistant', content: 'I fixed the bug' },
      { type: 'tool_use', tool_name: 'Edit', tool_input: { file_path: 'src/index.ts' } },
      { type: 'assistant', content: 'Done!' },
    ];
    const result = adapter.extractResult(messages as any);
    expect(result.output).toContain('I fixed the bug');
    expect(result.filesModified).toContain('src/index.ts');
  });

  it('processes message and logs transcript', () => {
    const msg = { type: 'assistant', content: 'Hello from worker' };
    adapter.processMessage('w_001', 'goal_001', msg as any);
    const db = getDb();
    const rows = db.prepare('SELECT * FROM transcripts WHERE worker_id = ?').all('w_001');
    expect(rows.length).toBeGreaterThan(0);
  });
});
