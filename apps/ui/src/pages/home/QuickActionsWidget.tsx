import { BoardItem } from '@cloudscape-design/board-components';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlashbar } from '../../hooks/useFlashbar';
import { useGlobalSearch } from '../../hooks/useGlobalSearch';
import { useRecentlyVisited } from '../../hooks/useRecentlyVisited';
import {
  ALL_SERVICES_PATH,
  LOCALSTACK_SERVICES_DOCS_URL,
  SERVICE_HEALTH_PATH,
} from '../../services/paths';
import { BOARD_ITEM_I18N_STRINGS, type ConsoleWidgetProps } from './types';
import { WidgetSettingsMenu } from './WidgetSettingsMenu';

/** Console Home widget: the console-level shortcuts. */
export function QuickActionsWidget({ onRemove }: ConsoleWidgetProps): ReactElement {
  const navigate = useNavigate();
  const search = useGlobalSearch();
  const flashbar = useFlashbar();
  const { visited, clear } = useRecentlyVisited();

  return (
    <BoardItem
      header={
        <Header variant="h2" description="Everything this console can do today.">
          Quick actions
        </Header>
      }
      settings={<WidgetSettingsMenu onRemove={onRemove} />}
      i18nStrings={BOARD_ITEM_I18N_STRINGS}
    >
      <SpaceBetween size="xs">
        <Button
          iconName="search"
          onClick={() => {
            search.open();
          }}
        >
          Search services (Ctrl+/)
        </Button>
        <Button
          iconName="status-info"
          onClick={() => {
            navigate(SERVICE_HEALTH_PATH);
          }}
        >
          View service health
        </Button>
        <Button
          iconName="list-view"
          onClick={() => {
            navigate(ALL_SERVICES_PATH);
          }}
        >
          Browse all services
        </Button>
        <Button
          iconName="remove"
          disabled={visited.length === 0}
          onClick={() => {
            clear();
            flashbar.notify({
              type: 'success',
              header: 'Recently visited cleared',
              content: 'The Console Home widget no longer lists any services.',
            });
          }}
        >
          Clear recently visited
        </Button>
        <Button href={LOCALSTACK_SERVICES_DOCS_URL} target="_blank" external>
          LocalStack API coverage
        </Button>
      </SpaceBetween>
    </BoardItem>
  );
}
