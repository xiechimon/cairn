import { Kbd, KbdGroup } from '@cairn/web';

export const Shortcuts = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', width: 260 }}>
      <span>Command palette</span>
      <KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', width: 260 }}>
      <span>Send to Chief</span>
      <KbdGroup><Kbd>⌘</Kbd><Kbd>Enter</Kbd></KbdGroup>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', width: 260 }}>
      <span>Stop task</span>
      <KbdGroup><Kbd>⇧</Kbd><Kbd>⌘</Kbd><Kbd>.</Kbd></KbdGroup>
    </div>
  </div>
);
