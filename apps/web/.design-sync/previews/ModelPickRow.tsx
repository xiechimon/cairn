import { ModelPickList, ModelPickRow } from '@cairn/web';

const popoverSkin = {
  row: 'h-auto gap-2 px-3 py-1.5',
  col: 'flex min-w-0 flex-auto flex-col',
  name: 'truncate text-[13px] text-(--foreground)',
  provider: 'text-[11px] text-(--text-tertiary)',
  check: 'inline-flex flex-none text-(--text-tertiary)',
};

const inlineSkin = {
  row: 'h-8 gap-2 px-3 text-xs leading-4 text-(--foreground)',
  name: 'min-w-0 flex-auto truncate',
  provider: 'flex-none text-(--text-tertiary)',
  check: 'inline-flex flex-none text-(--text-tertiary)',
};

const options = [
  { provider: 'claude-code', providerLabel: 'Claude Code', modelId: 'claude-opus-5-5', modelName: 'Claude Opus 5.5', liveness: 'alive' as const },
  { provider: 'claude-code', providerLabel: 'Claude Code', modelId: 'claude-sonnet-5', modelName: 'Claude Sonnet 5', liveness: 'alive' as const },
  { provider: 'codex', providerLabel: 'Codex', modelId: 'gpt-5.5', modelName: 'GPT-5.5', liveness: 'alive' as const },
  { provider: 'gemini', providerLabel: 'Gemini CLI', modelId: 'gemini-3-pro', modelName: 'Gemini 3 Pro', liveness: 'dead' as const },
];

const frame = {
  width: 300,
  padding: '4px 0',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--popover)',
} as const;

const PickerPopover = () => (
  <div style={frame}>
    <ModelPickList
      skin={popoverSkin}
      options={options}
      value={{ provider: 'claude-code', modelId: 'claude-opus-5-5' }}
      defaultLabel="Agent default"
      listLabel="Model"
      delistedTemplate="{name} (delisted)"
      searchPlaceholder="Search models"
      emptyLabel="No matching models"
      onPick={() => {}}
    />
  </div>
);

const PickerInline = () => (
  <div style={frame}>
    <ModelPickList
      skin={inlineSkin}
      options={options}
      value={null}
      defaultLabel="Agent default"
      listLabel="Model"
      delistedTemplate="{name} (delisted)"
      onPick={() => {}}
    />
  </div>
);

const RowStates = () => (
  <div style={frame}>
    <ModelPickRow skin={popoverSkin} selected label="Claude Opus 5.5" providerLabel="Claude Code" onPick={() => {}} />
    <ModelPickRow skin={popoverSkin} selected={false} label="GPT-5.5" providerLabel="Codex" onPick={() => {}} />
    <ModelPickRow skin={popoverSkin} selected={false} disabled label="Gemini 3 Pro (delisted)" providerLabel="Gemini CLI" onPick={() => {}} />
  </div>
);

export { RowStates };
