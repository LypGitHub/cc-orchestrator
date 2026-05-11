import type { SubTask } from './types.js';

export function mergeSubTaskResults(subTasks: SubTask[]): {
  success: boolean;
  summary: string;
  allFiles: string[];
  errors: string[];
} {
  const completed = subTasks.filter(st => st.status === 'completed');
  const failed = subTasks.filter(st => st.status === 'failed');

  const allFiles = new Set<string>();
  const errors: string[] = [];

  for (const st of subTasks) {
    if (st.result?.filesModified) {
      for (const f of st.result.filesModified) {
        allFiles.add(f);
      }
    }
    if (st.result?.error) {
      errors.push(`[${st.title}] ${st.result.error}`);
    }
  }

  const summary = `## Execution Summary

- **Total Subtasks**: ${subTasks.length}
- **Completed**: ${completed.length}
- **Failed**: ${failed.length}
- **Files Modified**: ${allFiles.size}

${failed.length > 0 ? `\n### Failed Tasks\n${failed.map(st => `- ${st.title}: ${st.result?.error || 'Unknown error'}`).join('\n')}\n` : ''}

${allFiles.size > 0 ? `\n### Modified Files\n${Array.from(allFiles).map(f => `- ${f}`).join('\n')}\n` : ''}
`;

  return {
    success: failed.length === 0,
    summary,
    allFiles: Array.from(allFiles),
    errors,
  };
}
