export interface CommitRowProps {
  sha: string;
  message: string;
  trailer?: string;
}

export function CommitRow({ sha, message, trailer }: CommitRowProps) {
  return (
    <div
      data-slot="commit-row"
      className="flex items-center gap-2.5 border-b border-border py-2 text-ui last:border-b-0"
    >
      <span className="flex-none font-mono text-caption text-(--chip-plan-fg)">{sha}</span>
      <span className="min-w-0 truncate">{message}</span>
      {trailer != null && (
        <span className="ml-auto flex-none font-mono text-caption whitespace-nowrap text-content-tertiary">
          {trailer}
        </span>
      )}
    </div>
  );
}
