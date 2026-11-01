import { Check, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
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

const SEARCH_THRESHOLD = 6;

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

  const rowBase =
    'h-auto w-full justify-start gap-3 rounded-(--radius-menu-item) px-3 py-2 text-left font-normal whitespace-normal hover:bg-(--menu-hover) data-[on=true]:bg-(--menu-hover) dark:hover:bg-(--menu-hover)';

  return (
    <DialogShell
      title={t('AI 审核')}
      subtitle={t('选择谁来审这份方案')}
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
        {source.length > SEARCH_THRESHOLD && (
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('搜索 Agent…')}
            aria-label={t('搜索 Agent…')}
          />
        )}
        <div
          className="-mx-2 flex max-h-72 flex-col gap-px overflow-y-auto"
          role="listbox"
          aria-label={t('选择审核 Agent')}
        >
          {rows.length === 0 ? (
            <div className="p-4 text-center text-meta text-(--text-tertiary)">
              {t('没有匹配的 Agent')}
            </div>
          ) : (
            rows.map((row) => {
              const isSelected = !fanout && row.id === selected;
              const independence =
                producerProvider === undefined ? null : classifyReviewChoice(row, producerProvider);
              return (
                <Button
                  variant="ghost"
                  key={row.id}
                  className={rowBase}
                  data-on={isSelected}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    setFanout(false);
                    setSelected(row.id);
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5 text-ui font-medium text-(--foreground)">
                      {row.name}
                      {independence === 'cross-vendor' && (
                        <span className="rounded-full bg-(--chip-confirm-bg) px-1.5 text-caption font-medium text-(--chip-confirm-fg)">
                          {t('其他厂商')}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-meta text-(--text-tertiary)">
                      {row.provider === null ? row.model : `${row.provider} · ${row.model}`}
                      {independence === 'same-vendor' && ` · ${t('与方案作者同厂商')}`}
                    </span>
                  </span>
                  {isSelected && <Check aria-hidden="true" className="size-4 flex-none" />}
                </Button>
              );
            })
          )}
          {fanoutAvailable === true && (
            <>
              <div aria-hidden="true" className="mx-3 my-1 h-px bg-(--border)" />
              <Button
                variant="ghost"
                className={rowBase}
                data-on={fanout}
                data-testid="review-fanout-toggle"
                role="option"
                aria-selected={fanout}
                onClick={() => setFanout(true)}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-ui font-medium text-(--foreground)">
                    {t('三视角并行审')}
                  </span>
                  <span className="text-meta text-(--text-tertiary)">
                    {t(
                      'CodeReviewer · SecurityAuditor · TestEngineer 各审一轮，三份结论并行落会话',
                    )}
                  </span>
                </span>
                {fanout && <Check aria-hidden="true" className="size-4 flex-none" />}
              </Button>
            </>
          )}
        </div>
        {notice !== null && (
          <p
            className="m-0 flex items-start gap-1.5 text-meta text-(--text-secondary)"
            role="status"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 flex-none text-(--badge-attention)"
            />
            {notice === 'same-vendor'
              ? t('审核人与产出该方案的 Agent 来自同一模型厂商，不构成独立复核。')
              : t('产出该方案的 Agent 或所选审核人未配置模型厂商，缺少比对基准，不构成独立复核。')}
          </p>
        )}
        <Textarea
          value={focus}
          onChange={(event) => setFocus(event.target.value)}
          rows={2}
          aria-label={t('希望 Agent 审核时重点关注什么？（可选）')}
          placeholder={t('重点关注什么？例如：并发、错误处理、测试覆盖（可选）')}
        />
      </div>
    </DialogShell>
  );
}
