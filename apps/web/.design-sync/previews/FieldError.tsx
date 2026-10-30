import { Field, FieldError, FieldLabel, Input } from '@cairn/web';

export const Single = () => (
  <div style={{ width: 360 }}>
    <Field data-invalid="true">
      <FieldLabel htmlFor="field-branch">Base branch</FieldLabel>
      <Input id="field-branch" aria-invalid="true" defaultValue="mian" />
      <FieldError>Branch mian does not exist on origin.</FieldError>
    </Field>
  </div>
);

export const List = () => (
  <div style={{ width: 360 }}>
    <Field data-invalid="true">
      <FieldLabel htmlFor="field-cron">Schedule</FieldLabel>
      <Input id="field-cron" aria-invalid="true" defaultValue="0 25 * * 8" />
      <FieldError
        errors={[{ message: 'Hour must be between 0 and 23.' }, { message: 'Day of week must be between 0 and 7.' }]}
      />
    </Field>
  </div>
);
