import { Field, FieldContent, FieldDescription, FieldTitle, Switch } from '@cairn/web';

export const InContent = () => (
  <div style={{ width: 400 }}>
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle>Run checks on every push</FieldTitle>
        <FieldDescription>Lint, typecheck and affected e2e run before the Reviewer starts.</FieldDescription>
      </FieldContent>
      <Switch defaultChecked />
    </Field>
  </div>
);
