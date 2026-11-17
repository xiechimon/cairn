UPDATE todo
SET archivedAt = phaseAt
WHERE phase = 'closed'
  AND archivedAt IS NULL;
