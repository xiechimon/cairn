import { Button, Field, FieldGroup, FieldLabel, FieldSeparator, Input } from '@cairn/web';

export const WithText = () => (
  <div style={{ width: 360 }}>
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="fs-repo">Clone from GitHub</FieldLabel>
        <Input id="fs-repo" defaultValue="xiechimon/cairn" />
      </Field>
      <FieldSeparator>or</FieldSeparator>
      <Field>
        <Button variant="outline">Open a local folder</Button>
      </Field>
    </FieldGroup>
  </div>
);

export const Plain = () => (
  <div style={{ width: 360 }}>
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="fs-a">Display name</FieldLabel>
        <Input id="fs-a" defaultValue="Reviewer" />
      </Field>
      <FieldSeparator />
      <Field>
        <FieldLabel htmlFor="fs-b">Max parallel builds</FieldLabel>
        <Input id="fs-b" defaultValue="3" />
      </Field>
    </FieldGroup>
  </div>
);
