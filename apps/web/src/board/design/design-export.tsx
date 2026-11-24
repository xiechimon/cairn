import { FileArchive, FileCode, FileImage, Printer } from 'lucide-react';
import type { RefObject } from 'react';
import { KeyedMenuContent, KeyedMenuItem } from '../../components/menu-keys.js';
import { Button } from '../../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.js';
import { toastError } from '../../components/ui/toaster.js';
import { useI18n } from '../../i18n/provider.js';
import { ChevronDown, Download } from '../../icons/index.js';
import { TOOL_BUTTON } from '../artifact/artifact-toolbar.js';
import {
  buildDesignHandoffContent,
  buildDesignManifestContent,
  DESIGN_HANDOFF_FILENAME,
  DESIGN_MANIFEST_FILENAME,
  safeFilename,
} from '../../vendor-open-design/design-handoff.js';
import { requestPreviewSnapshot } from '../../vendor-open-design/snapshot-request.js';
import { buildZip } from '../../vendor-open-design/zip.js';

function downloadHref(href: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  downloadHref(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function pageSlug(fileName: string): string {
  return safeFilename(fileName.replace(/\.html?$/i, ''), 'page');
}

export function downloadPageHtml(html: string, fileName: string) {
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), fileName);
}

function downloadPageZip(html: string, fileName: string) {
  const slug = pageSlug(fileName);
  const files = ['index.html'];
  downloadBlob(
    buildZip([
      { path: `${slug}/index.html`, content: html },
      {
        path: `${slug}/${DESIGN_HANDOFF_FILENAME}`,
        content: buildDesignHandoffContent({ title: fileName, entryFile: 'index.html', files }),
      },
      {
        path: `${slug}/${DESIGN_MANIFEST_FILENAME}`,
        content: buildDesignManifestContent({ title: fileName, entryFile: 'index.html', files }),
      },
    ]),
    `${slug}.zip`,
  );
}

export function ExportMenu({
  fileName,
  html,
  frameRef,
  previewing,
  printHref,
}: {
  fileName: string;
  html: string | undefined;
  frameRef: RefObject<HTMLIFrameElement | null>;
  previewing: boolean;
  printHref: string;
}) {
  const { t } = useI18n();
  const exportPng = async () => {
    const frame = frameRef.current;
    const result = frame === null ? null : await requestPreviewSnapshot(frame);
    if (result?.ok !== true) {
      toastError(t('页面截图未能截取'), null);
      return;
    }
    downloadHref(result.snapshot.dataUrl, `${pageSlug(fileName)}.png`);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            data-testid="design-export"
            disabled={html === undefined}
            className={TOOL_BUTTON}
          />
        }
      >
        <Download aria-hidden className="size-4" />
        <span className="max-[640px]:sr-only">{t('导出')}</span>
        <ChevronDown aria-hidden className="size-4 text-content-tertiary" />
      </DropdownMenuTrigger>
      <KeyedMenuContent align="end" className="w-56">
        <KeyedMenuItem
          shortcut="H"
          data-testid="design-export-html"
          onClick={() => html !== undefined && downloadPageHtml(html, fileName)}
        >
          <FileCode aria-hidden />
          {t('HTML 文件')}
        </KeyedMenuItem>
        <KeyedMenuItem
          shortcut="Z"
          data-testid="design-export-zip"
          onClick={() => html !== undefined && downloadPageZip(html, fileName)}
        >
          <FileArchive aria-hidden />
          {t('ZIP（含交接说明）')}
        </KeyedMenuItem>
        <KeyedMenuItem
          shortcut="P"
          data-testid="design-export-png"
          disabled={!previewing}
          onClick={() => void exportPng()}
        >
          <FileImage aria-hidden />
          {t('PNG 截图')}
        </KeyedMenuItem>
        <KeyedMenuItem
          shortcut="F"
          data-testid="design-export-pdf"
          render={<a href={printHref} target="_blank" rel="noopener noreferrer" />}
        >
          <Printer aria-hidden />
          {t('打印成 PDF')}
        </KeyedMenuItem>
      </KeyedMenuContent>
    </DropdownMenu>
  );
}
