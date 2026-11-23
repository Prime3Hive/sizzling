import { describe, expect, it } from 'vitest';
import { hasProblems, itemKindLabel, itemProblems, orderForCount, sameNameItem } from './itemMaster';

// The item master checks from the inventory redesign (23 Nov 2026).
const list = [
  { id: 'a', name: 'Chicken Wings' },
  { id: 'b', name: 'PRAWNS' },
];
const good = { name: 'Gizzard', kind: 'raw_ingredient', stockUnit: 'kg', minLevel: '20' };

describe('item master', () => {
  it('check 1: an item cannot be saved without a stock unit, a type and a minimum level', () => {
    expect(hasProblems(itemProblems(good, list))).toBe(false);
    expect(itemProblems({ ...good, stockUnit: '' }, list).stockUnit).toBeTruthy();
    expect(itemProblems({ ...good, kind: '' }, list).kind).toBeTruthy();
    expect(itemProblems({ ...good, minLevel: '' }, list).minLevel).toBeTruthy();
    expect(itemProblems({ ...good, minLevel: '-1' }, list).minLevel).toBeTruthy();
  });

  it('takes 0 as a minimum level when it is typed', () => {
    expect(itemProblems({ ...good, minLevel: '0' }, list).minLevel).toBeUndefined();
  });

  it('does not ask for a type before the database can store one', () => {
    expect(itemProblems({ ...good, kind: '' }, list, { requireKind: false }).kind).toBeUndefined();
  });

  it('keeps names unique whatever the case or spacing, archived items included', () => {
    expect(sameNameItem('  chicken   wings ', list)?.id).toBe('a');
    expect(itemProblems({ ...good, name: 'prawns' }, list).name).toContain('PRAWNS');
    // An item may keep its own name when it is edited.
    expect(itemProblems({ ...good, name: 'Chicken Wings' }, list, { exceptId: 'a' }).name).toBeUndefined();
    expect(itemProblems({ ...good, name: '  ' }, list).name).toBeTruthy();
  });

  it('labels the type, and says so when it is not set', () => {
    expect(itemKindLabel('fuel')).toBe('Fuel');
    expect(itemKindLabel(null)).toBe('Not set');
  });

  it('orders the count sheet by storage place, then name, with unplaced items last', () => {
    const items = [
      { name: 'Rice', place: 'Dry store' },
      { name: 'Wings', place: 'Freezer' },
      { name: 'Mystery', place: null },
      { name: 'Gas', place: 'Gas store' },
      { name: 'Breast', place: 'freezer' },
      { name: 'Ice', place: 'Shed' },
    ];
    const sorted = orderForCount(items, (i) => i.place, ['Freezer', 'Cold room', 'Dry store', 'Gas store']);
    expect(sorted.map((i) => i.name)).toEqual(['Breast', 'Wings', 'Rice', 'Gas', 'Ice', 'Mystery']);
  });
});
