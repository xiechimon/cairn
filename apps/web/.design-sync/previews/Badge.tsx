import { Badge } from '@cairn/web';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Badge>Implementer</Badge>
    <Badge variant="secondary">cairn</Badge>
    <Badge variant="destructive">CI failed</Badge>
    <Badge variant="outline">PR #2156</Badge>
    <Badge variant="ghost">Draft</Badge>
    <Badge variant="link">View build</Badge>
  </div>
);
