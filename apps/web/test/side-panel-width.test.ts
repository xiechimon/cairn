import { describe, expect, it } from 'vitest';
import {
  clampPanelWidth,
  PANEL_WIDTH_DEFAULT,
  PANEL_WIDTH_MIN,
  panelWidthMax,
  readPanelWidth,
} from '../src/components/side-panel-width.js';

describe('side panel width', () => {
  it('starts at the Tasks panel width when nothing is stored', () => {
    expect(readPanelWidth(null, 1440)).toBe(PANEL_WIDTH_DEFAULT);
    expect(PANEL_WIDTH_DEFAULT).toBe(420);
  });

  it('ignores stored values that are not numbers', () => {
    expect(readPanelWidth('wide', 1440)).toBe(PANEL_WIDTH_DEFAULT);
    expect(readPanelWidth('', 1440)).toBe(PANEL_WIDTH_DEFAULT);
    expect(readPanelWidth('NaN', 1440)).toBe(PANEL_WIDTH_DEFAULT);
  });

  it('keeps a stored width inside the bounds of the current window', () => {
    expect(readPanelWidth('560', 1440)).toBe(560);
    expect(readPanelWidth('100', 1440)).toBe(PANEL_WIDTH_MIN);
    expect(readPanelWidth('5000', 1440)).toBe(panelWidthMax(1440));
  });

  it('never lets the panel take more than 60% of the window', () => {
    expect(panelWidthMax(1440)).toBe(864);
    expect(clampPanelWidth(2000, 1200)).toBe(720);
  });

  it('never goes below the minimum, even in a narrow window', () => {
    expect(clampPanelWidth(10, 1440)).toBe(PANEL_WIDTH_MIN);
    expect(clampPanelWidth(500, 400)).toBe(PANEL_WIDTH_MIN);
  });

  it('rounds to whole pixels', () => {
    expect(clampPanelWidth(480.6, 1440)).toBe(481);
  });
});
