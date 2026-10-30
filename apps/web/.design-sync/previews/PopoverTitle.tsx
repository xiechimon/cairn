import { Button, Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@cairn/web';

export const Open = () => (
  <div style={{ height: 200 }}>
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline">Task #104</Button>} />
      <PopoverContent align="start" initialFocus={false}>
        <PopoverHeader>
          <PopoverTitle>Task #104 is waiting on review</PopoverTitle>
          <PopoverDescription>
            The Implementer opened PR #2156. The Reviewer starts once checks are green.
          </PopoverDescription>
        </PopoverHeader>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm">Dismiss</Button>
          <Button size="sm">Open PR</Button>
        </div>
      </PopoverContent>
    </Popover>
  </div>
);
