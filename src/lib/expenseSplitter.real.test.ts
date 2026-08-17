import { describe, it, expect } from 'vitest';
import { splitNarrative } from './expenseSplitter';
import { formatMinor } from './money';

// ─────────────────────────────────────────────────────────────────────────────
// Regression tests taken verbatim from the live payables register.
//
// The worked example in the fix instructions is tidy. The real narratives are
// not: they carry U+200E directional marks from a chat paste, "k" for
// thousands, a space after the thousands comma, doubled commas, and an
// apostrophe used as a separator. Migration M-04 runs the splitter over this
// data, so it has to survive all of it.
// ─────────────────────────────────────────────────────────────────────────────

describe('the "k" suffix, which this register is full of', () => {
  it('reads 50k as fifty thousand', () => {
    const r = splitNarrative('Bus fuel 50k');
    expect(r.lines).toEqual([
      { description: 'Bus fuel', amountRaw: '50k', amountMinor: 5_000_000n },
    ]);
  });

  it('still treats 10kg as a quantity, not ten thousand', () => {
    const r = splitNarrative('10kg of teriyaki 142,050');
    expect(r.lines).toEqual([
      { description: '10kg of teriyaki', amountRaw: '142,050', amountMinor: 14_205_000n },
    ]);
  });

  it('handles a run mixing k amounts and full figures', () => {
    // From row 8f3f431e.
    const r = splitNarrative('Withdraw and send onyeka 35k Instagram subscribe 45k');
    expect(r.lines).toEqual([
      { description: 'Withdraw and send onyeka', amountRaw: '35k', amountMinor: 3_500_000n },
      { description: 'Instagram subscribe', amountRaw: '45k', amountMinor: 4_500_000n },
    ]);
  });

  it('accepts an upper-case K', () => {
    expect(splitNarrative('Gen fuel 20K').lines[0].amountMinor).toBe(2_000_000n);
  });

  it('does not read a k that begins a word as thousands', () => {
    // "5 kg" and "2 kilos" are quantities however they are spaced.
    expect(splitNarrative('Beef 5 kg').lines).toHaveLength(0);
  });
});

describe('separator notations found in the real data', () => {
  it('repairs a space after the thousands comma', () => {
    // From row b48c4d0b: "1 Bag of fillet 183, 890".
    const r = splitNarrative('1 Bag of fillet 183, 890');
    expect(r.lines).toEqual([
      { description: '1 Bag of fillet', amountRaw: '183,890', amountMinor: 18_389_000n },
    ]);
  });

  it('repairs a doubled comma', () => {
    // From row b96f74d0: "5 Packs of laps 29,,840".
    const r = splitNarrative('5 Packs of laps 29,,840');
    expect(r.lines[0].amountMinor).toBe(2_984_000n);
  });

  it('repairs an apostrophe used as a separator', () => {
    // From row 3a1ddeef: "Chicken wings 160'000".
    const r = splitNarrative("Chicken wings 160'000");
    expect(r.lines[0].amountMinor).toBe(16_000_000n);
  });

  it('reads a stated total written with a space after the comma', () => {
    // From row 6a234ff9: "Total amount 1,373, 250".
    const r = splitNarrative('Bus fuel 50,000 Total amount 1,373, 250');
    expect(r.statedTotalMinor).toBe(137_325_000n);
    expect(r.lines).toHaveLength(1);
  });
});

describe('a real narrative end to end', () => {
  // Row 44eb2938, the shortest genuine one, with its U+200E marks intact.
  const input =
    'Credit purchase — 2kg of jumbo prawns 66,500 Another 10pcs plantain 7,500 ' +
    'Butter meatpie 3,000 Total amount 77,000: 1';

  const r = splitNarrative(input);

  it('finds the three purchases', () => {
    expect(r.lines.map((l) => l.amountMinor)).toEqual([6_650_000n, 750_000n, 300_000n]);
  });

  it('totals ₦77,000 and reconciles against the stated total', () => {
    expect(formatMinor(r.totalMinor)).toBe('₦77,000.00');
    expect(r.statedTotalMinor).toBe(7_700_000n);
    expect(r.reconciles).toBe(true);
  });

  it('does not turn the quantities into lines', () => {
    // "2kg" and "10pcs" are quantities; the trailing ": 1" is not an amount.
    expect(r.lines).toHaveLength(3);
    expect(r.lines.map((l) => l.amountRaw)).not.toContain('1');
  });
});

describe('newline-separated narratives with chat marks', () => {
  // Row eb7b59d4, abridged, with the U+200E marks the register actually holds.
  const input = [
    '‎Credit shop',
    '‎Sealing machine 27,000',
    '‎Pick carton for shop 2,500',
    '‎3Pcs plantain 3,000',
    '‎Bus fuel 50,000',
  ].join('\n');

  const r = splitNarrative(input);

  it('strips the directional marks from every description', () => {
    expect(r.lines.map((l) => l.description)).toEqual([
      'Credit shop Sealing machine',
      'Pick carton for shop',
      '3Pcs plantain',
      'Bus fuel',
    ]);
    for (const l of r.lines) expect(l.description).not.toMatch(/[‎‏]/);
  });

  it('sums the lines', () => {
    expect(formatMinor(r.totalMinor)).toBe('₦82,500.00');
  });
});

describe('what the splitter must NOT do', () => {
  it('leaves an ambiguous group alone rather than guessing', () => {
    // From row 2fa1031f: "Unit subscrib 50,0000" — four digits after the comma.
    // 500,000 or 50,000? Refusing to produce a line is the correct answer.
    const r = splitNarrative('Unit subscrib 50,0000');
    expect(r.lines).toHaveLength(0);
  });

  it('does not invent a total from a figure that is merely large', () => {
    const r = splitNarrative('Chicken breast 181,260 Teriyaki 129,471');
    expect(r.statedTotalMinor).toBeNull();
    expect(r.lines).toHaveLength(2);
  });
});
