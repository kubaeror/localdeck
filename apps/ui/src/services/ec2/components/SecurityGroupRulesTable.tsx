import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import type { ReactElement } from 'react';
import type { Ec2SecurityGroupRule } from '../api';

/** One rendered rule: the source columns plus the raw rule for revoking. */
interface RuleRow {
  rowId: string;
  rule: Ec2SecurityGroupRule;
  protocol: string;
  ports: string;
  source: string;
  description: string;
}

function protocolLabel(protocol: string): string {
  if (protocol === '-1') return 'All traffic';
  if (protocol === 'icmp' || protocol === 'icmpv6') return protocol.toUpperCase();
  return protocol.toUpperCase();
}

function portLabel(rule: Ec2SecurityGroupRule): string {
  if (rule.protocol === '-1') return 'All';
  if (rule.fromPort === undefined && rule.toPort === undefined) return 'All';
  if (rule.fromPort === rule.toPort || rule.toPort === undefined)
    return String(rule.fromPort ?? 'All');
  return `${String(rule.fromPort ?? 'All')} - ${String(rule.toPort)}`;
}

function sourceLabel(rule: Ec2SecurityGroupRule): string {
  const parts = [
    ...rule.ipv4Ranges,
    ...rule.ipv6Ranges,
    ...rule.prefixListIds,
    ...rule.referencedGroups,
  ];
  return parts.length === 0 ? '—' : parts.join(', ');
}

function toRows(rules: readonly Ec2SecurityGroupRule[]): readonly RuleRow[] {
  return rules.map((rule, index) => ({
    rowId: `${rule.protocol}-${String(rule.fromPort ?? 'all')}-${String(index)}`,
    rule,
    protocol: protocolLabel(rule.protocol),
    ports: portLabel(rule),
    source: sourceLabel(rule),
    description: rule.description ?? '—',
  }));
}

export interface SecurityGroupRulesTableProps {
  rules: readonly Ec2SecurityGroupRule[];
  /** `Inbound` or `Outbound`; labels the Source/Destination column. */
  direction: 'inbound' | 'outbound';
  loading?: boolean;
  /** When provided, every rule gets a Revoke action (inbound rules only). */
  onRevoke?: (rule: Ec2SecurityGroupRule) => void;
  revoking?: boolean;
}

/**
 * One direction of a security group's rules, in the console's shape: type,
 * port range, source/destination and description. Shared by the security group
 * detail page and the instance detail Security tab.
 */
export function SecurityGroupRulesTable({
  rules,
  direction,
  loading = false,
  onRevoke,
  revoking = false,
}: SecurityGroupRulesTableProps): ReactElement {
  const rows = toRows(rules);
  const sourceHeader = direction === 'inbound' ? 'Source' : 'Destination';

  const columns: readonly TableProps.ColumnDefinition<RuleRow>[] = [
    {
      id: 'type',
      header: 'Type',
      isRowHeader: true,
      cell: (row) => row.protocol,
    },
    {
      id: 'ports',
      header: 'Port range',
      cell: (row) => row.ports,
    },
    {
      id: 'source',
      header: sourceHeader,
      cell: (row) => <Box variant="code">{row.source}</Box>,
    },
    {
      id: 'description',
      header: 'Description',
      cell: (row) => row.description,
    },
    ...(onRevoke === undefined
      ? []
      : [
          {
            id: 'actions',
            header: 'Actions',
            minWidth: '110px',
            cell: (row: RuleRow) => (
              <Button
                variant="inline-link"
                loading={revoking}
                onClick={() => {
                  onRevoke(row.rule);
                }}
              >
                Revoke
              </Button>
            ),
          },
        ]),
  ];

  return (
    <Table<RuleRow>
      variant="embedded"
      loading={loading}
      loadingText={`Loading ${direction} rules`}
      items={[...rows]}
      columnDefinitions={columns}
      trackBy={(row) => row.rowId}
      ariaLabels={{ tableLabel: `${direction === 'inbound' ? 'Inbound' : 'Outbound'} rules` }}
      empty={
        <Box textAlign="center" color="text-body-secondary">
          {direction === 'inbound'
            ? 'This security group has no inbound rules.'
            : 'This security group has no outbound rules.'}
        </Box>
      }
    />
  );
}

export default SecurityGroupRulesTable;
