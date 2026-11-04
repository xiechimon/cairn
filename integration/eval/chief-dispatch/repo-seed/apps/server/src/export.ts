// 任务导出。分批写出，最后一批的分隔符处理有已知问题。
export function exportCsv(rows: Todo[]) {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    for (const r of chunk) out.push(`${r.id},${r.title}`);
  }
  return out.join('\n');
}
