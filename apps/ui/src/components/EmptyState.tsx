import type { ServiceCategory } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement, ReactNode } from 'react';
import { ServiceIcon } from './ServiceIcon';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** Renders the service glyph above the title. */
  iconKey?: string;
  iconCategory?: ServiceCategory;
  /** Primary action, usually a Button. */
  action?: ReactNode;
  /** Secondary action, usually a Button or a Link. */
  secondaryAction?: ReactNode;
  learnMore?: { text: string; href: string };
}

/**
 * The console's shared empty state: centered glyph, title, explanation and up
 * to two actions. Modules must compose this instead of inventing their own.
 */
export function EmptyState({
  title,
  description,
  iconKey,
  iconCategory,
  action,
  secondaryAction,
  learnMore,
}: EmptyStateProps): ReactElement {
  return (
    <Box textAlign="center" padding={{ vertical: 'xxl', horizontal: 'l' }}>
      <SpaceBetween size="m" alignItems="center">
        {iconKey === undefined ? null : (
          <ServiceIcon iconKey={iconKey} category={iconCategory} size="large" />
        )}
        <Box variant="h3">{title}</Box>
        {description === undefined ? null : (
          <Box variant="p" color="text-body-secondary">
            {description}
          </Box>
        )}
        {action === undefined && secondaryAction === undefined ? null : (
          <div className="empty-state__actions">
            {action}
            {secondaryAction}
          </div>
        )}
        {learnMore === undefined ? null : (
          <Link href={learnMore.href} external externalIconAriaLabel="Opens in a new tab">
            {learnMore.text}
          </Link>
        )}
      </SpaceBetween>
    </Box>
  );
}
