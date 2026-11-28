import { PROVIDER_PRESET_DEFAULTS, type ProviderPresetDefaults } from '@cairn/shared';
import { useState } from 'react';
import { FORM_CONTROL_CLS, FormField } from '../components/form-layout.js';
import { SignInView } from '../components/sign-in-view.js';
import { DIALOG_FACE } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { ProviderConnectionDisclosure } from '../resources/provider-connection-disclosure.js';
import { ProviderModelChips } from '../resources/provider-model-list.js';
import { Section, Specimen } from './specimen.js';

function PresetForm({ defaults, open }: { defaults: ProviderPresetDefaults; open: boolean }) {
  const [expanded, setExpanded] = useState(open);
  const [picked, setPicked] = useState<string[]>(defaults.picks);
  return (
    <div className={`flex w-(--dialog-w-l) max-w-full flex-col gap-4 p-5 ${DIALOG_FACE}`}>
      <ProviderConnectionDisclosure
        open={expanded}
        onOpenChange={setExpanded}
        summary={`${new URL(defaults.baseUrl).host} · ${defaults.api}`}
      >
        <FormField label="Base URL" htmlFor="">
          <Input className={FORM_CONTROL_CLS} defaultValue={defaults.baseUrl} />
        </FormField>
      </ProviderConnectionDisclosure>
      <ProviderModelChips
        catalog={defaults.models}
        selected={picked}
        onSelectedChange={setPicked}
      />
    </div>
  );
}

export function ProductAddProviderSection() {
  const anthropic = PROVIDER_PRESET_DEFAULTS.anthropic;
  const openrouter = PROVIDER_PRESET_DEFAULTS.openrouter;
  return (
    <Section
      id="product-add-provider"
      title="Add provider"
      lede="The add-provider form after a preset is picked: connection settings fold behind a one-line summary, and models are chips picked from pi's catalog, searched in a popover, or typed as a custom id."
    >
      <Specimen
        id="connection-disclosure-and-model-chips"
        title="Connection disclosure and model chips"
        note="Anthropic preset (newest per family picked) · OpenRouter (386 models, none picked, search to add)"
        stage="canvas"
        className="items-start"
      >
        {anthropic !== undefined && <PresetForm defaults={anthropic} open={false} />}
        {openrouter !== undefined && <PresetForm defaults={openrouter} open />}
      </Specimen>
      <Specimen
        id="sign-in-view"
        title="Subscription sign-in view"
        note="One view for every subscription sign-in: getting a code · waiting with the code · expired code with its sentence"
        stage="canvas"
        className="items-start"
      >
        {SIGN_IN_STATES.map((state) => (
          <div
            key={state.id}
            className={`flex w-(--dialog-w-m) max-w-full flex-col gap-4 p-5 ${DIALOG_FACE}`}
          >
            <SignInView
              instruction="Open the sign-in page and enter this code."
              code={state.code}
              waiting={state.waiting}
              failure={state.failure}
              onCancel={() => {}}
            />
          </div>
        ))}
      </Specimen>
    </Section>
  );
}

const SIGN_IN_STATES = [
  { id: 'loading', code: 'loading', waiting: null, failure: null },
  {
    id: 'waiting',
    code: { value: 'WXYZ-0001' },
    waiting: 'Waiting for you to finish in the browser…',
    failure: null,
  },
  {
    id: 'expired',
    code: { value: 'WXYZ-0001', expired: true },
    waiting: null,
    failure: 'The code expired. Start over for a new one.',
  },
] as const;
