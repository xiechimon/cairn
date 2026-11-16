UPDATE step
SET status = 'stopped', finishedAt = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE status IN ('pending', 'claimed')
  AND buildId IN (
    SELECT build.id
    FROM build JOIN todo ON todo.id = build.todoId
    WHERE todo.sourceKind IN ('research-intake', 'research-citation-check')
  );
