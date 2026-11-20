import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router';
import { SegmentedTabs } from '../../components/segmented.js';
import { useI18n } from '../../i18n/provider.js';
import { usePanelDocked } from '../use-narrow.js';
import { DesignPane } from './design-pane.js';
import { type DesignTarget, withoutDesignTarget } from './design-route.js';

type DesignFocus = 'chat' | 'design';

const CHAT_BESIDE_DESIGN = 'flex-none w-[clamp(440px,36%,600px)]';

export interface DesignSplit {
  sectionClass: string;
  chatBar: ReactNode;
  pane: ReactNode;
}

function FocusSwitch({
  value,
  onChange,
}: {
  value: DesignFocus;
  onChange: (next: DesignFocus) => void;
}) {
  const { t } = useI18n();
  return (
    <SegmentedTabs
      value={value}
      label={t('对话或设计')}
      onChange={onChange}
      options={[
        { value: 'chat', label: t('对话'), testId: 'design-focus-chat' },
        { value: 'design', label: t('设计'), testId: 'design-focus-design' },
      ]}
    />
  );
}

export function useDesignSplit(target: DesignTarget | null): DesignSplit | null {
  const wide = usePanelDocked();
  const [focus, setFocus] = useState<DesignFocus>('design');
  const [, setSearchParams] = useSearchParams();
  if (target === null) return null;
  const close = () => setSearchParams((prev) => withoutDesignTarget(prev));
  const switcher = wide ? null : <FocusSwitch value={focus} onChange={setFocus} />;
  return {
    sectionClass: wide ? CHAT_BESIDE_DESIGN : focus === 'design' ? 'hidden' : '',
    chatBar: !wide && focus === 'chat' && (
      <div
        data-testid="design-chat-bar"
        className="flex h-12 flex-none items-center border-b border-border px-3"
      >
        {switcher}
      </div>
    ),
    pane: (
      <DesignPane
        key={target.todoId}
        target={target}
        switcher={switcher}
        hidden={!wide && focus === 'chat'}
        onClose={close}
      />
    ),
  };
}
