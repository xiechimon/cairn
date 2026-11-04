import { Checkbox, Field, FieldLabel, Input } from '@cairn/web';

export const WithInput = () => (
  <div style={{ width: 340 }}>
    <Field>
      <FieldLabel htmlFor="fl-title">Task title</FieldLabel>
      <Input id="fl-title" defaultValue="Task #104: dark mode toggle" />
    </Field>
  </div>
);

export const WithCheckbox = () => (
  <div style={{ width: 340 }}>
    <Field orientation="horizontal">
      <Checkbox id="fl-review" defaultChecked />
      <FieldLabel htmlFor="fl-review">Require review before merge</FieldLabel>
    </Field>
  </div>
);
