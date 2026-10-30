import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from '@cairn/web';

export const Composer = () => (
  <div style={{ width: 380 }}>
    <InputGroup>
      <InputGroupTextarea
        rows={3}
        defaultValue="Add a dark mode toggle to the settings page, run the web e2e suite, then open a PR."
      />
      <InputGroupAddon align="block-end">
        <InputGroupText>Implementer · cairn</InputGroupText>
        <InputGroupButton variant="default" style={{ marginLeft: 'auto' }}>
          Create task
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
);
