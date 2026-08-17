// ─────────────────────────────────────────────────────────────────────────────
// Paste-to-lines.
//
// Staff compose expense lists in a chat app and paste the whole thing into one
// description box, because entering fifteen expenses one at a time on a phone
// is miserable. Rather than reject the paste, split it for them.
//
// The splitter walks the text finding amounts, and treats the prose between
// one amount and the previous one as that amount's description. A trailing
// "Total amount 922,340" is recognised as a stated total to reconcile against,
// not as another line.
// ─────────────────────────────────────────────────────────────────────────────

import { parseMoney, isMoneyError, formatMinor } from '@/lib/money';
import { normaliseText } from '@/lib/expenseValidation';

/**
 * Numbers below this are read as quantities ("2 bags", "1 bag wings"), not
 * amounts, unless they carry a thousands separator.
 */
const AMOUNT_FLOOR = 100;

/** A number followed by one of these is a quantity: "10kg", "2 crates". */
const UNIT_AFTER =
  /^\s*(?:kg|kgs|g|gr|gram|grams|kilo|kilos|l|ltr|ltrs|litre|litres|liter|liters|ml|cl|cm|pc|pcs|piece|pieces|bag|bags|pack|packs|packet|packets|crate|crates|carton|cartons|tin|tins|box|boxes|bottle|bottles|dozen|dozens|plate|plates|cup|cups|tuber|tubers|paint|paints|rubber|rubbers|derica|congo|mudu|sachet|sachets|roll|rolls|yard|yards|%|x)\b/i;

/** A description that is really a total line. */
const TOTAL_PHRASE =
  /(?:^|\b)(?:grand\s*total|sub\s*total|total\s*amount|total\s*sum|total|sum\s*total|altogether|all\s*together)\s*(?:is|=|:|-|—)?\s*$/i;

/**
 * Candidate numbers, with or without a currency marker, and with an optional
 * "k" meaning thousands.
 *
 * The k must not be followed by a letter, so "50k" is fifty thousand while
 * "10kg" stays a quantity.
 */
const NUMBER_RE =
  /(?:₦|NGN)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*([kK])?(?![a-zA-Z0-9])/g;

/**
 * Repair the separator notations that actually appear in these narratives
 * before anything is scanned. Every substitution preserves or shortens length
 * predictably, and the whole chunk is normalised in one pass, so the character
 * offsets used to slice descriptions stay consistent afterwards.
 *
 * Observed in the live payables register:
 *   "1 Bag of fillet 183, 890"   space after the thousands comma
 *   "Total amount 1,373, 250"    same, in a stated total
 *   "5 Packs of laps 29,,840"    doubled comma
 *   "Chicken wings 160'000"      apostrophe as the separator
 */
function normaliseSeparators(text: string): string {
  return text
    .replace(/(\d),,+(\d)/g, '$1,$2')           // 29,,840  -> 29,840
    .replace(/(\d)'(\d{3})(?!\d)/g, '$1,$2')    // 160'000  -> 160,000
    .replace(/(\d),[ \t]+(\d{3})(?!\d)/g, '$1,$2'); // 183, 890 -> 183,890
}

export interface SplitLine {
  description: string;
  /** The amount exactly as it appeared in the text. */
  amountRaw: string;
  amountMinor: bigint;
}

export interface SplitResult {
  lines: SplitLine[];
  /** A "Total amount …" found in the text, if any. */
  statedTotalMinor: bigint | null;
  statedTotalRaw: string | null;
  /** Sum of the detected lines. */
  totalMinor: bigint;
  /** True when there is no stated total, or the lines match it. */
  reconciles: boolean;
  /** Trailing prose with no amount attached to it. */
  leftover: string;
  /** Ready-made summary for the preview UI. */
  message: string;
}

interface Hit {
  raw: string;
  start: number;
  end: number;
  minor: bigint;
}

/** Find the numbers in a chunk that are plausibly amounts rather than quantities. */
function findAmounts(text: string): Hit[] {
  const hits: Hit[] = [];
  NUMBER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_RE.exec(text)) !== null) {
    const raw = m[1];
    const kSuffix = !!m[2];
    const after = text.slice(m.index + m[0].length);
    if (!kSuffix && UNIT_AFTER.test(after)) continue; // "10kg", "2 crates" — a quantity

    const grouped = raw.includes(',');
    const value = Number(raw.replace(/,/g, ''));
    // A "k" makes it money regardless of size: "50k" is fifty thousand, and
    // this register is full of them.
    if (!kSuffix && !grouped && !(value >= AMOUNT_FLOOR)) continue;

    const parsed = parseMoney(raw, { allowZero: true });
    if (isMoneyError(parsed)) continue;

    hits.push({
      raw: kSuffix ? `${raw}k` : raw,
      start: m.index,
      end: m.index + m[0].length,
      minor: kSuffix ? parsed.minor * 1000n : parsed.minor,
    });
  }
  return hits;
}

/** Trim connective punctuation and filler left at the edges of a description. */
const tidy = (s: string): string =>
  normaliseText(s)
    .replace(/^[\s,;:.\-–—+&/]+/, '')
    .replace(/[\s,;:.\-–—+&/]+$/, '')
    .replace(/^(?:and|plus|also|then)\s+/i, '')
    .trim();

/**
 * Split a pasted narrative into one line per purchase.
 *
 * Handles both shapes staff actually produce: a single run-on paragraph, and
 * one purchase per newline.
 */
export function splitNarrative(input: string): SplitResult {
  const text = normaliseSeparators(String(input ?? '').replace(/\r\n?/g, '\n'));
  const chunks = text.split(/\n+/).map((c) => c.trim()).filter(Boolean);

  const lines: SplitLine[] = [];
  let statedTotalMinor: bigint | null = null;
  let statedTotalRaw: string | null = null;
  let carried = ''; // prose from a chunk that had no amount of its own
  let leftover = '';

  for (const chunk of chunks) {
    const hits = findAmounts(chunk);

    if (hits.length === 0) {
      carried = carried ? `${carried} ${chunk}` : chunk;
      continue;
    }

    // A single amount in this chunk. Text before the amount names it; if there
    // is none ("50,000 bus fuel") the text after it does instead. Anything
    // trailing a description that already has one is a note, not part of it.
    if (hits.length === 1) {
      const h = hits[0];
      const before = tidy(`${carried} ${chunk.slice(0, h.start)}`);
      const after = tidy(chunk.slice(h.end));
      carried = '';

      const desc = before || after;
      const note = before ? after : '';

      if (TOTAL_PHRASE.test(desc) || /^total\b/i.test(desc)) {
        statedTotalMinor = h.minor;
        statedTotalRaw = h.raw;
      } else {
        lines.push({ description: desc, amountRaw: h.raw, amountMinor: h.minor });
      }
      if (note) carried = note;
      continue;
    }

    // Several amounts in one run of prose: the text before each amount, back
    // to the end of the previous one, is that amount's description.
    let cursor = 0;
    for (const h of hits) {
      const rawDesc = `${carried} ${chunk.slice(cursor, h.start)}`;
      carried = '';
      const desc = tidy(rawDesc);
      cursor = h.end;

      if (TOTAL_PHRASE.test(desc)) {
        statedTotalMinor = h.minor;
        statedTotalRaw = h.raw;
        continue;
      }
      lines.push({ description: desc, amountRaw: h.raw, amountMinor: h.minor });
    }
    const tail = tidy(chunk.slice(cursor));
    if (tail) carried = tail;
  }

  leftover = tidy(carried);

  const totalMinor = lines.reduce<bigint>((s, l) => s + l.amountMinor, 0n);
  const reconciles = statedTotalMinor === null || statedTotalMinor === totalMinor;

  const n = lines.length;
  const message =
    n === 0
      ? 'No separate amounts found in that text.'
      : statedTotalMinor === null
        ? `${n} line${n === 1 ? '' : 's'} totalling ${formatMinor(totalMinor)}.`
        : reconciles
          ? `${n} line${n === 1 ? '' : 's'} totalling ${formatMinor(totalMinor)} — matches the stated total.`
          : `${n} line${n === 1 ? '' : 's'} totalling ${formatMinor(totalMinor)}, but the stated total is ${formatMinor(statedTotalMinor)}. Check the lines before saving.`;

  return { lines, statedTotalMinor, statedTotalRaw, totalMinor, reconciles, leftover, message };
}

/** Worth offering the splitter? */
export const isSplittable = (text: string): boolean => splitNarrative(text).lines.length >= 2;
