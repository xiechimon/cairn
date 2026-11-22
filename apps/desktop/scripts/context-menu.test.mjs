import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextMenuTemplate } from '../src/context-menu.ts';
import { desktopLocale } from '../src/locale.ts';

const NONE = {
  x: 10,
  y: 20,
  linkURL: '',
  mediaType: 'none',
  srcURL: '',
  selectionText: '',
  isEditable: false,
  editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false },
};

function labelsFor(target, lang, actions = {}) {
  const template = contextMenuTemplate(
    { ...NONE, ...target },
    desktopLocale(lang),
    {
      copyImage: () => {},
      saveImage: () => {},
      copyText: () => {},
      lookUp: () => {},
      ...actions,
    },
    'darwin',
  );
  return template.map((item) => item.label ?? item.type);
}

test('right-clicking an image in a linked chat preview offers copy and save in the app language', () => {
  const copied = [];
  const saved = [];
  const target = {
    mediaType: 'image',
    srcURL: 'https://example.com/a.png',
    linkURL: 'https://example.com/a',
  };
  assert.deepEqual(labelsFor(target, 'zh-CN'), [
    '拷贝图像',
    '将图像存储为…',
    '拷贝图像地址',
    'separator',
    '拷贝链接',
  ]);
  const template = contextMenuTemplate({ ...NONE, ...target }, 'en', {
    copyImage: (x, y) => copied.push([x, y]),
    saveImage: (url) => saved.push(url),
    copyText: () => {},
    lookUp: () => {},
  });
  template[0].click();
  template[1].click();
  assert.deepEqual(copied, [[10, 20]]);
  assert.deepEqual(saved, ['https://example.com/a.png']);
});

test('selected text offers copy and look up; a text field offers cut, copy and paste; nothing else stays silent', () => {
  assert.deepEqual(labelsFor({ selectionText: '  task  report ' }, 'en'), [
    'Copy',
    'separator',
    'Look Up “task report”',
  ]);
  assert.deepEqual(
    labelsFor(
      {
        isEditable: true,
        editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
      },
      'zh-CN',
    ),
    ['剪切', '拷贝', '粘贴', '全选'],
  );
  assert.deepEqual(labelsFor({}, 'zh-CN'), []);
});
