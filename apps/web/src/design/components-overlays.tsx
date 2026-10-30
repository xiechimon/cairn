import { useId, useState } from 'react';
import { toast } from 'sonner';
import { FORM_CONTROL_CLS, FormField, FormStack } from '../components/form-layout.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
  type DialogSize,
} from '../components/ui/dialog-shell.js';
import {
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
} from '../components/ui/dropdown-menu.js';
import { Input } from '../components/ui/input.js';
import { Kbd } from '../components/ui/kbd.js';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '../components/ui/popover.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import {
  ChevronDown,
  Copy,
  EllipsisVertical,
  ExternalLink,
  Folder,
  SquarePen,
  Trash2,
} from '../icons/index.js';
import { Cell, Section, Specimen } from './specimen.js';

const DIALOG_COPY: Record<DialogSize, { title: string; use: string }> = {
  s: { title: 'Rename key', use: 'Keys, confirmations, short forms' },
  m: { title: 'New schedule', use: 'Most new-entity forms' },
  l: { title: 'Add machine', use: 'Multi-step flows and long lists' },
};

export function MenuSection() {
  const [sort, setSort] = useState('updated');
  const [showDone, setShowDone] = useState(true);
  const [last, setLast] = useState<string | null>(null);
  return (
    <Section
      id="menu"
      title="Menu"
      lede="One Paper surface for dropdowns, selects and popovers. Rows are 32px with concentric corners; shortcuts sit on the right; danger rows go red."
    >
      <Specimen
        title="Dropdown menu"
        note={last == null ? 'Open it with a click or the keyboard' : `Last picked: ${last}`}
        stage="canvas"
        code={`<DropdownMenu>\n  <DropdownMenuTrigger render={<Button variant="outline" />}>Actions</DropdownMenuTrigger>\n  <DropdownMenuContent>\n    <DropdownMenuItem>Edit<DropdownMenuShortcut>E</DropdownMenuShortcut></DropdownMenuItem>\n    <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>\n  </DropdownMenuContent>\n</DropdownMenu>`}
      >
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            Task actions
            <ChevronDown data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setLast('Edit')}>
                <SquarePen />
                Edit
                <DropdownMenuShortcut>E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLast('Duplicate')}>
                <Copy />
                Duplicate
                <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Folder />
                  Move to project
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {['cairn', 'web', 'scripts'].map((p) => (
                    <DropdownMenuItem key={p} onClick={() => setLast(`Move to ${p}`)}>
                      {p}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => setLast('Open in GitHub')}>
                <ExternalLink />
                Open in GitHub
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setLast('Delete')}>
              <Trash2 />
              Delete
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" />}>
            View options
            <ChevronDown data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(String(v))}>
                <DropdownMenuRadioItem value="updated">Last updated</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="created">Created</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="title">Title</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={showDone} onCheckedChange={setShowDone}>
              Show done tasks
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More" />}>
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setLast('Copy link')}>Copy link</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLast('Archive')}>Archive</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Specimen>
      <Specimen title="Popover" note="For a small panel anchored to its trigger" stage="canvas">
        <Popover>
          <PopoverTrigger render={<Button variant="outline" />}>Machine status</PopoverTrigger>
          <PopoverContent className="w-72">
            <PopoverHeader>
              <PopoverTitle>omarchy</PopoverTitle>
              <PopoverDescription>Online · 2 tasks running · last seen just now</PopoverDescription>
            </PopoverHeader>
            <div className="mt-3 flex items-center gap-2 text-meta text-content-tertiary">
              <span className="size-2 rounded-full bg-running" />
              Heartbeat every 15s
            </div>
          </PopoverContent>
        </Popover>
      </Specimen>
    </Section>
  );
}

export function DialogSection() {
  const [open, setOpen] = useState<DialogSize | null>(null);
  const [confirm, setConfirm] = useState(false);
  const nameId = useId();
  const close = () => setOpen(null);
  return (
    <Section
      id="dialog"
      title="Dialog"
      lede="Three widths on a light dim backdrop, a 16px title, one scrolling body and a split footer: hint on the left, actions on the right."
    >
      <Specimen
        title="Sizes"
        code={`<DialogShell open={open} onClose={close} size="m" title="New schedule"\n  hint="Runs in your time zone"\n  footer={<><Button variant="ghost" className={DIALOG_TEXT_BUTTON}>Cancel</Button><Button className={DIALOG_PRIMARY_BUTTON}>Create</Button></>}>\n  …\n</DialogShell>`}
      >
        {(['s', 'm', 'l'] as const).map((size) => (
          <Cell key={size} label={`${size.toUpperCase()} · ${DIALOG_COPY[size].use}`}>
            <Button variant="outline" onClick={() => setOpen(size)}>
              Open {size.toUpperCase()}
            </Button>
          </Cell>
        ))}
      </Specimen>
      <Specimen
        title="Confirm"
        note="Destructive actions confirm first; never delete directly"
        code={`<AlertDialogShell open={open} onClose={close} title="Delete this task?" ariaLabel="Delete task"\n  footer={<AlertDialogActions cancelLabel="Cancel" confirmLabel="Delete" onCancel={close} onConfirm={…} />}>…</AlertDialogShell>`}
      >
        <Button variant="destructive" onClick={() => setConfirm(true)}>
          <Trash2 data-icon="inline-start" />
          Delete task
        </Button>
      </Specimen>
      {open != null && (
        <DialogShell
          open
          onClose={close}
          size={open}
          title={DIALOG_COPY[open].title}
          subtitle={open === 'l' ? 'Step 1 of 3 · Name the machine' : undefined}
          hint={
            <>
              Press <Kbd>Esc</Kbd> to close
            </>
          }
          footer={
            <>
              <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={close}>
                Cancel
              </Button>
              <Button
                className={DIALOG_PRIMARY_BUTTON}
                onClick={() => {
                  close();
                  toastSuccess(`${DIALOG_COPY[open].title} saved`);
                }}
              >
                {open === 'l' ? 'Continue' : 'Save'}
              </Button>
            </>
          }
        >
          <FormStack>
            <FormField label="Name" htmlFor={nameId} help="You can change this later.">
              <Input id={nameId} className={FORM_CONTROL_CLS} defaultValue="omarchy" />
            </FormField>
          </FormStack>
        </DialogShell>
      )}
      <AlertDialogShell
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this task?"
        ariaLabel="Delete task"
        size="s"
        footer={
          <AlertDialogActions
            cancelLabel="Cancel"
            confirmLabel="Delete"
            onCancel={() => setConfirm(false)}
            onConfirm={() => {
              setConfirm(false);
              toast('Task deleted', {
                action: { label: 'Undo', onClick: () => toastSuccess('Task restored') },
              });
            }}
          />
        }
      >
        <p className="m-0 text-ui text-content-secondary">
          The branch and its pull request stay on GitHub. The conversation and plan are removed.
        </p>
      </AlertDialogShell>
    </Section>
  );
}

export function ToastSection() {
  return (
    <Section
      id="toast"
      title="Toast"
      lede="Light feedback after an action, bottom left. Failures say what went wrong; anything undoable offers Undo."
    >
      <Specimen
        title="Kinds"
        code={`toastSuccess('Saved')\ntoastError('Could not save', error)\ntoast('Task deleted', { action: { label: 'Undo', onClick } })`}
      >
        <Cell label="success">
          <Button variant="outline" onClick={() => toastSuccess('Settings saved')}>
            Save
          </Button>
        </Cell>
        <Cell label="error with reason">
          <Button
            variant="outline"
            onClick={() =>
              toastError(
                'Could not start the task',
                new Error('No machine is online. Start the daemon and retry.'),
              )
            }
          >
            Start task
          </Button>
        </Cell>
        <Cell label="with action">
          <Button
            variant="outline"
            onClick={() =>
              toast('Moved to Done', {
                action: { label: 'Undo', onClick: () => toastSuccess('Moved back') },
              })
            }
          >
            Mark done
          </Button>
        </Cell>
      </Specimen>
    </Section>
  );
}
