import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@cairn/web';

export const InlineStart = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput defaultValue="cairn.example.dev" />
    </InputGroup>
  </div>
);

export const InlineEnd = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupInput defaultValue="45" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>minutes per step</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  </div>
);

export const BlockEnd = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupInput placeholder="Branch name" defaultValue="feat/dark-mode-toggle" />
      <InputGroupAddon align="block-end">
        <InputGroupText>Lanes branch from origin/main</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  </div>
);
