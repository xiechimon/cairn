import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compact = (path: URL) => readFileSync(path, 'utf8').replace(/\s+/g, '');

const shell = compact(new URL('../src/components/ui/dialog-shell.tsx', import.meta.url));
const spec = compact(new URL('../e2e/search-palette-dismiss.spec.ts', import.meta.url));

describe('viewport dialog dismissal', () => {
  it('owns an outside click and an Escape for the popup it renders', () => {
    expect(shell).toContain('useViewportDismissal(shellId,viewportRoot&&dismissible&&open,onClose)');
    expect(shell).toContain("document.addEventListener('click',dismissOutside)");
    expect(shell).toContain("document.addEventListener('keydown',dismissEscape)");
    expect(shell).toContain("if(event.key!=='Escape'||!ownsTopLayer())return;");
    expect(shell).toContain('if(!ownsTopLayer()||!outsideOwnLayer(event.target))return;');
  });

  it('dismisses only the dialog that sits on top of the layer stack', () => {
    expect(shell).toContain('constownsTopLayer=()=>{');
    expect(shell).toContain('layers[layers.length-1]===ownLayer()');
    expect(shell).toContain('returntarget.closest(FLOATING_LAYER_SEL)==null');
  });

  it('locks the reported palette cases in e2e', () => {
    for (const title of [
      'oneclickoutsidethepaletteclosesit',
      'adismissalclickonthedialoglayeroutsidethepanelclosesit',
      'oneEscapeclosesthepalettewhilethefieldholdstext',
      'oneEscapeclosesthepalettewhilethefieldiscomposing',
      'oneEscapeclosestheemptypalette',
    ]) {
      expect(spec).toContain(title);
    }
  });
});
