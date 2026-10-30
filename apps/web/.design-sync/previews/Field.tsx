import { Field, FieldDescription, FieldError, FieldLabel, Input } from '@cairn/web';

export const Vertical = () => (
  <div style={{ width: 360 }}>
    <Field>
      <FieldLabel htmlFor="field-project-name">Project name</FieldLabel>
      <Input id="field-project-name" defaultValue="cairn" />
      <FieldDescription>Shown in the sidebar and on every task card.</FieldDescription>
    </Field>
  </div>
);

export const Invalid = () => (
  <div style={{ width: 360 }}>
    <Field data-invalid="true">
      <FieldLabel htmlFor="field-repo">Repository</FieldLabel>
      <Input id="field-repo" aria-invalid="true" defaultValue="xiechimon/cairn.git" />
      <FieldError>Use the owner/name form, without the .git suffix.</FieldError>
    </Field>
  </div>
);
