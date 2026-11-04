// 导出按钮。点击后将当前看板导出为 CSV。
export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="导出当前看板">
      导出
    </button>
  );
}
