import { describe, expect, it } from 'vitest';
import { spiralAvatarSvg, spiralAvatarUrl } from '../src/lib/spiral-avatar.js';

describe('spiralAvatarSvg', () => {
  it('draws the same face for the same name', () => {
    expect(spiralAvatarSvg('r3-builder')).toBe(spiralAvatarSvg('r3-builder'));
  });

  it('draws different faces for the default team names', () => {
    const names = ['chief', 'coder-1', 'coder-2', 'reviewer', 'r3-builder', 'Xmon Dai'];
    expect(new Set(names.map((name) => spiralAvatarSvg(name))).size).toBe(names.length);
  });

  it('paints a project-tile disc with a cream spiral and no intrinsic size', () => {
    const svg = spiralAvatarSvg('Xmon Dai');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 100">/);
    expect(svg).not.toMatch(/\swidth=/);
    expect(svg).toMatch(/fill="#(c06a43|788656|6b7a8f|a0784a|8a6a9a|4f8a8b)"/);
    expect(svg).toContain('stroke="#f2ead7"');
  });

  it('pins the seed-to-svg mapping', () => {
    expect(spiralAvatarSvg('r3-builder')).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#a0784a"/><g transform="translate(50 50) rotate(0) scale(-0.105 0.105) translate(-84 28)"><path d="M0 0 A84 84 0 0 1 168 0 A140 140 0 0 1 -112 0 A196 196 0 0 1 280 0" fill="none" stroke="#f2ead7" stroke-width="64" stroke-linecap="round"/></g></svg>"`);
    expect(spiralAvatarSvg('Xmon Dai')).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#c06a43"/><g transform="translate(50 50) rotate(270) scale(-0.105 0.105) translate(-28 -28)"><path d="M0 0 A84 84 0 0 1 168 0 A140 140 0 0 1 -112 0 A196 196 0 0 1 280 0 A252 252 0 0 1 -224 0" fill="none" stroke="#f2ead7" stroke-width="64" stroke-linecap="round"/></g></svg>"`);
  });
});

describe('busy spiral', () => {
  it('spins only the spiral, keeps the same face, and rests under reduced motion', () => {
    const idle = spiralAvatarSvg('r3-builder');
    const busy = spiralAvatarSvg('r3-builder', true);
    expect(busy).toContain('<g class="spin">');
    expect(busy).toContain('@media (prefers-reduced-motion:reduce){.spin{animation:none}}');
    expect(busy.replace(/<style>.*<\/style>/, '').replace('<g class="spin">', '').replace('</g></g>', '</g>')).toBe(idle);
    expect(idle).not.toContain('spin');
  });
});

describe('spiralAvatarUrl', () => {
  it('is a self-contained data URL that needs no network', () => {
    const url = spiralAvatarUrl('nova');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url.slice('data:image/svg+xml,'.length))).toBe(
      spiralAvatarSvg('nova'),
    );
  });
});
