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
