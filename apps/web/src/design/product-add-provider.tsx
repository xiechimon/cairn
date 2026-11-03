import { PROVIDER_PRESET_DEFAULTS, type ProviderModel } from '@cairn/shared';
import { type ReactNode, useState } from 'react';
import { FORM_CONTROL_CLS, FormField, FormStack } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import {
  DIALOG_FACE,
  DIALOG_HEAD_CLS,
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DIALOG_TITLE_CLS,
} from '../components/ui/dialog-shell.js';
import { Field, FieldDescription, FieldTitle } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft } from '../icons/index.js';
import { ProviderConnectionDisclosure } from '../resources/provider-connection-disclosure.js';
import { ProviderModelChecklist, ProviderModelChips } from '../resources/provider-model-list.js';
import { Section, Specimen } from './specimen.js';

const ANTHROPIC = PROVIDER_PRESET_DEFAULTS.anthropic?.models ?? [];
const HUGGINGFACE = PROVIDER_PRESET_DEFAULTS.huggingface?.models ?? [];
const ANTHROPIC_PICK = [
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
];
const HUGGINGFACE_PICK = HUGGINGFACE.slice(0, 3).map((model) => model.id);

interface Connection {
  providerId: string;
  baseUrl: string;
  api: string;
  bearer: boolean;
}

const ANTHROPIC_CONN: Connection = {
  providerId: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  api: 'Anthropic Messages',
  bearer: false,
};

const HUGGINGFACE_CONN: Connection = {
  providerId: 'huggingface',
  baseUrl: 'https://router.huggingface.co/v1',
  api: 'OpenAI Completions',
  bearer: false,
};

const CUSTOM_CONN: Connection = {
  providerId: '',
  baseUrl: '',
  api: 'OpenAI Completions',
  bearer: true,
};

function DialogFace({ name, children }: { name: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div
      data-mock={name}
      className={`relative flex w-(--dialog-w-l) max-w-full flex-col text-ui text-popover-foreground ${DIALOG_FACE}`}
    >
      <div className={DIALOG_HEAD_CLS}>
        <h3 className={`m-0 ${DIALOG_TITLE_CLS}`}>{t('添加模型服务')}</h3>
      </div>
      <div className="px-5 pt-3 pb-4">{children}</div>
      <div className="flex items-center justify-end gap-2 px-5 pt-0 pb-4">
        <Button variant="ghost" className={DIALOG_TEXT_BUTTON}>
          {t('取消')}
        </Button>
        <Button className={DIALOG_PRIMARY_BUTTON}>{t('添加模型服务')}</Button>
      </div>
    </div>
  );
}

function connectionSummary(conn: Connection, t: (s: string) => string): string {
  if (conn.baseUrl === '') return t('填写 Base URL 和协议');
  const host = new URL(conn.baseUrl).host;
  return [host, conn.api, conn.bearer ? 'Bearer' : t('原生鉴权')].join(' · ');
}

function ConnectionFields({ conn }: { conn: Connection }) {
  const { t } = useI18n();
  return (
    <>
      <FormField label={t('服务商 ID')} htmlFor="">
        <Input
          className={FORM_CONTROL_CLS}
          defaultValue={conn.providerId}
          placeholder={t('例如 my-relay')}
        />
      </FormField>
      <FormField label="Base URL" htmlFor="">
        <Input
          className={FORM_CONTROL_CLS}
          defaultValue={conn.baseUrl}
          placeholder="https://api.example.com/v1"
        />
      </FormField>
      <FormField label={t('API 协议')} htmlFor="">
        <Input className={FORM_CONTROL_CLS} defaultValue={conn.api} readOnly />
      </FormField>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */}
      <label className="inline-flex w-fit items-center gap-2">
        <Checkbox defaultChecked={conn.bearer} />
        <span className="text-ui text-foreground">
          {t('以 Authorization: Bearer 请求头发送 API 密钥')}
        </span>
      </label>
    </>
  );
}

function TopFields({ label, conn, open }: { label: string; conn: Connection; open: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <Button variant="ghost" className="self-start px-0 text-content-secondary">
        <ChevronLeft />
        {t('返回')}
      </Button>
      <FormField label={t('名称')} htmlFor="">
        <Input className={FORM_CONTROL_CLS} defaultValue={label} />
      </FormField>
      <FormField label={t('API 密钥')} htmlFor="" help={t('密钥将加密存储，保存后无法再次查看。')}>
        <Input className={FORM_CONTROL_CLS} type="password" placeholder="sk-..." />
      </FormField>
      <ProviderConnectionDisclosure summary={connectionSummary(conn, t)} defaultOpen={open}>
        <ConnectionFields conn={conn} />
      </ProviderConnectionDisclosure>
    </>
  );
}

function VariantA({
  name,
  label,
  conn,
  catalog,
  pick,
  open = false,
}: {
  name: string;
  label: string;
  conn: Connection;
  catalog: readonly ProviderModel[];
  pick: readonly string[];
  open?: boolean;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(pick));
  const [custom, setCustom] = useState<string[]>([]);
  return (
    <DialogFace name={name}>
      <FormStack className="max-w-none">
        <TopFields label={label} conn={conn} open={open} />
        <Field>
          <FieldTitle className="text-ui font-medium text-foreground">{t('模型')}</FieldTitle>
          {catalog.length > 0 && (
            <FieldDescription className="text-meta text-content-tertiary">
              {t('来自 pi 的模型目录，勾选的会出现在模型选择器里。')}
            </FieldDescription>
          )}
          <ProviderModelChecklist
            catalog={catalog}
            selected={selected}
            onSelectedChange={setSelected}
            custom={custom}
            onCustomChange={setCustom}
          />
        </Field>
      </FormStack>
    </DialogFace>
  );
}

function VariantB({
  name,
  label,
  conn,
  catalog,
  pick,
  open = false,
}: {
  name: string;
  label: string;
  conn: Connection;
  catalog: readonly ProviderModel[];
  pick: readonly string[];
  open?: boolean;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string[]>(() => [...pick]);
  return (
    <DialogFace name={name}>
      <FormStack className="max-w-none">
        <TopFields label={label} conn={conn} open={open} />
        <Field>
          <FieldTitle className="text-ui font-medium text-foreground">{t('模型')}</FieldTitle>
          <ProviderModelChips
            catalog={catalog}
            selected={selected}
            onSelectedChange={setSelected}
          />
          {catalog.length > 0 && (
            <FieldDescription className="text-meta text-content-tertiary">
              {t('目录里还有 {n} 个模型，点「添加模型」搜索。', {
                n:
                  catalog.length - selected.filter((id) => catalog.some((m) => m.id === id)).length,
              })}
            </FieldDescription>
          )}
        </Field>
      </FormStack>
    </DialogFace>
  );
}

export function ProductAddProviderSection() {
  return (
    <Section
      id="product-add-provider"
      title="Add provider (mockups)"
      lede="Two directions for the add-provider form after a preset is picked, borrowed from t3code's provider models section: connection settings fold away behind a summary, and the model list becomes catalog rows instead of free-text inputs."
    >
      <Specimen
        title="A · Catalog checklist"
        note="Anthropic preset · Hugging Face (80 models, filter) · custom endpoint"
        stage="canvas"
        className="items-start"
      >
        <VariantA
          name="A-anthropic"
          label="Anthropic"
          conn={ANTHROPIC_CONN}
          catalog={ANTHROPIC}
          pick={ANTHROPIC_PICK}
        />
        <VariantA
          name="A-huggingface"
          label="Hugging Face"
          conn={HUGGINGFACE_CONN}
          catalog={HUGGINGFACE}
          pick={HUGGINGFACE_PICK}
        />
        <VariantA name="A-custom" label="" conn={CUSTOM_CONN} catalog={[]} pick={[]} open />
      </Specimen>
      <Specimen
        title="B · Picked chips"
        note="Anthropic preset · Hugging Face · custom endpoint"
        stage="canvas"
        className="items-start"
      >
        <VariantB
          name="B-anthropic"
          label="Anthropic"
          conn={ANTHROPIC_CONN}
          catalog={ANTHROPIC}
          pick={ANTHROPIC_PICK}
        />
        <VariantB
          name="B-huggingface"
          label="Hugging Face"
          conn={HUGGINGFACE_CONN}
          catalog={HUGGINGFACE}
          pick={HUGGINGFACE_PICK}
        />
        <VariantB name="B-custom" label="" conn={CUSTOM_CONN} catalog={[]} pick={[]} open />
      </Specimen>
    </Section>
  );
}
