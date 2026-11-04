import { Field, FieldDescription, FieldGroup, FieldLabel, Input } from '@cairn/web';

export const Stacked = () => (
  <div style={{ width: 380 }}>
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="fg-name">Agent name</FieldLabel>
        <Input id="fg-name" defaultValue="Implementer" />
      </Field>
      <Field>
        <FieldLabel htmlFor="fg-model">Model</FieldLabel>
        <Input id="fg-model" defaultValue="claude-opus-4-5" />
        <FieldDescription>Used for planning and code changes on this project.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="fg-machine">Machine</FieldLabel>
        <Input id="fg-machine" defaultValue="omarchy" />
      </Field>
    </FieldGroup>
  </div>
);
