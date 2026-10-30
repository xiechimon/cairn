import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@cairn/web';

export const Filled = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>#</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput defaultValue="104" />
    </InputGroup>
  </div>
);

export const Placeholder = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupInput placeholder="Filter by agent, e.g. Implementer" />
    </InputGroup>
  </div>
);

export const Invalid = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupInput aria-invalid defaultValue="0 */6 * *" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>cron</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  </div>
);
