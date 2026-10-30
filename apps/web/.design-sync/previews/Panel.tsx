import { Panel, PanelHead, PanelLabel, PanelRow, PanelValue, StatusChip } from '@cairn/web';

const ROW = { padding: '10px 16px' };

const MachinePanel = ({ variant }: { variant?: 'quiet' | 'outlined' }) => (
  <div style={{ width: 300 }}>
    <Panel variant={variant}>
      <PanelHead style={{ padding: '16px 16px 12px', gap: 4 }}>
        <span style={{ fontWeight: 500 }}>omarchy</span>
        <PanelLabel>Linux · daemon 0.42.1</PanelLabel>
      </PanelHead>
      <PanelRow style={ROW}>
        <PanelLabel>Status</PanelLabel>
        <PanelValue>
          <StatusChip tone="done">Online</StatusChip>
        </PanelValue>
      </PanelRow>
      <PanelRow style={ROW}>
        <PanelLabel>Running step</PanelLabel>
        <PanelValue>Task #104 · Implementer</PanelValue>
      </PanelRow>
      <PanelRow style={ROW}>
        <PanelLabel>Last heartbeat</PanelLabel>
        <PanelValue>12s ago</PanelValue>
      </PanelRow>
    </Panel>
  </div>
);

export const Quiet = () => <MachinePanel />;

export const Outlined = () => <MachinePanel variant="outlined" />;
