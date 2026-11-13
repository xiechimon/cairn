# Web error boundaries

Use this comparison when maintaining route and conversation crash recovery. The requested scope excludes side panels until #3924.

| Source | Observed behavior | Fit and trade-off |
| --- | --- | --- |
| [React Component](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary) | Observed: `getDerivedStateFromError` selects fallback UI for descendant render failures; event-handler and async errors are outside this mechanism. | Reuse the installed React class API without dependencies. |
| [react-error-boundary](https://github.com/bvaughn/react-error-boundary) | Observed: fallback reset clears the error and retries rendering; reset keys support changed context. | Equivalent reset semantics, but a dependency is unnecessary for this scope. |
| Cairn implementation | Inferred: a boolean failure state catches even nullish thrown values; retry remounts children, and pathname keys prevent a previous route fallback persisting. | Keep one reusable boundary with the existing EmptyState and locale provider. |

Implement in `App.tsx`, `board/home-c.tsx`, and `components/subtree-error-boundary.tsx`. Verify recovery, persistent failure, sibling preservation, route navigation, and both locales; label fault injection separately from real provider execution.
