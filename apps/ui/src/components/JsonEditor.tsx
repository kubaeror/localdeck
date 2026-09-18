import { CodeView } from '@cloudscape-design/code-view';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CodeEditor from '@cloudscape-design/components/code-editor';
import type { CodeEditorProps } from '@cloudscape-design/components/code-editor';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Textarea from '@cloudscape-design/components/textarea';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { AceJsonBundle } from '../lib/aceJsonBundle';
import { parseJson, stringifyJson } from '../lib/json';
import { highlightJson } from './json-highlight';

export interface JsonEditorProps {
  /** The JSON document, as text. */
  value: string;
  /** Providing this makes the editor editable; omit for a read-only view. */
  onChange?: (value: string) => void;
  label?: string;
  description?: ReactNode;
  /** External error (for example from a failed submit). */
  errorText?: ReactNode;
  readOnly?: boolean;
  /** Editor height in lines: rows for the editor, and for the text fallback. */
  rows?: number;
  /** Accessible label for the editor surface. */
  ariaLabel?: string;
  /** Test seam for the lazily imported Ace bundle. */
  loadAce?: () => Promise<AceJsonBundle>;
}

const defaultLoadAce = (): Promise<AceJsonBundle> =>
  import('../lib/aceJsonBundle').then((module) => module.loadAceJsonBundle());

interface JsonCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  rows: number;
  preferences: Partial<CodeEditorProps.Preferences>;
  onPreferencesChange: (preferences: Partial<CodeEditorProps.Preferences>) => void;
  loadAce: () => Promise<AceJsonBundle>;
}

/** Editable JSON surface: Cloudscape CodeEditor on a lazily loaded Ace. */
function JsonCodeEditor({
  value,
  onChange,
  ariaLabel,
  rows,
  preferences,
  onPreferencesChange,
  loadAce,
}: JsonCodeEditorProps): ReactElement {
  const [bundle, setBundle] = useState<AceJsonBundle | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAce()
      .then((loaded) => {
        if (cancelled) return;
        setFailure(null);
        setBundle(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBundle(null);
        setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [loadAce]);

  if (failure !== null) {
    // Editing stays possible even when the editor bundle cannot be loaded, but
    // the user is told why the editor looks basic instead of being left to
    // wonder whether the document itself is the problem.
    return (
      <SpaceBetween size="xs">
        <Textarea
          value={value}
          rows={rows}
          ariaLabel={ariaLabel}
          onChange={(event) => {
            onChange(event.detail.value);
          }}
        />
        <Box variant="small" color="text-status-warning">
          The enhanced JSON editor could not be loaded, so this field falls back to a plain text
          area. {failure}
        </Box>
      </SpaceBetween>
    );
  }

  if (bundle === null) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
      </Box>
    );
  }

  return (
    <CodeEditor
      ace={bundle.ace}
      language="json"
      value={value}
      themes={bundle.themes}
      preferences={preferences}
      onPreferencesChange={(event) => {
        onPreferencesChange(event.detail);
      }}
      onChange={(event) => {
        onChange(event.detail.value);
      }}
      ariaLabel={ariaLabel}
      i18nStrings={{
        loadingState: 'Loading editor',
        errorState: 'The editor could not be loaded',
      }}
    />
  );
}

/**
 * JSON editor: validates as you type, pretty-prints on demand and renders
 * read-only documents through Cloudscape's CodeView.
 */
export function JsonEditor({
  value,
  onChange,
  label,
  description,
  errorText,
  readOnly = false,
  rows = 12,
  ariaLabel,
  loadAce = defaultLoadAce,
}: JsonEditorProps): ReactElement {
  const isEditable = onChange !== undefined && !readOnly;
  const [preferences, setPreferences] = useState<Partial<CodeEditorProps.Preferences>>({
    theme: 'textmate',
    wrapLines: true,
  });

  const parsed = useMemo(() => parseJson(value), [value]);
  const isEmpty = value.trim().length === 0;
  // The document is parsed once per render: the error message and the
  // pretty-printed text are both derived from that single parse, and the
  // pretty-print itself only runs when the document actually changes.
  const jsonError = isEmpty || parsed.ok ? null : parsed.error;
  const pretty = useMemo(() => (parsed.ok ? stringifyJson(parsed.value) : null), [parsed]);
  const canFormat = pretty !== null && !isEmpty;

  const format = useCallback(() => {
    if (onChange === undefined || pretty === null) return;
    onChange(pretty);
  }, [onChange, pretty]);

  const validityText = jsonError === null ? 'Valid JSON' : `Invalid JSON: ${jsonError}`;

  if (!isEditable) {
    return (
      <FormField
        label={label}
        description={description}
        errorText={jsonError === null ? errorText : jsonError}
        constraintText={errorText === undefined ? validityText : undefined}
      >
        <CodeView
          // Valid JSON is shown pretty-printed; invalid text stays as typed so
          // the syntax error is visible where the user made it.
          content={pretty ?? value}
          lineNumbers
          wrapLines
          highlight={highlightJson}
          ariaLabel={ariaLabel ?? label ?? 'JSON document'}
          actions={
            <CopyToClipboard
              variant="icon"
              textToCopy={value}
              copyButtonAriaLabel="Copy JSON"
              copySuccessText="JSON copied"
              copyErrorText="Could not copy the JSON"
            />
          }
        />
      </FormField>
    );
  }

  return (
    <FormField
      label={label}
      description={description}
      errorText={errorText ?? jsonError}
      constraintText={validityText}
      secondaryControl={
        <Button variant="inline-link" onClick={format} disabled={!canFormat}>
          Format JSON
        </Button>
      }
    >
      <JsonCodeEditor
        value={value}
        onChange={onChange}
        ariaLabel={ariaLabel ?? label}
        rows={rows}
        preferences={preferences}
        onPreferencesChange={setPreferences}
        loadAce={loadAce}
      />
    </FormField>
  );
}
