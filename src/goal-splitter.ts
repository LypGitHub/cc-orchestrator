import { randomUUID } from 'crypto';
import type { Goal, SubTask, RoleType } from './types.js';
import { inferRoleFromDescription } from './role-engine.js';

interface SplitTemplate {
  keywords: string[];
  role: RoleType;
  title: string;
  description: string;
}

const TEMPLATES: SplitTemplate[] = [
  {
    keywords: ['api', 'endpoint', 'rest', 'graphql', 'route', 'controller'],
    role: 'backend-engineer',
    title: 'Implement API endpoints',
    description: 'Design and implement the API endpoints with proper request/response handling, validation, and error handling.',
  },
  {
    keywords: ['database', 'schema', 'migration', 'table', 'model', 'entity'],
    role: 'backend-engineer',
    title: 'Design database schema',
    description: 'Create the database schema, migrations, and data models with proper indexes and constraints.',
  },
  {
    keywords: ['auth', 'login', 'register', 'jwt', 'oauth', 'permission'],
    role: 'backend-engineer',
    title: 'Implement authentication',
    description: 'Implement user authentication and authorization with secure token management and session handling.',
  },
  {
    keywords: ['test', 'unit test', 'integration test', 'e2e', 'spec'],
    role: 'qa-engineer',
    title: 'Write tests',
    description: 'Write comprehensive tests covering happy paths, edge cases, and error scenarios.',
  },
  {
    keywords: ['ui', 'component', 'page', 'react', 'vue', 'frontend', 'css', 'style'],
    role: 'frontend-engineer',
    title: 'Implement UI components',
    description: 'Build the user interface components with proper state management, accessibility, and responsive design.',
  },
  {
    keywords: ['deploy', 'docker', 'kubernetes', 'ci/cd', 'pipeline', 'config'],
    role: 'devops-engineer',
    title: 'Setup deployment',
    description: 'Configure deployment infrastructure, CI/CD pipelines, and environment setup.',
  },
  {
    keywords: ['refactor', 'clean up', 'improve', 'optimize', 'architecture'],
    role: 'architect',
    title: 'Refactor and optimize',
    description: 'Refactor the codebase for better maintainability, performance, and architecture.',
  },
  {
    keywords: ['fix', 'bug', 'debug', 'error', 'issue', 'crash'],
    role: 'debugger',
    title: 'Fix bugs',
    description: 'Identify, reproduce, and fix the reported bugs with minimal changes and regression tests.',
  },
  {
    keywords: ['review', 'audit', 'security', 'vulnerability'],
    role: 'code-reviewer',
    title: 'Code review and security audit',
    description: 'Perform thorough code review focusing on bugs, security issues, and best practices.',
  },
];

export class GoalSplitter {
  async split(goal: Goal): Promise<SubTask[]> {
    const ruleBased = this.ruleBasedSplit(goal);
    if (ruleBased.length > 1) {
      return this.addDependencyGraph(ruleBased);
    }

    const role = inferRoleFromDescription(goal.description);
    return [this.createSubTask(goal, role, 'Implement', goal.description, [])];
  }

  private ruleBasedSplit(goal: Goal): SubTask[] {
    const desc = goal.description.toLowerCase();
    const matched: SubTask[] = [];
    const usedKeywords = new Set<string>();

    for (const template of TEMPLATES) {
      const matchedKeywords = template.keywords.filter(kw => {
        if (usedKeywords.has(kw)) return false;
        return desc.includes(kw);
      });

      if (matchedKeywords.length > 0) {
        for (const kw of matchedKeywords) usedKeywords.add(kw);
        matched.push(this.createSubTask(goal, template.role, template.title, template.description, []));
      }
    }

    return matched;
  }

  private createSubTask(goal: Goal, role: RoleType, title: string, description: string, dependencies: string[]): SubTask {
    return {
      id: `st_${randomUUID().slice(0, 8)}`,
      goalId: goal.id,
      title: `${title} for ${goal.description.slice(0, 40)}`,
      description: `${description}\n\nContext: ${goal.description}`,
      role,
      dependencies,
      estimatedEffort: 5,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private addDependencyGraph(subTasks: SubTask[]): SubTask[] {
    const implementationTasks = subTasks.filter(st =>
      st.role !== 'architect' && st.role !== 'code-reviewer'
    );

    for (const st of subTasks) {
      if (st.role === 'architect' || st.role === 'code-reviewer') {
        st.dependencies = implementationTasks.map(t => t.id);
      }
      if (st.role === 'qa-engineer') {
        const implIds = subTasks
          .filter(t => t.role === 'backend-engineer' || t.role === 'frontend-engineer')
          .map(t => t.id);
        st.dependencies = implIds;
      }
    }

    return subTasks;
  }
}
