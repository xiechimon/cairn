import type { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from 'cn';
import { Switch } from './ui/switch.js';

const TOGGLE_SWITCH_CLS =
  'h-5 w-9 border-0 px-0.5 data-[size=default]:h-5 data-[size=default]:w-9 data-checked:bg-(--switch-on) data-unchecked:bg-(--switch-off) dark:data-unchecked:bg-(--switch-off) data-disabled:data-checked:bg-(--switch-off) [&>[data-slot=switch-thumb]]:size-4 [&>[data-slot=switch-thumb]]:bg-(--switch-thumb)! [&>[data-slot=switch-thumb]]:shadow-sm [&>[data-slot=switch-thumb]]:duration-(--dur-overlay) [&>[data-slot=switch-thumb]]:ease-(--ease-out-strong) motion-reduce:[&>[data-slot=switch-thumb]]:transition-none [&>[data-slot=switch-thumb][data-checked]]:translate-x-full! [&>[data-slot=switch-thumb][data-checked]]:bg-(--switch-thumb-on)!';

export function ToggleSwitch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return <Switch className={cn(TOGGLE_SWITCH_CLS, className)} {...props} />;
}
