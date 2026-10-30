import { ToolActivityRow } from '@cairn/web';

export const States = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <ToolActivityRow name="read_file" seconds={2} />
    <ToolActivityRow name="run_tests" running seconds={14} />
    <ToolActivityRow name="gh_pr_merge" seconds={5} error />
  </div>
);
