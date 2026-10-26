export function argvEqualsForm(
  argv: readonly string[],
  stringOptionNames: readonly string[],
): string[] {
  const out: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    const value = argv[index + 1];
    const name = arg.startsWith('--') && !arg.includes('=') ? arg.slice(2) : null;
    if (
      name === null ||
      !stringOptionNames.includes(name) ||
      value === undefined ||
      !value.startsWith('-')
    ) {
      out.push(arg);
      continue;
    }
    out.push(`${arg}=${value}`);
    index++;
  }
  return out;
}
