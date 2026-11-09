SELECT
    trace_id,
    name,
    type,
    length(input) AS input_bytes,
    length(output) AS output_bytes,
    start_time
FROM events_core FINAL
WHERE trace_id IN (
    SELECT trace_id
    FROM events_core FINAL
    WHERE session_id = {sessionId:String}
)
AND type IN ('AGENT', 'GENERATION')
AND input != ''
AND output != ''
ORDER BY start_time DESC
LIMIT 5
FORMAT JSONEachRow
