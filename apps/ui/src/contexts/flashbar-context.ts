import type { FlashbarProps } from '@cloudscape-design/components/flashbar';
import { createContext } from 'react';
import type { ReactNode } from 'react';

export type FlashType = NonNullable<FlashbarProps.MessageDefinition['type']>;

export interface FlashMessageInput {
  type: FlashType;
  header: string;
  content?: ReactNode;
  action?: ReactNode;
  dismissible?: boolean;
  /** Overrides the default auto-dismiss delay. `0` keeps the message until dismissed. */
  autoDismissMs?: number;
}

export interface FlashMessage extends FlashMessageInput {
  id: string;
}

export interface FlashbarContextValue {
  /** Ready-to-render items for `<Flashbar />`. */
  items: readonly FlashbarProps.MessageDefinition[];
  notify: (message: FlashMessageInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const FlashbarContext = createContext<FlashbarContextValue | null>(null);

/** Announcement strings for the app-wide flashbar. */
export const FLASHBAR_I18N: FlashbarProps.I18nStrings = {
  ariaLabel: 'Notifications',
  errorIconAriaLabel: 'Error',
  infoIconAriaLabel: 'Information',
  inProgressIconAriaLabel: 'In progress',
  successIconAriaLabel: 'Success',
  warningIconAriaLabel: 'Warning',
};
