import { Field, FieldDescription, FieldLabel, Textarea } from '@cairn/web';

export const UnderTextarea = () => (
  <div style={{ width: 380 }}>
    <Field>
      <FieldLabel htmlFor="field-task-brief">Task brief</FieldLabel>
      <Textarea id="field-task-brief" defaultValue="Add a dark mode toggle to the settings page and open a PR." />
      <FieldDescription>The Implementer reads this before planning. Keep it to the outcome you want.</FieldDescription>
    </Field>
  </div>
);
