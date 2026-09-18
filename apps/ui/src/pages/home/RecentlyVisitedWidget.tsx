import { BoardItem } from '@cloudscape-design/board-components';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import List from '@cloudscape-design/components/list';
import { useMemo, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { ServiceIcon } from '../../components/ServiceIcon';
import { GLOBAL_SEARCH_SHORTCUT_LABEL } from '../../contexts/global-search-context';
import { useRecentlyVisited } from '../../hooks/useRecentlyVisited';
import { useServiceCatalog } from '../../hooks/useServiceCatalog';
import { formatRelativeTime } from '../../lib/format';
import { ALL_SERVICES_PATH, serviceConsolePath } from '../../services/paths';
import { BOARD_ITEM_I18N_STRINGS, type ConsoleWidgetProps } from './types';
import { WidgetSettingsMenu } from './WidgetSettingsMenu';

/** Console Home widget: the services this browser visited most recently. */
export function RecentlyVisitedWidget({ onRemove }: ConsoleWidgetProps): ReactElement {
  const navigate = useNavigate();
  const { services } = useServiceCatalog();
  const { visited } = useRecentlyVisited();

  const entries = useMemo(() => {
    const byId = new Map(services.map((service) => [service.id, service]));
    return visited.flatMap((entry) => {
      const service = byId.get(entry.id);
      return service === undefined ? [] : [{ ...entry, service }];
    });
  }, [services, visited]);

  return (
    <BoardItem
      header={
        <Header variant="h2" description="Services you opened in this browser.">
          Recently visited
        </Header>
      }
      settings={<WidgetSettingsMenu onRemove={onRemove} />}
      i18nStrings={BOARD_ITEM_I18N_STRINGS}
    >
      {entries.length === 0 ? (
        <EmptyState
          title="Nothing visited yet"
          description={`Open a service from the sidebar, or search with ${GLOBAL_SEARCH_SHORTCUT_LABEL} and it will show up here.`}
          action={
            <Button
              variant="primary"
              onClick={() => {
                navigate(ALL_SERVICES_PATH);
              }}
            >
              Browse all services
            </Button>
          }
        />
      ) : (
        <List
          ariaLabel="Recently visited services"
          items={entries}
          renderItem={(entry) => ({
            id: entry.service.id,
            icon: (
              <ServiceIcon
                iconKey={entry.service.iconKey}
                category={entry.service.category}
                size="small"
              />
            ),
            content: (
              <Link
                href={serviceConsolePath(entry.service.id)}
                onFollow={(event) => {
                  event.preventDefault();
                  navigate(serviceConsolePath(entry.service.id));
                }}
              >
                {entry.service.displayName}
              </Link>
            ),
            secondaryContent: (
              <Box color="text-body-secondary">
                {entry.service.category} · {formatRelativeTime(entry.visitedAt)}
              </Box>
            ),
          })}
        />
      )}
    </BoardItem>
  );
}
