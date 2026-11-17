UPDATE build
SET triggerSource = 'retry'
WHERE triggerSource = 'user'
  AND prevPhase = 'failed'
  AND EXISTS (
    SELECT 1
    FROM build_feedback f
    JOIN build failed ON failed.id = f.buildId
    WHERE failed.todoId = build.todoId
      AND failed.id <> build.id
      AND f.kind = 'restart'
      AND f.actor = 'cairn'
      AND f.feedback = ''
      AND f.createdAt <= build.createdAt
      AND build.createdAt - f.createdAt <= 5000
  )
  AND (
    SELECT s.byPerson
    FROM step s
    WHERE s.buildId = build.id
    ORDER BY s.createdAt, s.rowid
    LIMIT 1
  ) = 0;
