import {
  extractPlainMessageText,
  workspaceFilePathSchema,
  workspaceFileReferences,
} from '@cairn/shared';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

export function messageFileReferences(content: unknown): string[] {
  const paths = new Set<string>();
  const visit = (node: { type: string; value?: string; url?: string; children?: unknown[] }) => {
    if (node.type === 'link') {
      const result = workspaceFilePathSchema.safeParse(node.url);
      if (result.success) paths.add(result.data);
      return;
    }
    if (
      node.type === 'image' ||
      node.type === 'code' ||
      node.type === 'html' ||
      node.type === 'definition' ||
      node.type === 'linkReference' ||
      node.type === 'imageReference'
    )
      return;
    if (node.type === 'inlineCode') {
      const result = workspaceFilePathSchema.safeParse(node.value);
      if (result.success) paths.add(result.data);
      return;
    }
    if (node.type === 'text') {
      for (const ref of workspaceFileReferences(node.value ?? '')) paths.add(ref.path);
      return;
    }
    for (const child of node.children ?? []) visit(child as typeof node);
  };
  visit(
    fromMarkdown(extractPlainMessageText(content), {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }),
  );
  return [...paths];
}
