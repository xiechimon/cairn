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
