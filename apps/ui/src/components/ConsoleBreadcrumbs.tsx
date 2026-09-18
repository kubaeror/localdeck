import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import type { BreadcrumbGroupProps } from '@cloudscape-design/components/breadcrumb-group';
import { useMemo, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export interface ConsoleBreadcrumb {
  text: string;
  /** Defaults to the current path, which is what the last crumb needs. */
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
      [{ text: 'Console Home', href: '/console/home' }].concat(
        items.map((item) => ({ text: item.text, href: item.href ?? location.pathname })),
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
        navigate(event.detail.href);
      }}
    />
  );
}
