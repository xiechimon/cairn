import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@cairn/web';

export const InTooltip = () => (
  <TooltipProvider>
    <div style={{ paddingTop: 48, display: 'flex', justifyContent: 'center', width: 280 }}>
      <Tooltip open>
        <TooltipTrigger render={<Button variant="outline" />}>Retry build</TooltipTrigger>
        <TooltipContent>Re-run step 3 of task #104 on omarchy</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);
