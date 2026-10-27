import { describe, expect, it } from 'vitest';
import { MODULE_ACCESS, accessSummary, levelOf } from './accessLevels';
import { MODULES } from './modules';

const mod = (k: string) => MODULE_ACCESS.find((m) => m.key === k)!;
const flags = (v: boolean, c = false, u = false, d = false) => ({ can_view: v, can_create: c, can_update: u, can_delete: d });

describe('access levels', () => {
  it('covers every permission module exactly once', () => {
    expect(MODULE_ACCESS.map((m) => m.key).sort()).toEqual([...MODULES].sort());
  });

  it('gives every level a distinct set of flags within its module', () => {
    for (const m of MODULE_ACCESS) {
      const seen = new Set(m.levels.map((l) => JSON.stringify(l.flags)));
      expect(seen.size).toBe(m.levels.length);
    }
  });

  it('names the level that matches stored flags', () => {
    expect(levelOf(mod('production'), flags(true, true)).key).toBe('record');
    expect(levelOf(mod('production'), flags(true, false, true)).key).toBe('approve');
    expect(levelOf(mod('inventory'), flags(true, true, true, true)).key).toBe('manage');
  });

  it('treats anything without View as no access, and nothing at all as none', () => {
    expect(levelOf(mod('sales'), flags(false, true, true)).key).toBe('none');
    expect(levelOf(mod('sales'), null).key).toBe('none');
  });

  it('describes combinations the levels don’t cover as custom', () => {
    const l = levelOf(mod('sales'), flags(true, false, true));
    expect(l.key).toBe('custom');
    expect(l.hint).toBe('Set earlier: see, edit');
  });

  it('summarises only the areas someone can reach', () => {
    const s = accessSummary((m) => (m === 'inventory' ? flags(true, true) : m === 'reports' ? flags(true) : null));
    expect(s).toBe('Inventory: Record · Business reports: See only');
  });
});
