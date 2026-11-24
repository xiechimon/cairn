import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? 'ok';
const say = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

if (mode === 'crash') process.exit(3);
if (mode === 'ok' || mode === 'noisy') {
  if (mode === 'noisy') process.stdout.write('not json\n{"type":"mystery"}\n');
  say({ type: 'ready' });
  process.stderr.write('helper says hello\n');
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'menu') {
    say({ type: 'opened' });
    for (const item of message.menu.items) say({ type: 'action', id: item.id });
    say({ type: 'closed' });
  }
  if (message.type === 'crash') process.exit(4);
});
process.stdin.on('end', () => process.exit(0));
