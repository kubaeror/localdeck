import type { ServiceCategory } from '@localdeck/shared';
import { createElement, useMemo, type ReactElement } from 'react';
import { lucideIconFor, resolveAwsIconUrl } from './service-icons/iconMap';

const PIXELS_BY_SIZE = {
  small: 16,
  normal: 20,
  medium: 24,
  large: 32,
} as const;

export type ServiceIconSize = keyof typeof PIXELS_BY_SIZE;

/** Category → icon key, for icons rendered without a service context. */
const CATEGORY_ICON_KEY: Readonly<Record<ServiceCategory, string>> = {
  Compute: 'ec2',
  Containers: 'ecs',
  Storage: 's3',
  Database: 'dynamodb',
  'Networking & CDN': 'cloudfront',
  'Security Identity & Compliance': 'iam',
  'Application Integration': 'sqs',
  Analytics: 'cloudwatch',
  'Management & Governance': 'cloudformation',
  'Developer Tools': 'codebuild',
  'Machine Learning': 'sagemaker',
};

export interface ServiceIconProps {
  /** Registry icon key, usually the service id (s3, lambda, …). */
  iconKey: string;
  /** Category fallback when the icon key has no dedicated glyph. */
  category?: ServiceCategory;
  size?: ServiceIconSize;
  /** Accessible name. Omit for icons that are decorative next to a label. */
  label?: string;
}

/**
 * Renders a service icon: the official AWS Architecture Icon when the asset
 * pack provides one, otherwise a Lucide glyph (size- and colour-matched, never
 * a recoloured official file).
 */
export function ServiceIcon({
  iconKey,
  category,
  size = 'normal',
  label,
}: ServiceIconProps): ReactElement {
  const pixels = PIXELS_BY_SIZE[size];
  const awsIconUrl = useMemo(() => resolveAwsIconUrl(iconKey), [iconKey]);

  if (awsIconUrl !== undefined) {
    return (
      <img
        className="service-icon"
        data-service-icon="aws"
        data-icon-key={iconKey}
        src={awsIconUrl}
        alt={label ?? ''}
        aria-hidden={label === undefined ? true : undefined}
        width={pixels}
        height={pixels}
      />
    );
  }

  const Glyph = lucideIconFor(
    iconKey,
    // Unknown icon keys fall back to their category's glyph.
    category === undefined ? undefined : CATEGORY_ICON_KEY[category],
  );

  return (
    <span
      className="service-icon"
      data-service-icon="lucide"
      data-icon-key={iconKey}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      {createElement(Glyph, { size: pixels, strokeWidth: 1.6, 'aria-hidden': true })}
    </span>
  );
}
