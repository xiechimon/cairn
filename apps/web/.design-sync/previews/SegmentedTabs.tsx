import { SegmentedTabs } from '@cairn/web';
import { ListIcon, LayoutGridIcon, GanttChartIcon } from 'lucide-react';

const noop = () => {};

export const Labels = () => (
  <SegmentedTabs
    label="Task filter"
    value="running"
    onChange={noop}
    options={[
      { value: 'all', label: 'All' },
      { value: 'running', label: 'Running' },
      { value: 'review', label: 'Needs review' },
      { value: 'merged', label: 'Merged' },
    ]}
  />
);

export const Sliding = () => (
  <SegmentedTabs
    label="Range"
    slide
    value="week"
    onChange={noop}
    options={[
      { value: 'day', label: 'Today' },
      { value: 'week', label: 'This week' },
      { value: 'month', label: 'This month' },
    ]}
  />
);

export const IconsOnly = () => (
  <SegmentedTabs
    label="Board layout"
    value="board"
    onChange={noop}
    options={[
      { value: 'list', icon: <ListIcon />, ariaLabel: 'List' },
      { value: 'board', icon: <LayoutGridIcon />, ariaLabel: 'Board' },
      { value: 'timeline', icon: <GanttChartIcon />, ariaLabel: 'Timeline' },
    ]}
  />
);

export const WithDisabled = () => (
  <SegmentedTabs
    label="Agent"
    value="claude"
    onChange={noop}
    options={[
      { value: 'claude', label: 'Claude Code' },
      { value: 'codex', label: 'Codex' },
      { value: 'pi', label: 'pi', disabled: true },
    ]}
  />
);
