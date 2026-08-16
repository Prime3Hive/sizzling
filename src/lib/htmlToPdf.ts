// ─────────────────────────────────────────────────────────────────────────────
// Shared html2canvas capture for the PDF exports (invoice, payslip, staff
// profile).
//
// The naive `html2canvas(el, { scale: 2 })` call works on a desktop browser and
// fails on a phone for three separate reasons, all of which are handled here:
//
//  1. LAYOUT WINDOW. html2canvas re-renders the node inside a cloned iframe
//     sized to `windowWidth`/`windowHeight`, which default to the *device*
//     viewport. On a 375px phone an A4-width (794px) template gets laid out and
//     cropped to 375px, so the export is truncated or blank. Pinning
//     windowWidth to the template's own width makes the capture identical on
//     every device.
//
//  2. SCROLL OFFSET. html2canvas positions the clone using page coordinates. If
//     the user has scrolled — far more likely on a phone, where dialogs scroll
//     internally — the captured region is offset and comes back blank. Pinning
//     scrollX/scrollY to 0 removes that.
//
//  3. CANVAS LIMITS. Mobile Safari refuses to allocate a canvas beyond roughly
//     16.7M pixels (and older iOS caps any single dimension at 4096px). Past
//     the limit the canvas silently comes back blank and `toDataURL` returns
//     "data:," — which then makes jsPDF throw. A long invoice at scale 2 blows
//     straight through that, so the scale is reduced until the canvas fits.
// ─────────────────────────────────────────────────────────────────────────────

/** Iterative-ish cap used by mobile Safari; stay comfortably under it. */
const MAX_CANVAS_PIXELS = 16_000_000;
/** Older iOS caps a single canvas edge here. */
const MAX_CANVAS_EDGE = 4096;

/**
 * Largest scale (up to `preferred`) at which the element still fits inside the
 * platform canvas limits. Never returns less than 1 — below that the output is
 * illegible, and it's better to let the capture fail loudly than to ship an
 * unreadable PDF.
 */
export function safeCaptureScale(width: number, height: number, preferred = 2): number {
  if (width <= 0 || height <= 0) return preferred;

  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  const byEdge = Math.min(MAX_CANVAS_EDGE / width, MAX_CANVAS_EDGE / height);

  return Math.max(1, Math.min(preferred, byArea, byEdge));
}

export interface CaptureOptions {
  /** Preferred device-pixel scale; reduced automatically if the canvas would be too large. */
  scale?: number;
  /** Force the layout width of the cloned document. Defaults to the element's own width. */
  width?: number;
  backgroundColor?: string;
}

/**
 * Render a DOM node to a canvas in a way that behaves identically on desktop
 * and mobile. Throws if the browser hands back an empty canvas.
 */
export async function captureElement(
  el: HTMLElement,
  { scale = 2, width, backgroundColor = "#ffffff" }: CaptureOptions = {},
): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import("html2canvas");

  // offsetWidth/Height are the template's own laid-out box, independent of the
  // device viewport — that is exactly the region we want in the PDF.
  const targetWidth = width ?? (el.offsetWidth || el.scrollWidth);
  const targetHeight = el.offsetHeight || el.scrollHeight;
  const finalScale = safeCaptureScale(targetWidth, targetHeight, scale);

  const canvas = await html2canvas(el, {
    scale: finalScale,
    useCORS: true,
    logging: false,
    backgroundColor,
    width: targetWidth,
    height: targetHeight,
    // (1) and (2) above — make the capture device-independent.
    windowWidth: targetWidth,
    windowHeight: targetHeight,
    scrollX: 0,
    scrollY: 0,
  });

  if (!canvas.width || !canvas.height) {
    throw new Error(
      "The document could not be rendered on this device. Try again on a larger screen.",
    );
  }

  return canvas;
}

/**
 * Save a jsPDF document. `doc.save()` alone is unreliable in mobile Safari,
 * where a programmatic `<a download>` is often ignored; falling back to opening
 * the blob lets the user share/save it through the OS sheet instead of the tap
 * appearing to do nothing.
 */
export function savePdf(doc: { save: (n: string) => void; output: (t: "blob") => Blob }, filename: string) {
  try {
    doc.save(filename);
  } catch {
    const url = URL.createObjectURL(doc.output("blob"));
    const opened = window.open(url, "_blank");
    if (!opened) window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
