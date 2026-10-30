import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@cairn/web';

export const CopyKey = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupInput readOnly defaultValue="ck_••••••••••••e21c" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton>Copy</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
);

export const Variants = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupInput placeholder="Ask Chief about task #104" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton variant="ghost">Attach</InputGroupButton>
        <InputGroupButton variant="default">Send</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
);
