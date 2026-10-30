import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText, Kbd } from '@cairn/web';

export const Search = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>Find</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="Search tasks, builds, PRs" />
      <InputGroupAddon align="inline-end">
        <Kbd>⌘K</Kbd>
      </InputGroupAddon>
    </InputGroup>
  </div>
);

export const WithButton = () => (
  <div style={{ width: 320 }}>
    <InputGroup>
      <InputGroupInput defaultValue="github.com/xiechimon/cairn" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton>Link</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
);
