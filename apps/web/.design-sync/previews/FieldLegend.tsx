import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet, Input } from '@cairn/web';

export const Legend = () => (
  <div style={{ width: 380 }}>
    <FieldSet>
      <FieldLegend>Git remote</FieldLegend>
      <FieldDescription>Where the Implementer pushes branches and opens PRs.</FieldDescription>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="lg-remote">Remote</FieldLabel>
          <Input id="lg-remote" defaultValue="origin" />
        </Field>
      </FieldGroup>
    </FieldSet>
  </div>
);

export const LabelVariant = () => (
  <div style={{ width: 380 }}>
    <FieldSet>
      <FieldLegend variant="label">Notifications</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="lg-email">Email</FieldLabel>
          <Input id="lg-email" defaultValue="builds@cairn.dev" />
        </Field>
      </FieldGroup>
    </FieldSet>
  </div>
);
