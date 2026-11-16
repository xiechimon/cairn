import {
  isBrowserLoopbackOrigin,
  normalizeBrowserSecretOrigin,
  type SetSecretBody,
} from '@cairn/shared';
import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { Switch } from '../components/ui/switch.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { FORM_TEXTAREA_CLS } from './parts.js';

interface CreateSecretDialogProps {
  open?: boolean;
  onClose: () => void;
  onCreate?: (input: SetSecretBody) => void;
  browserMachineName?: string;
  projects?: readonly { id: string; name: string }[];
  defaultProjectId?: string | null;
}

export function CreateSecretDialog({
  open,
  onClose,
  onCreate,
  projects = [],
  defaultProjectId = null,
  browserMachineName,
}: CreateSecretDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState(defaultProjectId ?? '');
  const [browserOnly, setBrowserOnly] = useState(false);
  const [origin, setOrigin] = useState('');
  const normalizedOrigin = normalizeBrowserSecretOrigin(origin.trim());
  const loopback = normalizedOrigin !== null && isBrowserLoopbackOrigin(normalizedOrigin);
  const browserInvalid =
    browserOnly && (normalizedOrigin === null || (loopback && !browserMachineName));
  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === '' || value === '' || browserInvalid) return;
    if (onCreate != null) {
      onCreate({
        name: trimmed,
        description: description.trim() || undefined,
        value,
        ...(browserOnly && normalizedOrigin !== null
          ? { delivery: 'browser', browserOrigin: normalizedOrigin }
          : scope !== ''
            ? { projectId: scope }
            : {}),
      });
    } else {
      onClose();
    }
    setName('');
    setDescription('');
    setValue('');
  };
  return (
    <DialogShell
      title={t('添加密钥')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: t('添加密钥'),
            onClick: submit,
            disabled: name.trim() === '' || value === '' || browserInvalid,
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        <FormField label={t('名称（环境变量名）')} htmlFor="dlg-secret-name">
          <Input
            id="dlg-secret-name"
            className={FORM_CONTROL_CLS}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="STRIPE_API_KEY"
          />
        </FormField>
        <FormField
          label={t('只给浏览器')}
          htmlFor="dlg-secret-browser"
          help={t('团队成员的 Coordinator 可在指定网站代填，不会读到密码。')}
        >
          <Switch id="dlg-secret-browser" checked={browserOnly} onCheckedChange={setBrowserOnly} />
        </FormField>
        {browserOnly && (
          <FormField
            label={t('允许登录的网站')}
            htmlFor="dlg-secret-origin"
            help={
              normalizedOrigin === null
                ? t('填写完整来源地址，不带路径；HTTP 仅限本机回环地址。')
                : loopback
                  ? browserMachineName
                    ? t('绑定到 {name}', { name: browserMachineName })
                    : t('先打开 Coordinator 的浏览器，再保存本机网站的密码。')
                  : t('仅限 {origin}；不要绑定共享托管或允许用户发布内容的网站。', {
                      origin: normalizedOrigin,
                    })
            }
          >
            <Input
              id="dlg-secret-origin"
              className={FORM_CONTROL_CLS}
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              placeholder="https://example.com"
              autoComplete="off"
              aria-invalid={origin !== '' && browserInvalid}
            />
          </FormField>
        )}
        {!browserOnly && projects.length > 0 && (
          <FormField
            label={t('范围')}
            htmlFor="dlg-secret-scope"
            help={t('项目密钥只发给该项目的对话，同名时优先于团队密钥。')}
          >
            <Select
              items={[
                { value: '', label: t('全团队') },
                ...projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
              value={scope}
              onValueChange={(next) => setScope(next ?? '')}
            >
              <SelectTrigger
                id="dlg-secret-scope"
                data-testid="secret-scope"
                className={FORM_CONTROL_CLS}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="">{t('全团队')}</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormField>
        )}
        <FormField label={t('描述（可选）')} htmlFor="dlg-secret-desc">
          <Input
            id="dlg-secret-desc"
            className={FORM_CONTROL_CLS}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('该密钥的用途')}
          />
        </FormField>
        <FormField
          label={t('值')}
          htmlFor="dlg-secret-value"
          help={t('值将加密存储，保存后无法再次查看。')}
        >
          {browserOnly ? (
            <Input
              id="dlg-secret-value"
              type="password"
              autoComplete="new-password"
              className={FORM_CONTROL_CLS}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : (
            <Textarea
              id="dlg-secret-value"
              className={FORM_TEXTAREA_CLS}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t('粘贴密钥的值')}
            />
          )}
        </FormField>
      </FormStack>
    </DialogShell>
  );
}
