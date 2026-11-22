import type {
  Clipboard,
  ContextMenuParams,
  Menu,
  MenuItemConstructorOptions,
  WebContents,
} from 'electron';
import type { DesktopLocale } from './locale.js';

type ContextMenuTarget = Pick<
  ContextMenuParams,
  'x' | 'y' | 'linkURL' | 'mediaType' | 'srcURL' | 'selectionText' | 'isEditable' | 'editFlags'
>;

export interface ContextMenuActions {
  copyImage: (x: number, y: number) => void;
  saveImage: (url: string) => void;
  copyText: (text: string) => void;
  lookUp: () => void;
}

const LABELS = {
  zh: {
    cut: '剪切',
    copy: '拷贝',
    paste: '粘贴',
    selectAll: '全选',
    copyImage: '拷贝图像',
    saveImage: '将图像存储为…',
    copyImageAddress: '拷贝图像地址',
    copyLink: '拷贝链接',
    lookUp: (text: string) => `查询“${text}”`,
  },
  en: {
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    copyImage: 'Copy Image',
    saveImage: 'Save Image As…',
    copyImageAddress: 'Copy Image Address',
    copyLink: 'Copy Link',
    lookUp: (text: string) => `Look Up “${text}”`,
  },
} as const;

const LOOK_UP_PREVIEW_LENGTH = 24;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LOOK_UP_PREVIEW_LENGTH ? `${flat.slice(0, LOOK_UP_PREVIEW_LENGTH)}…` : flat;
}

export function contextMenuTemplate(
  target: ContextMenuTarget,
  locale: DesktopLocale,
  actions: ContextMenuActions,
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  const label = LABELS[locale];
  const groups: MenuItemConstructorOptions[][] = [];
  const selection = target.selectionText.trim();

  if (target.mediaType === 'image' && target.srcURL !== '') {
    groups.push([
      { label: label.copyImage, click: () => actions.copyImage(target.x, target.y) },
      { label: label.saveImage, click: () => actions.saveImage(target.srcURL) },
      ...(target.srcURL.startsWith('data:')
        ? []
        : [{ label: label.copyImageAddress, click: () => actions.copyText(target.srcURL) }]),
    ]);
  }

  if (target.linkURL !== '') {
    groups.push([{ label: label.copyLink, click: () => actions.copyText(target.linkURL) }]);
  }

  if (target.isEditable) {
    groups.push([
      { role: 'cut', label: label.cut, enabled: target.editFlags.canCut },
      { role: 'copy', label: label.copy, enabled: target.editFlags.canCopy },
      { role: 'paste', label: label.paste, enabled: target.editFlags.canPaste },
      { role: 'selectAll', label: label.selectAll, enabled: target.editFlags.canSelectAll },
    ]);
  } else if (selection !== '') {
    groups.push([{ role: 'copy', label: label.copy }]);
  }

  if (selection !== '' && platform === 'darwin') {
    groups.push([{ label: label.lookUp(preview(selection)), click: actions.lookUp }]);
  }

  return groups.flatMap((group, index) =>
    index === 0 ? group : [{ type: 'separator' as const }, ...group],
  );
}

export interface ContextMenuElectron {
  clipboard: Pick<Clipboard, 'writeText'>;
  Menu: Pick<typeof Menu, 'buildFromTemplate'>;
}

export function installContextMenu(
  contents: WebContents,
  electron: ContextMenuElectron,
  locale: (lang: unknown) => DesktopLocale,
): void {
  contents.on('context-menu', (_event, params) => {
    void contents
      .executeJavaScript('document.documentElement.lang')
      .catch(() => null)
      .then((lang) => {
        if (contents.isDestroyed()) return;
        const template = contextMenuTemplate(params, locale(lang), {
          copyImage: (x, y) => contents.copyImageAt(x, y),
          saveImage: (url) => contents.downloadURL(url),
          copyText: (text) => electron.clipboard.writeText(text),
          lookUp: () => contents.showDefinitionForSelection(),
        });
        if (template.length > 0) electron.Menu.buildFromTemplate(template).popup();
      });
  });
}
