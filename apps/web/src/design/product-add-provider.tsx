import type { ProviderPresetDefaults } from '@cairn/shared';
import { useState } from 'react';
import { FORM_CONTROL_CLS, FormField } from '../components/form-layout.js';
import { DIALOG_FACE } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';
import { ProviderConnectionDisclosure } from '../resources/provider-connection-disclosure.js';
import { ProviderModelChips } from '../resources/provider-model-list.js';
import { PROVIDER_PRESET_DEFAULTS } from '../resources/provider-preset-data.js';
import { Section, Specimen } from './specimen.js';

function PresetForm({ defaults, open }: { defaults: ProviderPresetDefaults; open: boolean }) {
  const { t } = useI18n();
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
      <span className="text-meta text-content-tertiary">
        {t('目录里还有 {n} 个模型，点「添加模型」搜索。', {
          n: defaults.models.length - picked.length,
        })}
      </span>
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
    </Section>
  );
}
