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

export const Actions = () => (
  <div style={{ width: 360, height: 280 }}>
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Task #104 actions</DropdownMenuTrigger>
      <DropdownMenuContent style={{ width: 240 }}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Task #104</DropdownMenuLabel>
          <DropdownMenuItem>
            Open PR #2156
            <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Retry build
            <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled>Merge (CI pending)</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          Stop task
          <DropdownMenuShortcut>⌘.</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

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

export const Submenu = () => (
  <div style={{ width: 360, height: 200 }}>
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Task #104</DropdownMenuTrigger>
      <DropdownMenuContent style={{ width: 200 }}>
        <DropdownMenuItem>Open in new tab</DropdownMenuItem>
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>Assign to</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Implementer</DropdownMenuItem>
            <DropdownMenuItem>Reviewer</DropdownMenuItem>
            <DropdownMenuItem>Chief</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem>Copy link</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);
