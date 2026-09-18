import { Board, BoardItem } from '@cloudscape-design/board-components';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import type { ReactElement } from 'react';
import { EmptyState } from '../components/EmptyState';
import { QuickActionsWidget } from './home/QuickActionsWidget';
import { RecentlyVisitedWidget } from './home/RecentlyVisitedWidget';
import { ServiceHealthWidget } from './home/ServiceHealthWidget';
import { BOARD_ITEM_I18N_STRINGS, BOARD_I18N_STRINGS, type ConsoleWidgetProps } from './home/types';
import { useConsoleHomeLayout } from './home/useConsoleHomeLayout';
import { WidgetSettingsMenu } from './home/WidgetSettingsMenu';

function renderWidget(props: ConsoleWidgetProps, widget: string): ReactElement {
  switch (widget) {
    case 'recently-visited':
      return <RecentlyVisitedWidget {...props} />;
    case 'service-health':
      return <ServiceHealthWidget {...props} />;
    case 'quick-actions':
      return <QuickActionsWidget {...props} />;
    default:
      // Only reachable if a stored layout names a widget this build dropped.
      return (
        <BoardItem
          header={<Header variant="h2">Unknown widget</Header>}
          settings={<WidgetSettingsMenu onRemove={props.onRemove} />}
          i18nStrings={BOARD_ITEM_I18N_STRINGS}
        >
          <Box color="text-status-inactive">
            This widget is not part of this LocalDeck release anymore.
          </Box>
        </BoardItem>
      );
  }
}

/**
 * Console Home, built with the Cloudscape board components: draggable,
 * resizable widgets whose layout is remembered per browser.
 */
export function ConsoleHomePage(): ReactElement {
  const layout = useConsoleHomeLayout();

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="An overview of the LocalStack instance this console is bound to."
        >
          Console Home
        </Header>
      }
    >
      <Board
        items={layout.items}
        i18nStrings={BOARD_I18N_STRINGS}
        onItemsChange={({ detail }) => {
          layout.onItemsChange(detail.items);
        }}
        renderItem={(item, actions) =>
          renderWidget(
            {
              onRemove: () => {
                actions.removeItem();
              },
            },
            item.data.widget,
          )
        }
        empty={
          <EmptyState
            title="No widgets on your Console Home"
            description="Every widget was removed. Restore the default layout to see service health, quick actions and your recently visited services again."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  layout.reset();
                }}
              >
                Restore widgets
              </Button>
            }
          />
        }
      />
    </ContentLayout>
  );
}
