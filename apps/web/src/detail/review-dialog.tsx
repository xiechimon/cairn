import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { classifyReviewChoice } from './review-default.js';

export interface ReviewAgentOption {
  id: string;
  name: string;
  model: string;
  provider: string | null;
}

interface ReviewDialogProps {
  open?: boolean;
  onClose: () => void;
  agents?: ReviewAgentOption[];
  defaultAgentId?: string;
  producerProvider?: string | null;
  fanoutAvailable?: boolean;
  onStart?: (input: { agentId?: string; focus: string }) => void;
}

const DEFAULT_AGENT: ReviewAgentOption = {
  id: 'r3-builder',
  name: 'r3-builder',
  model: '默认',
  provider: null,
};

export function ReviewDialog({
  open,
  onClose,
  agents,
  defaultAgentId,
  producerProvider,
  fanoutAvailable,
  onStart,
}: ReviewDialogProps) {
  const { t } = useI18n();
  const source = agents ?? [DEFAULT_AGENT];
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>(defaultAgentId ?? source[0]?.id ?? '');
  const [fanout, setFanout] = useState(false);
  const [focus, setFocus] = useState('');
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(defaultAgentId ?? source[0]?.id ?? '');
      setFanout(false);
      setFocus('');
    }
  }, [open, defaultAgentId, source]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? source : source.filter((row) => row.name.toLowerCase().includes(q));
  }, [source, query]);

  const notice = useMemo(() => {
    if (producerProvider === undefined || fanout) return null;
    const row = source.find((candidate) => candidate.id === selected);
    if (row === undefined) return null;
    const verdict = classifyReviewChoice(row, producerProvider);
    return verdict === 'cross-vendor' ? null : verdict;
  }, [producerProvider, source, selected, fanout]);

  const submit = () => {
    if (!fanout && selected === '') return;
    onStart?.({
      ...(fanout ? {} : { agentId: selected }),
      focus: focus.trim(),
    });
    onClose();
  };

  return (
    <DialogShell
      title={t('AI 审核')}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            onClick={submit}
            disabled={!fanout && selected === ''}
          >
            {t(fanout ? '开始三视角审核' : '开始审核')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {fanoutAvailable === true && (
          /* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */
          <label
            className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-(--secondary) px-3 py-2 text-sm text-(--foreground)"
            data-testid="review-fanout-toggle"
          >
            <Checkbox checked={fanout} onCheckedChange={setFanout} />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{t('三视角并行审')}</span>
              <span className="text-xs leading-[1.5] text-(--text-secondary)">
                {t('CodeReviewer · SecurityAuditor · TestEngineer 各审一轮，三份结论并行落会话')}
              </span>
            </span>
          </label>
        )}
        {!fanout && (
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索 Agent…')}
              aria-label={t('搜索 Agent…')}
            />
            <div
              className="flex max-h-50 flex-col gap-1 overflow-y-auto"
              role="listbox"
              aria-label={t('选择审核 Agent')}
            >
              {rows.length === 0 ? (
                <div className="p-4 text-center text-sm text-(--text-tertiary)">
                  {t('没有匹配的 Agent')}
                </div>
              ) : (
                rows.map((row) => {
                  const isSelected = row.id === selected;
                  return (
                    <Button
                      variant="ghost"
                      key={row.id}
                      className="h-auto w-full justify-start gap-3 p-2 text-left font-normal data-[on=true]:bg-(--spot-soft)"
                      data-on={isSelected}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => setSelected(row.id)}
                    >
                      <span
                        className="grid size-9 flex-none place-items-center rounded-full bg-(--secondary) text-sm text-(--text-secondary)"
                        aria-hidden="true"
                      >
                        {row.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm text-(--foreground)">{row.name}</span>
                        <span className="text-xs text-(--text-tertiary)">
                          {row.provider === null ? row.model : `${row.provider} · ${row.model}`}
                        </span>
                      </span>
                    </Button>
                  );
                })
              )}
            </div>
            {notice === null ? null : (
              <div
                className="flex flex-col gap-1 rounded-lg border-l-[3px] border-(--badge-attention) bg-(--secondary) px-3 py-2.5"
                role="status"
              >
                <span className="text-sm font-semibold text-(--foreground)">
                  {notice === 'same-vendor' ? t('本次审核与产出同源') : t('无法判定审核独立性')}
                </span>
                <span className="text-xs leading-[1.5] text-(--text-secondary)">
                  {notice === 'same-vendor'
                    ? t('审核人与产出该方案的 Agent 来自同一模型厂商，不构成独立复核。')
                    : t(
                        '产出该方案的 Agent 或所选审核人未配置模型厂商，缺少比对基准，不构成独立复核。',
                      )}
                </span>
              </div>
            )}
          </>
        )}
        <div className="flex flex-col gap-2">
          <Label className="leading-tight">{t('希望 Agent 审核时重点关注什么？（可选）')}</Label>
          <Textarea
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
            rows={3}
            placeholder={t('希望 Agent 审核时重点关注什么？（可选）')}
          />
        </div>
      </div>
    </DialogShell>
  );
}
