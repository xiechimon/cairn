const rules = [
  {
    fields: { '-p': 'udp', '--sport': '68', '--dport': '67' },
    args: 'allow in on vz-cairn proto udp from any port 68 to any port 67 comment cairn-orb-dhcp'.split(
      ' ',
    ),
  },
  {
    fields: { '-p': 'tcp', '-s': '10.203.0.0/24', '-d': '10.203.0.1/32', '--dport': '7890' },
    args: 'allow in on vz-cairn proto tcp from 10.203.0.0/24 to 10.203.0.1 port 7890 comment cairn-orb-relay'.split(
      ' ',
    ),
  },
];

export function missingUfwRules(content) {
  const accepts = content.split('\n').flatMap((line) => {
    const tokens = line.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    if (tokens[0] !== '-A' || tokens[1] !== 'ufw-user-input' || tokens.length % 2 !== 0) return [];
    const fields = {};
    for (let i = 2; i < tokens.length; i += 2) {
      const key = tokens[i];
      const value = tokens[i + 1];
      if (key === '-m' && ['udp', 'tcp', 'comment'].includes(value)) continue;
      if (key === '--comment') continue;
      if (
        !['-i', '-p', '-s', '-d', '--sport', '--dport', '-j'].includes(key) ||
        Object.hasOwn(fields, key)
      )
        return [];
      fields[key] = key === '-d' && value === '10.203.0.1' ? '10.203.0.1/32' : value;
    }
    if (fields['-s'] === '0.0.0.0/0') delete fields['-s'];
    if (fields['-d'] === '0.0.0.0/0') delete fields['-d'];
    return [fields];
  });
  return rules.filter(({ fields }) => {
    const expected = { '-i': 'vz-cairn', '-j': 'ACCEPT', ...fields };
    return !accepts.some(
      (actual) =>
        Object.keys(actual).length === Object.keys(expected).length &&
        Object.entries(expected).every(([key, value]) => actual[key] === value),
    );
  });
}
