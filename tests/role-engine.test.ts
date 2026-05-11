import { describe, it, expect } from 'vitest';
import { getRoleConfig, inferRoleFromDescription, buildSystemPrompt, ROLE_TEMPLATES } from '../src/role-engine.js';
import type { RoleType } from '../src/types.js';

describe('Role Engine', () => {
  it('returns correct config for each role', () => {
    const roles: RoleType[] = ['backend-engineer', 'frontend-engineer', 'devops-engineer', 'qa-engineer', 'architect', 'code-reviewer', 'debugger', 'general'];
    for (const role of roles) {
      const config = getRoleConfig(role);
      expect(config.role).toBe(role);
      expect(config.systemPrompt).toBeTruthy();
      expect(config.allowedTools.length).toBeGreaterThan(0);
      expect(config.maxTurns).toBeGreaterThan(0);
    }
  });

  it('falls back to general for unknown role', () => {
    const config = getRoleConfig('unknown-role' as RoleType);
    expect(config.role).toBe('general');
  });

  it('infers frontend role from description', () => {
    expect(inferRoleFromDescription('Build a React component')).toBe('frontend-engineer');
    expect(inferRoleFromDescription('Fix CSS styling')).toBe('frontend-engineer');
  });

  it('infers backend role from description', () => {
    expect(inferRoleFromDescription('Create REST API')).toBe('backend-engineer');
    expect(inferRoleFromDescription('Database migration')).toBe('backend-engineer');
  });

  it('infers devops role from description', () => {
    expect(inferRoleFromDescription('Setup Docker deployment')).toBe('devops-engineer');
  });

  it('builds system prompt with task', () => {
    const prompt = buildSystemPrompt('backend-engineer', 'Create user auth API');
    expect(prompt).toContain('backend engineer');
    expect(prompt).toContain('Create user auth API');
  });

  it('all roles have unique system prompts', () => {
    const prompts = new Set(Object.values(ROLE_TEMPLATES).map(r => r.systemPrompt));
    expect(prompts.size).toBe(Object.keys(ROLE_TEMPLATES).length);
  });
});
