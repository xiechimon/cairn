import { Kbd } from '@cairn/web';

export const Keys = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Kbd>⌘</Kbd>
    <Kbd>K</Kbd>
    <Kbd>Esc</Kbd>
    <Kbd>Enter</Kbd>
    <Kbd>⇧</Kbd>
  </div>
);

export const InText = () => (
  <p style={{ fontSize: 14 }}>
    Press <Kbd>N</Kbd> to create a task, <Kbd>/</Kbd> to search builds.
  </p>
);
