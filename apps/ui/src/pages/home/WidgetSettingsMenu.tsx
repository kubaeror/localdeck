import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import type { ReactElement } from 'react';

export interface WidgetSettingsMenuProps {
  onRemove: () => void;
}

/** BoardItem settings slot: the standard "remove widget" overflow menu. */
export function WidgetSettingsMenu({ onRemove }: WidgetSettingsMenuProps): ReactElement {
  return (
    <ButtonDropdown
      variant="icon"
      ariaLabel="Widget settings"
      items={[{ id: 'remove', text: 'Remove widget' }]}
      onItemClick={({ detail }) => {
        if (detail.id === 'remove') onRemove();
      }}
    />
  );
}
