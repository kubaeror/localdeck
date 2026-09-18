/**
 * Clipboard access for the console's "Copy … ID" actions. `navigator.clipboard`
 * is missing in insecure contexts and its promise rejects when the browser
 * denies permission, so callers get one rejection path to report in a flashbar
 * instead of a silent no-op.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    throw new Error('The clipboard is not available in this browser context.');
  }
  await navigator.clipboard.writeText(text);
}
