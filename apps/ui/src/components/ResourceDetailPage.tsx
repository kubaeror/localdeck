import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Tabs from '@cloudscape-design/components/tabs';
import { useState, type ReactElement, type ReactNode } from 'react';
import { ConsoleBreadcrumbs, type ConsoleBreadcrumb } from './ConsoleBreadcrumbs';

export interface ResourceDetailTab {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

export interface ResourceDetailPageProps {
  /** Resource name (h1) — usually the identifier the user opened. */
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs: readonly ConsoleBreadcrumb[];
  tabs: readonly ResourceDetailTab[];
  /** Rendered next to the title, typically a StatusBadge. */
  status?: ReactNode;
  headerActions?: ReactNode;
  /** Rendered above the tabs: flashbars, alerts, warnings. */
  notifications?: ReactNode;
  loading?: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  /** Controlled tab selection; otherwise the first tab is active. */
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  /** Optional content rendered between the header and the tabs. */
  children?: ReactNode;
}

/**
 * The console's detail page: breadcrumbs, header with status and actions, and
 * tabbed content. Modules pass one tab per view (overview, configuration,
 * monitoring, tags, raw JSON, …).
 */
export function ResourceDetailPage({
  title,
  description,
  breadcrumbs,
  tabs,
  status,
  headerActions,
  notifications,
  loading = false,
  error = null,
  onRetry,
  activeTabId,
  onTabChange,
  children,
}: ResourceDetailPageProps): ReactElement {
  const [internalTabId, setInternalTabId] = useState<string | undefined>(tabs[0]?.id);
  const selectedTabId = activeTabId ?? internalTabId ?? tabs[0]?.id;

  return (
    <ContentLayout
      breadcrumbs={<ConsoleBreadcrumbs items={breadcrumbs} />}
      header={
        <Header variant="h1" description={description} actions={headerActions}>
          {title}
          {status === undefined ? null : <> {status}</>}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {notifications}

        {error === null ? null : (
          <Alert
            type="error"
            header="Could not load this resource"
            action={onRetry === undefined ? undefined : <Button onClick={onRetry}>Retry</Button>}
          >
            {error.message}
          </Alert>
        )}

        {children}

        {loading ? (
          <Box textAlign="center" padding="l">
            <Spinner size="large" />
          </Box>
        ) : (
          <Tabs
            tabs={tabs.map((tab) => ({
              id: tab.id,
              label: tab.label,
              content: tab.content,
              ...(tab.disabled === true ? { disabled: true } : {}),
              ...(tab.disabledReason === undefined ? {} : { disabledReason: tab.disabledReason }),
            }))}
            activeTabId={selectedTabId}
            onChange={({ detail }) => {
              if (activeTabId === undefined) setInternalTabId(detail.activeTabId);
              onTabChange?.(detail.activeTabId);
            }}
          />
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
