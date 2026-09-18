import type { S3PublicAccessBlock } from '@localdeck/shared';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useMemo, type ReactElement } from 'react';

interface SettingRow {
  id: keyof S3PublicAccessBlock;
  description: string;
}

const ROWS: readonly SettingRow[] = [
  { id: 'BlockPublicAcls', description: 'PUT calls with public ACLs are blocked' },
  { id: 'IgnorePublicAcls', description: 'Any existing public ACLs are ignored' },
  { id: 'BlockPublicPolicy', description: 'PUT calls with public bucket policies are blocked' },
  {
    id: 'RestrictPublicBuckets',
    description: 'Public buckets only allow requests from trusted AWS services',
  },
];

export interface PublicAccessBlockSettingsProps {
  /** The four settings as they would be stored. */
  settings: S3PublicAccessBlock;
  label?: string;
}

/**
 * Read-only rendering of the four Block Public Access settings, used by the
 * create wizard and the Permissions tab.
 */
export function PublicAccessBlockSettings({
  settings,
  label = 'Block Public Access settings',
}: PublicAccessBlockSettingsProps): ReactElement {
  const columns = useMemo<readonly TableProps.ColumnDefinition<SettingRow>[]>(
    () => [
      {
        id: 'setting',
        header: 'Setting',
        isRowHeader: true,
        cell: (row) => <Box variant="code">{row.id}</Box>,
      },
      { id: 'description', header: 'Effect', cell: (row) => row.description },
      {
        id: 'status',
        header: 'Status',
        width: 120,
        cell: (row) => {
          const on = settings[row.id];
          return (
            <StatusIndicator type={on ? 'success' : 'stopped'}>{on ? 'On' : 'Off'}</StatusIndicator>
          );
        },
      },
    ],
    [settings],
  );

  return (
    <Table<SettingRow>
      variant="embedded"
      ariaLabels={{ tableLabel: label, selectionGroupLabel: `${label} selection` }}
      items={[...ROWS]}
      columnDefinitions={columns}
      trackBy={(row) => row.id}
    />
  );
}

export default PublicAccessBlockSettings;
