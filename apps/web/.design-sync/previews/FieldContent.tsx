import { Field, FieldContent, FieldDescription, FieldLabel, Switch } from '@cairn/web';

export const Horizontal = () => (
  <div style={{ width: 400 }}>
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="field-auto-merge">Auto-merge</FieldLabel>
        <FieldDescription>Merge the PR once review passes and checks are green.</FieldDescription>
      </FieldContent>
      <Switch id="field-auto-merge" defaultChecked />
    </Field>
  </div>
);
