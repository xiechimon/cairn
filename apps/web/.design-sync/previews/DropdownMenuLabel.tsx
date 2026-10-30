import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@cairn/web';

export const Choices = () => (
  <div style={{ width: 360, height: 340 }}>
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger render={<Button variant="outline" />}>View options</DropdownMenuTrigger>
      <DropdownMenuContent style={{ width: 240 }}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show columns</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked>Status</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked>Assignee</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={false}>Machine</DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value="updated">
            <DropdownMenuRadioItem value="updated">Last updated</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="created">Created</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="priority">Priority</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);
