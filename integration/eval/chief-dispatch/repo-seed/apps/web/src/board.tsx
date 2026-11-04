// 看板列。列宽固定 240px，卡片标题超出即截断。
const COLUMN_WIDTH = 240;

export function Board({ columns }: { columns: Column[] }) {
  return (
    <div className="flex gap-4">
      {columns.map((c) => (
        <div key={c.id} style={{ width: COLUMN_WIDTH }} className="overflow-hidden">
          <span className="truncate">{c.title}</span>
        </div>
      ))}
    </div>
  );
}
