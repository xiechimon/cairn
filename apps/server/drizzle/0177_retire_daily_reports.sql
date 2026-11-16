WITH RECURSIVE prompt_lines(id, line) AS (
  SELECT id, substr(CAST(prompt AS BLOB), instr(CAST(prompt AS BLOB), x'0a') + 1)
  FROM step
  WHERE kind = 'chief'
    AND status IN ('pending', 'claimed')
    AND buildId IN (SELECT 'chief-digest-' || id FROM chief)
    AND instr(CAST(prompt AS BLOB), x'0a') > 0
  UNION ALL
  SELECT id, substr(line, instr(line, x'0a') + 1)
  FROM prompt_lines
  WHERE instr(line, x'0a') > 0
), metadata AS (
  SELECT id, '[' || replace(json_quote(CAST(line AS TEXT)), ' ', '","') || ']' AS fields
  FROM prompt_lines
  WHERE instr(line, x'0a') = 0
    AND instr(line, x'00') = 0
), daily_steps AS (
  SELECT id FROM metadata
  WHERE json_array_length(fields) = 5
    AND json_extract(fields, '$[0]') = 'Digest'
    AND json_extract(fields, '$[1]') GLOB 'thread=?*'
    AND json_extract(fields, '$[2]') GLOB 'until=[0-9]*'
    AND substr(json_extract(fields, '$[2]'), 7) NOT GLOB '*[^0-9]*'
    AND json_extract(fields, '$[3]') GLOB 'last=?*'
    AND json_extract(fields, '$[4]') = 'reason=daily'
    AND (json_extract(fields, '$[1]') || json_extract(fields, '$[3]')) NOT GLOB
      '*[' || char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196,
                   8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279) || ']*'
)
UPDATE step
SET status = 'stopped', finishedAt = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE kind = 'chief'
  AND status IN ('pending', 'claimed')
  AND (
    id IN (SELECT stepId FROM chief_report WHERE stepId IS NOT NULL)
    OR id IN (SELECT id FROM daily_steps)
  );
