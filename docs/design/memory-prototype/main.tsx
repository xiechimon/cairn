import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EmptyState } from '../../../apps/web/src/components/empty-state.js';
import { ListCard, ListRow } from '../../../apps/web/src/components/list-card.js';
import { SettingsCard } from '../../../apps/web/src/components/settings-list.js';
import { AlertDialogShell } from '../../../apps/web/src/components/ui/alert-dialog-shell.js';
import { Button } from '../../../apps/web/src/components/ui/button.js';
import { DialogShell } from '../../../apps/web/src/components/ui/dialog-shell.js';
import { Skeleton } from '../../../apps/web/src/components/ui/skeleton.js';
import { TooltipProvider } from '../../../apps/web/src/components/ui/tooltip.js';
import { I18nProvider } from '../../../apps/web/src/i18n/provider.js';
import { FileText } from '../../../apps/web/src/icons/index.js';
import '../../../apps/web/src/styles/fonts.css';
import '../../../apps/web/src/styles/motion.css';
import '../../../apps/web/src/styles/app.css';

const params = new URLSearchParams(location.search);
const scenario = params.get('state') ?? 'populated';
document.documentElement.classList.toggle('light', params.get('theme') !== 'dark');
const examples = [
  { title: 'Verification commands', content: 'Run the affected tests before pushing a code change.', scope: 'Team', layer: 'Core' },
  { title: 'Accessibility review', content: 'Check keyboard navigation before requesting review.', scope: 'Field Notes', layer: 'Core' },
  { title: 'Release handover', content: 'Record acceptance evidence in the thread before handing off completed work.', scope: 'Field Notes', layer: 'Searchable' },
];

function Prototype() {
  const [state, setState] = useState(scenario);
  const [rows, setRows] = useState(state === 'empty' ? [] : examples);
  const [selected, setSelected] = useState(state === 'detail' ? 0 : 1);
  const [detail, setDetail] = useState(state === 'detail' || state === 'long');
  const [confirmation, setConfirmation] = useState<'delete' | 'promote' | null>(state.startsWith('delete') ? 'delete' : state.startsWith('promote') ? 'promote' : null);
  const [status, setStatus] = useState('');
  const cancel = useRef<HTMLButtonElement>(null);
  const firstRow = useRef<HTMLButtonElement>(null);
  const memory = rows[selected] ?? examples[0];
  const pending = state.endsWith('-pending');
  const failed = state.endsWith('-error');
  const offline = state === 'offline';
  const body = state === 'long' ? `${memory.content} ${'Keep the full decision and its scope visible when reviewing a long saved fact. '.repeat(18)}` : memory.content;
  const finish = () => {
    if (confirmation === 'delete') setRows(rows.filter((_, index) => index !== selected));
    else setRows(rows.map((row, index) => index === selected ? { ...row, scope: 'Team' } : row));
    setStatus(confirmation === 'delete' ? 'Saved memory deleted.' : 'Memory is now available to the team.');
    setConfirmation(null);
    setDetail(false);
    firstRow.current?.focus();
  };
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex min-h-14 items-center border-b border-border px-4 sm:px-6">
        <h1 className="voice-title text-page">Coordinator settings</h1>
      </header>
      <section aria-label="Memory" className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <div className="space-y-1">
          <h2 className="font-heading text-heading font-title">Memory</h2>
          <p className="text-ui text-content-secondary">Review the facts the Coordinator keeps for future work.</p>
          <p className="text-meta text-content-tertiary">Design fixture · fictional data · no product connection</p>
        </div>
        <p role="status" className="text-meta text-content-secondary">{status}</p>
        {offline && <p className="text-ui text-content-secondary">Offline. Saved memories are read-only until you reconnect.</p>}
        {state === 'error' ? (
          <SettingsCard>
            <div role="alert" className="space-y-3 p-4">
              <p className="text-ui">Memories could not be loaded. Try again.</p>
              <Button className="min-h-11" onClick={() => setState('populated')}>Retry</Button>
            </div>
          </SettingsCard>
        ) : state === 'loading' ? (
          <SettingsCard>
            <div role="status" aria-label="Loading memories" className="space-y-6 p-4">
              {[0, 1, 2].map((key) => <div key={key} className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-full" /></div>)}
            </div>
          </SettingsCard>
        ) : rows.length === 0 ? (
          <SettingsCard><EmptyState icon={FileText} title="No saved memories yet." description="Useful facts are saved during work with the Coordinator." /></SettingsCard>
        ) : (
          <>
            <p className="text-meta text-content-tertiary">{rows.length} saved entries · 100 maximum · not every entry is injected</p>
            <ListCard>
              {rows.map((row, index) => (
                <Button key={row.title} ref={index === 0 ? firstRow : undefined} variant="ghost" aria-label={`Open memory: ${row.title}`} className="h-auto min-h-11 w-full justify-start rounded-none p-0 text-left transition-none" onClick={() => { setSelected(index); setDetail(true); }}>
                  <ListRow className="w-full" title={row.title} subtitle={<>{row.scope} · {row.layer}<br />{row.content}</>} />
                </Button>
              ))}
            </ListCard>
          </>
        )}
        <p className="text-meta text-content-secondary">To correct a fact, tell the Coordinator what changed.</p>
      </section>
      <DialogShell open={detail && confirmation === null} title={memory.title} subtitle={`${memory.scope} · ${memory.layer}`} onClose={() => setDetail(false)} footer={
        <div className="flex flex-wrap gap-2">
          {memory.scope !== 'Team' && !offline && <Button variant="ghost" className="min-h-11" onClick={() => setConfirmation('promote')}>Promote to team…</Button>}
          {!offline && <Button variant="ghost" className="min-h-11 text-destructive" onClick={() => setConfirmation('delete')}>Delete…</Button>}
        </div>
      }>
        <p className="text-ui break-words whitespace-pre-wrap">{body}</p>
        <p className="mt-4 text-meta text-content-secondary">Updated 8 Nov · saved during work on Field Notes</p>
      </DialogShell>
      <AlertDialogShell open={confirmation !== null} ariaLabel={confirmation === 'delete' ? 'Delete saved memory' : 'Promote memory to team'} title={confirmation === 'delete' ? 'Delete saved memory?' : 'Make this a team memory?'} onClose={() => { if (!pending) setConfirmation(null); }} footer={
        <div className="flex flex-wrap gap-2">
          <Button ref={cancel} variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirmation(null)}>Cancel</Button>
          <Button variant={confirmation === 'delete' ? 'destructive' : 'default'} className="min-h-11" disabled={pending} onClick={finish}>{pending ? 'Saving…' : confirmation === 'delete' ? 'Delete memory' : 'Promote to team'}</Button>
        </div>
      }>
        <p className="mb-2 text-ui font-semibold">{memory.title}</p>
        <p className="text-ui break-words">{memory.content}</p>
        <p className="mt-4 text-ui text-content-secondary">{confirmation === 'delete' ? 'Removes this saved fact, not its source conversation or earlier versions.' : `${memory.scope} → Team. Future work across projects may use this fact.`}</p>
        {pending && <p role="status" className="mt-4 text-meta text-content-secondary">Saving this change. Controls are unavailable until it finishes.</p>}
        {failed && <p role="alert" className="mt-4 text-ui text-destructive">The change was not saved. Your memory is unchanged. Try again.</p>}
      </AlertDialogShell>
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Prototype root missing');
createRoot(root).render(<I18nProvider initialLocale="en"><TooltipProvider><Prototype /></TooltipProvider></I18nProvider>);
