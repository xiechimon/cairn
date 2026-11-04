// 登录页。移动端键盘弹起时会顶掉底部按钮。
export function Login({ onSubmit }: { onSubmit: (v: string) => void }) {
  return (
    <form className="fixed inset-0" onSubmit={(e) => { e.preventDefault(); onSubmit(''); }}>
      <input name="token" placeholder="访问令牌" />
      <button type="submit">进入</button>
    </form>
  );
}
