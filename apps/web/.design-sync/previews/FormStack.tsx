import { FormActions, FormField, FormStack, Input } from '@cairn/web';

const noop = () => {};

const SecretForm = () => (
  <div style={{ width: 380 }}>
    <FormStack>
      <FormField label="Name" htmlFor="ds-secret-name" help="Exposed to agents as an environment variable.">
        <Input id="ds-secret-name" defaultValue="GITHUB_TOKEN" />
      </FormField>
      <FormField label="Value" htmlFor="ds-secret-value">
        <Input id="ds-secret-value" type="password" defaultValue="placeholder-value" />
      </FormField>
      <FormActions primary={{ label: 'Create secret' }} secondary={{ label: 'Cancel', onClick: noop }} />
    </FormStack>
  </div>
);

export const CreateSecret = () => <SecretForm />;
