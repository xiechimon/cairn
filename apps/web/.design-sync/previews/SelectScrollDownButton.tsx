import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cairn/web';

const tickets = [1845, 1959, 2054, 2055, 2063, 2101, 2110, 2120, 2131, 2140, 2152, 2153, 2155, 2156, 2160, 2164, 2171, 2178, 2183, 2190];
const branches = ['main', ...tickets.map((n) => `lane/${n}`)];

const ScrollingList = () => (
  <div style={{ width: 300, height: 320, paddingTop: 20 }}>
    <Select defaultValue="lane/1959" defaultOpen>
      <SelectTrigger style={{ width: 220 }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {branches.map((b) => (
          <SelectItem key={b} value={b}>{b}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

export { ScrollingList };
