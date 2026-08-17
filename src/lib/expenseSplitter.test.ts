import { describe, it, expect } from 'vitest';
import { splitNarrative, isSplittable } from './expenseSplitter';
import { formatMinor } from './money';

describe('X-03 — the worked example from section 3.2', () => {
  // This is a real record from the payables register. It must produce 8 lines
  // totalling ₦922,340, and must recognise "Total amount 922,340" as a total
  // to reconcile against rather than as a 9th line.
  const input =
    'Expense 10kg of teriyaki 142,050 Credit payment items Mr Theophilus 202,000 ' +
    'Bus fuel 50,000 Five small gas cylinder refill 65,000 Two bag of charcoal ' +
    '20,300 Onyeka pouch payment 22,400 1 bag fillet, and 1 bag wings 319,590 ' +
    'Withdraw and send to meat guy 101,000 Total amount 922,340';

  const result = splitNarrative(input);

  it('produces exactly 8 lines', () => {
    expect(result.lines).toHaveLength(8);
  });

  it('totals ₦922,340', () => {
    expect(result.totalMinor).toBe(92234000n);
    expect(formatMinor(result.totalMinor)).toBe('₦922,340.00');
  });

  it('recognises "Total amount 922,340" as the stated total, not a line', () => {
    expect(result.statedTotalMinor).toBe(92234000n);
    expect(result.lines.map((l) => l.description)).not.toContain('Total amount');
  });

  it('reconciles', () => {
    expect(result.reconciles).toBe(true);
    expect(result.message).toBe('8 lines totalling ₦922,340.00 — matches the stated total.');
  });

  it('splits each purchase with its own description and amount', () => {
    expect(result.lines).toEqual([
      { description: 'Expense 10kg of teriyaki', amountRaw: '142,050', amountMinor: 14205000n },
      { description: 'Credit payment items Mr Theophilus', amountRaw: '202,000', amountMinor: 20200000n },
      { description: 'Bus fuel', amountRaw: '50,000', amountMinor: 5000000n },
      { description: 'Five small gas cylinder refill', amountRaw: '65,000', amountMinor: 6500000n },
      { description: 'Two bag of charcoal', amountRaw: '20,300', amountMinor: 2030000n },
      { description: 'Onyeka pouch payment', amountRaw: '22,400', amountMinor: 2240000n },
      { description: '1 bag fillet, and 1 bag wings', amountRaw: '319,590', amountMinor: 31959000n },
      { description: 'Withdraw and send to meat guy', amountRaw: '101,000', amountMinor: 10100000n },
    ]);
  });

  it('does not mistake quantities for amounts', () => {
    // "10kg", and the two "1 bag" quantities, must not become their own lines.
    const amounts = result.lines.map((l) => l.amountRaw);
    expect(amounts).not.toContain('10');
    expect(amounts).not.toContain('1');
  });
});

describe('splitNarrative — one purchase per line', () => {
  it('splits newline-delimited text', () => {
    const r = splitNarrative('Bus fuel 50,000\nCharcoal 20,300\nGas refill 65,000');
    expect(r.lines).toHaveLength(3);
    expect(r.totalMinor).toBe(13530000n);
  });

  it('handles the amount appearing before the description on its own line', () => {
    const r = splitNarrative('50,000 bus fuel\n20,300 charcoal');
    expect(r.lines.map((l) => l.description)).toEqual(['bus fuel', 'charcoal']);
  });

  it('strips currency markers from the amount', () => {
    const r = splitNarrative('Bus fuel ₦50,000\nCharcoal NGN 20,300');
    expect(r.lines).toHaveLength(2);
    expect(r.totalMinor).toBe(7030000n);
  });

  it('strips the directional marks that come from a chat paste', () => {
    const r = splitNarrative('‎Bus fuel 50,000‏\nCharcoal 20,300');
    expect(r.lines[0].description).toBe('Bus fuel');
    expect(r.lines).toHaveLength(2);
  });
});

describe('splitNarrative — reconciliation', () => {
  it('flags a stated total that does not match', () => {
    const r = splitNarrative('Bus fuel 50,000 Charcoal 20,300 Total 100,000');
    expect(r.reconciles).toBe(false);
    expect(r.statedTotalMinor).toBe(10000000n);
    expect(r.totalMinor).toBe(7030000n);
    expect(r.message).toMatch(/but the stated total is ₦100,000\.00/);
  });

  it('reconciles when there is no stated total', () => {
    const r = splitNarrative('Bus fuel 50,000 Charcoal 20,300');
    expect(r.reconciles).toBe(true);
    expect(r.statedTotalMinor).toBeNull();
  });

  it('recognises several ways of writing a total', () => {
    for (const phrase of ['Total', 'Total amount', 'Grand total', 'Sub total', 'Altogether']) {
      const r = splitNarrative(`Bus fuel 50,000 Charcoal 20,300 ${phrase} 70,300`);
      expect(r.statedTotalMinor, phrase).toBe(7030000n);
      expect(r.lines, phrase).toHaveLength(2);
    }
  });
});

describe('splitNarrative — edges', () => {
  it('returns nothing useful for text with no amounts', () => {
    const r = splitNarrative('Went to the market and came back');
    expect(r.lines).toHaveLength(0);
    expect(r.message).toBe('No separate amounts found in that text.');
  });

  it('handles a single expense without splitting it into nonsense', () => {
    const r = splitNarrative('10kg of teriyaki 142,050');
    expect(r.lines).toEqual([
      { description: '10kg of teriyaki', amountRaw: '142,050', amountMinor: 14205000n },
    ]);
  });

  it('keeps trailing prose that has no amount as leftover', () => {
    const r = splitNarrative('Bus fuel 50,000 and I still owe the meat guy');
    expect(r.lines).toHaveLength(1);
    expect(r.leftover).toBe('I still owe the meat guy');
  });

  it('only offers the splitter when there is more than one line to make', () => {
    expect(isSplittable('Bus fuel 50,000')).toBe(false);
    expect(isSplittable('Bus fuel 50,000 Charcoal 20,300')).toBe(true);
  });
});
