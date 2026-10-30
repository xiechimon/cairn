# Cairn Paper: how to build with this library

## Wrap everything in `PaperRoot`

Every screen must render inside `PaperRoot` (exported from the bundle). It does three things the components depend on:

- applies the Paper light theme (`light` class on the wrapper and on `<html>`; cairn's unwrapped default is a dark theme, so unwrapped components look wrong);
- mounts the i18n provider (`locale` prop, `zh` default, `en` available); components such as `DialogShell`, `AlertDialogShell`, `LiveRow`, `ProfileHeader` and `ToolActivityRow` throw without it;
- sets the page background, foreground and font (`bg-background text-foreground font-sans`).

```jsx
<PaperRoot locale="zh">
  <Card>
    <CardHeader>
      <CardTitle>Task #104</CardTitle>
      <CardDescription>cairn · Implementer</CardDescription>
    </CardHeader>
    <CardContent>
      <StatusChip tone="done">Merged</StatusChip>
    </CardContent>
    <CardFooter>
      <Button variant="ghost">Open</Button>
      <Button>Retry</Button>
    </CardFooter>
  </Card>
</PaperRoot>
```

## Styling idiom

Components are styled with Tailwind v4 utilities over CSS custom properties. The shipped stylesheet is a compiled snapshot of the app, so **only utilities the app already uses exist**; prefer component props, then the utilities below, then inline `style` for layout glue. Do not invent arbitrary-value classes (`py-[7px]`).

| Purpose | Use |
|---|---|
| Surfaces | `bg-background` (page), `bg-card`, `bg-canvas`, `bg-muted`, `bg-popover` |
| Text color | `text-foreground`, `text-muted-foreground`, `text-content-secondary`, `text-content-tertiary`, `text-content-dim` |
| Type scale | `text-page`, `text-heading`, `text-card-title`, `text-ui`, `text-meta`, `text-caption` |
| Borders and radius | `border-border`, `rounded-xl` |
| Layout | `flex`, `flex-col`, `items-center`, `justify-between`, `gap-2`, `gap-3`, `p-4` |

Status color comes from `StatusChip` tones (`idle`, `plan`, `confirm`, `done`, `failed`), backed by `--chip-<tone>-bg` / `--chip-<tone>-fg`. Buttons use `variant` (`default`, `outline`, `secondary`, `ghost`, `destructive`, `link`) and `size` (`xs`, `sm`, `default`, `lg`, `icon*`).

## Where the truth lives

- `styles.css` and its imports: tokens (`--background`, `--foreground`, `--primary`, `--muted`, `--card`, `--border`, `--surface-tertiary`, `--text-secondary`, `--text-tertiary`, `--type-*`) and every available utility.
- `components/<group>/<Name>/<Name>.prompt.md` and `<Name>.d.ts`: per-component usage and props.

## Composition rules

- Overlays (`Dialog`, `AlertDialog`, `DropdownMenu`, `Popover`, `Select`, `Tooltip`) are compound: use the parent with its `*Content`, `*Header`, `*Title`, `*Footer` parts.
- Prefer `DialogShell` / `AlertDialogShell` for app dialogs; they carry the Paper dialog face and the close contract.
- Chat surfaces compose `MessageGroup` > `Message` > `MessageContent` > `Bubble` > `BubbleContent`; agent replies use `Bubble variant="ghost"`.
