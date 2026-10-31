import { SegmentedTabs } from '../components/segmented.js';
import type { PaneView } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export type DocTypeLabel = '方案' | '变更';

type TabLabel = DocTypeLabel | '分支' | '用量' | '历史';

const SECTION_TABS: Array<{ view: PaneView; label: TabLabel }> = [
  { view: 'branch', label: '分支' },
  { view: 'token', label: '用量' },
  { view: 'history', label: '历史' },
];

export function PaneTabs({
  view,
  docLabel,
  sections,
  onView,
}: {
  view: PaneView;
  docLabel: DocTypeLabel;
  sections?: boolean;
  onView: (view: PaneView) => void;
}) {
  const { t } = useI18n();
  const tabs = [
    { view: 'doc' as PaneView, label: docLabel as TabLabel },
    ...(sections ? SECTION_TABS : []),
  ];
  return (
    <SegmentedTabs
      value={view}
      label={t('面板视图')}
      className="doc-pane-tabs"
      options={tabs.map((tab) => ({
        value: tab.view,
        label: t(tab.label),
        testId: `pane-tab-${tab.view}`,
      }))}
      onChange={onView}
    />
  );
}
