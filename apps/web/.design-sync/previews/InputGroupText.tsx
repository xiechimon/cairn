import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@cairn/web';

export const PrefixAndSuffix = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>xiechimon/</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput defaultValue="cairn" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>main</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  </div>
);
