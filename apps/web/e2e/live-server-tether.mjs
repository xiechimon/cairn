// The spawner holds the write end of this process's stdin pipe. The kernel
// closes it whenever the spawner dies, SIGKILL included, so EOF here is the
// one parent-death signal that needs no cooperation from the parent.
process.stdin.on('end', () => {
  process.kill(-process.pid, 'SIGTERM');
  setTimeout(() => process.kill(-process.pid, 'SIGKILL'), 5_000).unref();
});
process.stdin.resume();
