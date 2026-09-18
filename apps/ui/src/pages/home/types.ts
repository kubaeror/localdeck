import type { BoardProps } from '@cloudscape-design/board-components/board';
import type { BoardItemProps } from '@cloudscape-design/board-components/board-item';

/** The widgets Console Home ships with. */
export type ConsoleWidgetId = 'recently-visited' | 'service-health' | 'quick-actions';

export interface ConsoleWidgetData {
  widget: ConsoleWidgetId;
}

export type ConsoleWidgetItem = BoardProps.Item<ConsoleWidgetData>;

export interface ConsoleWidgetProps {
  /** Removes the widget from the board (BoardItem settings menu). */
  onRemove: () => void;
}

/** Board announcements, required by the board components. */
export const BOARD_I18N_STRINGS: BoardProps.I18nStrings<ConsoleWidgetData> = {
  liveAnnouncementDndStarted: (operationType) => `Dragging started: ${operationType}.`,
  liveAnnouncementDndItemReordered: () => 'Widget moved. Use the arrow keys to move it further.',
  liveAnnouncementDndItemResized: () => 'Widget resized. Use the arrow keys to resize it further.',
  liveAnnouncementDndItemInserted: () => 'Widget inserted.',
  liveAnnouncementDndCommitted: (operationType) => `Widget ${operationType} saved.`,
  liveAnnouncementDndDiscarded: (operationType) => `Widget ${operationType} discarded.`,
  liveAnnouncementItemRemoved: (operation) => `Widget ${operation.item.id} removed.`,
  navigationAriaLabel: 'Console Home widgets',
  navigationItemAriaLabel: (item) => (item === null ? 'Widget' : `Widget ${item.id}`),
};

export const BOARD_ITEM_I18N_STRINGS: BoardItemProps.I18nStrings = {
  dragHandleAriaLabel: 'Drag handle',
  dragHandleAriaDescription: 'Use the arrow keys to move the widget on the board.',
  dragHandleTooltipText: 'Drag to move the widget',
  resizeHandleAriaLabel: 'Resize handle',
  resizeHandleAriaDescription: 'Use the arrow keys to resize the widget.',
  resizeHandleTooltipText: 'Drag to resize the widget',
};
