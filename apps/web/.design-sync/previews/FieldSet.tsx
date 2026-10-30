import { Checkbox, Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@cairn/web';

export const CheckboxSet = () => (
  <div style={{ width: 380 }}>
    <FieldSet>
      <FieldLegend variant="label">Notify me when</FieldLegend>
      <FieldDescription>Applies to every task in the cairn project.</FieldDescription>
      <FieldGroup>
        <Field orientation="horizontal">
          <Checkbox id="set-merged" defaultChecked />
          <FieldLabel htmlFor="set-merged">A PR is merged</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="set-failed" defaultChecked />
          <FieldLabel htmlFor="set-failed">A build fails</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="set-review" />
          <FieldLabel htmlFor="set-review">A task needs review</FieldLabel>
        </Field>
      </FieldGroup>
    </FieldSet>
  </div>
);
