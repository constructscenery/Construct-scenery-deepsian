/**
 * Print a PDF straight from the browser — no download / save / open step (Ben, Nov 2026).
 *
 * Loads the PDF into a hidden same-origin iframe (blob: URL) and calls print() on it, which opens the
 * browser's print dialog for the PDF itself (Chrome, Edge, Firefox). If the browser can't print from
 * the iframe (e.g. Safari), the PDF opens in a new tab instead so it can be printed from there; if a
 * pop-up blocker stops that too, it is downloaded as before so nothing is lost.
 *
 * Returns how it was handled so the caller can show the right message.
 */
export type PrintOutcome = 'printed' | 'opened' | 'downloaded';

const REVOKE_AFTER_MS = 60_000; // the print dialog reads the blob asynchronously — keep it alive

export async function printPdfBlob(blob: Blob, fallbackFilename = 'document.pdf'): Promise<PrintOutcome> {
  const pdf = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
  const url = URL.createObjectURL(pdf);
  const cleanupLater = (el?: HTMLElement) => setTimeout(() => { el?.remove(); URL.revokeObjectURL(url); }, REVOKE_AFTER_MS);

  const isSafari = typeof navigator !== 'undefined'
    && /safari/i.test(navigator.userAgent) && !/chrome|chromium|crios|edg|android/i.test(navigator.userAgent);

  if (!isSafari) {
    const printed = await new Promise<boolean>(resolve => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.title = 'Print preview';
      Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
      let settled = false;
      const done = (ok: boolean) => { if (settled) return; settled = true; if (!ok) frame.remove(); resolve(ok); };
      frame.onload = () => {
        // give the PDF viewer a moment to render before printing
        setTimeout(() => {
          try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
            cleanupLater(frame);
            done(true);
          } catch {
            done(false);
          }
        }, 250);
      };
      frame.onerror = () => done(false);
      setTimeout(() => done(false), 15_000); // never hang the button
      frame.src = url;
      document.body.appendChild(frame);
    });
    if (printed) return 'printed';
  }

  // (no 'noopener' feature: with it window.open returns null even when the tab opened)
  const win = window.open(url, '_blank');
  if (win) { try { win.opener = null; } catch { /* ignore */ } cleanupLater(); return 'opened'; }

  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  cleanupLater();
  return 'downloaded';
}

export const printOutcomeMessage = (outcome: PrintOutcome, what: string) =>
  outcome === 'printed'
    ? `Print dialog opened for ${what}`
    : outcome === 'opened'
      ? `${what} opened in a new tab — print it from there`
      : `${what} downloaded (pop-ups are blocked, so it couldn't open for printing)`;
