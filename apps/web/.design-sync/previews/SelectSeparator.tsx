import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue } from '@cairn/web';

const agents = [
  { value: 'implementer', label: 'Implementer' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'chief', label: 'Chief' },
];

const OpenMenu = () => (
  <div style={{ width: 280, height: 190 }}>
    <Select defaultValue="implementer" defaultOpen items={agents}>
      <SelectTrigger style={{ width: 220 }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          <SelectLabel>Agents</SelectLabel>
          <SelectItem value="implementer">Implementer</SelectItem>
          <SelectItem value="reviewer">Reviewer</SelectItem>
          <SelectSeparator />
          <SelectItem value="chief">Chief</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

const ClosedTriggers = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Select defaultValue="implementer" items={agents}>
      <SelectTrigger style={{ width: 180 }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {agents.map((a) => (
          <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    <Select defaultValue="reviewer" items={agents}>
      <SelectTrigger size="sm" style={{ width: 140 }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {agents.map((a) => (
          <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

export { OpenMenu };
