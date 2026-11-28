const STEP_FENCE_TRIGGER = 'step_require_writer_generation_update';

export function registerWriterGeneration(db) {
  const marker = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?")
    .get(STEP_FENCE_TRIGGER);
  if (marker) db.function('cairn_step_write_generation', { deterministic: true }, () => 1);
}
