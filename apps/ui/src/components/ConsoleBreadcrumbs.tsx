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

  const trail = useMemo<readonly BreadcrumbGroupProps.Item[]>(() => {
    const steps = items.flatMap((item, index): BreadcrumbGroupProps.Item[] => {
      const isLast = index === items.length - 1;
      const href = item.href !== undefined && item.href.length > 0 ? item.href : undefined;
      // Cloudscape renders every step except the last as an anchor and falls
      // back to href="#", so an intermediate step with no target is omitted
      // instead of becoming a dead link. The current (last) step stays in the
      // trail: Cloudscape renders it as text with aria-current="page" and it
      // defaults to the current path.
      if (!isLast && href === undefined) return [];
      return [{ text: item.text, href: href ?? location.pathname }];
    });
    return [{ text: 'Console Home', href: CONSOLE_HOME_PATH }, ...steps];
  }, [items, location.pathname]);

  return (
    <BreadcrumbGroup
      ariaLabel="Breadcrumbs"
      items={trail}
      onFollow={(event) => {
        if (event.detail.external === true) return;
        event.preventDefault();
        void navigate(event.detail.href);
      }}
    />
  );
}
