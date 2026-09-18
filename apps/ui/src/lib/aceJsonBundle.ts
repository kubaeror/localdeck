/**
 * Lazily loaded Ace bundle for the JSON editor.
 *
 * Ace is only needed when a user actually edits JSON, so the console imports
 * this module on demand (Vite splits it into its own chunk). Cloudscape's
 * CodeEditor expects the `ace` namespace plus the list of themes the bundle
 * registered.
 */
import ace from 'ace-builds';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/theme-textmate';
import 'ace-builds/src-noconflict/theme-tomorrow_night';

export interface AceJsonBundle {
  /**
   * The Ace namespace Cloudscape's CodeEditor drives (`ace.edit(…)`). Typed
   * against the package's own declarations so a bundle that stops matching
   * the editor contract fails typecheck instead of falling back silently.
   */
  ace: typeof ace;
  themes: { light: readonly string[]; dark: readonly string[] };
}

export function loadAceJsonBundle(): Promise<AceJsonBundle> {
  return Promise.resolve({
    ace,
    themes: { light: ['textmate'], dark: ['tomorrow_night'] },
  });
}
