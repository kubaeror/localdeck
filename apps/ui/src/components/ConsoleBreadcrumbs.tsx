import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import type { BreadcrumbGroupProps } from '@cloudscape-design/components/breadcrumb-group';
import { useMemo, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CONSOLE_HOME_PATH } from '../services/paths';

export interface ConsoleBreadcrumb {
  text: string;
  /**
   * Target of a step before the current one. The last crumb is the page the
   * user is on: it needs no href and is rendered as text with `aria-current`.
   */
  href?: string;
}

export interface ConsoleBreadcrumbsProps {
  /** Trail after "Console Home", without the console root. */
  items: readonly ConsoleBreadcrumb[];
}

/** Console Home ancestry plus the trail a module passes in. */
export function ConsoleBreadcrumbs({ items }: ConsoleBreadcrumbsProps): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();

  const trail = useMemo<readonly BreadcrumbGroupProps.Item[]>(
    () =>
      [{ text: 'Console Home', href: CONSOLE_HOME_PATH }].concat(
        items.map((item, index) => {
          const isLast = index === items.length - 1;
          return {
            text: item.text,
            // Only the last (current) crumb defaults to the current path.
            // An intermediate crumb without href is a plain step, never a
            // self-link. Cloudscape renders the last item as text and adds
            // aria-current="page".
            href: item.href ?? (isLast ? location.pathname : ''),
          };
        }),
      ),
    [items, location.pathname],
  );

  return (
    <BreadcrumbGroup
      ariaLabel="Breadcrumbs"
      items={trail}
      onFollow={(event) => {
        if (event.detail.external === true) return;
        event.preventDefault();
        const href = event.detail.href;
        // Empty hrefs belong to text-only steps (Cloudscape renders them as
        // "#"); they must not navigate anywhere.
        if (href.length === 0) return;
        navigate(href);
      }}
    />
  );
}
