import type { FlashbarProps } from '@cloudscape-design/components/flashbar';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FlashbarContext, type FlashMessage, type FlashMessageInput } from './flashbar-context';

/** Success/info messages disappear on their own; warnings and errors stay. */
const AUTO_DISMISS_MS = 6_000;

let nextMessageId = 0;

function toFlashbarItem(
  message: FlashMessage,
  onDismiss: (id: string) => void,
): FlashbarProps.MessageDefinition {
  const item: FlashbarProps.MessageDefinition = {
    id: message.id,
    type: message.type,
    header: message.header,
    dismissible: message.dismissible ?? true,
    onDismiss: () => {
      onDismiss(message.id);
    },
  };
  if (message.content !== undefined) item.content = message.content;
  if (message.action !== undefined) item.action = message.action;
  return item;
}

/** Schedules the automatic dismissal of one message. Renders nothing. */
function FlashAutoDismiss({
  id,
  delayMs,
  onDismiss,
}: {
  id: string;
  delayMs: number;
  onDismiss: (id: string) => void;
}): null {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onDismiss(id);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [id, delayMs, onDismiss]);

  return null;
}

/** App-wide flashbar state. Rendered by the console shell. */
export function FlashbarProvider({ children }: { children: ReactNode }): ReactElement {
  const [messages, setMessages] = useState<readonly FlashMessage[]>([]);

  const dismiss = useCallback((id: string): void => {
    setMessages((previous) => previous.filter((message) => message.id !== id));
  }, []);

  const notify = useCallback((message: FlashMessageInput): string => {
    nextMessageId += 1;
    const id = `flash-${nextMessageId}`;
    const autoDismissMs =
      message.autoDismissMs ??
      (message.type === 'success' || message.type === 'info' ? AUTO_DISMISS_MS : 0);
    setMessages((previous) => [...previous, { ...message, id, autoDismissMs }]);
    return id;
  }, []);

  const clear = useCallback((): void => {
    setMessages([]);
  }, []);

  const items = useMemo(
    () => messages.map((message) => toFlashbarItem(message, dismiss)),
    [messages, dismiss],
  );

  const value = useMemo(() => ({ items, notify, dismiss, clear }), [items, notify, dismiss, clear]);

  return (
    <FlashbarContext.Provider value={value}>
      {children}
      {messages.map((message) =>
        message.autoDismissMs === undefined || message.autoDismissMs <= 0 ? null : (
          <FlashAutoDismiss
            key={message.id}
            id={message.id}
            delayMs={message.autoDismissMs}
            onDismiss={dismiss}
          />
        ),
      )}
    </FlashbarContext.Provider>
  );
}
