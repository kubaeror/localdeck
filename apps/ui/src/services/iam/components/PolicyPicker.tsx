import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Pagination from '@cloudscape-design/components/pagination';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { toApiError } from '../../../lib/apiClient';
import { type IamPolicy, type IamPolicyScope, listPolicies } from '../api';

export interface PolicyPickerProps {
  /** ARNs that are already attached; they are hidden from the candidates. */
  excludeArns?: readonly string[];
  selectedArns: readonly string[];
  onChange: (policyArns: readonly string[]) => void;
  /** Disables the table while a parent operation is running. */
  disabled?: boolean;
}

const PAGE_SIZE = 10;

const SCOPE_OPTIONS: readonly { value: IamPolicyScope; label: string }[] = [
  { value: 'Local', label: 'Customer managed' },
  { value: 'AWS', label: 'AWS managed' },
];

function matches(policy: IamPolicy, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    policy.policyName.toLowerCase().includes(needle) ||
    (policy.arn ?? '').toLowerCase().includes(needle)
  );
}

/**
 * The console's policy picker: a scope selector (customer managed / AWS
 * managed), name filter and a multi-select table, with continuation support for
 * the AWS managed collection. Shared by the attach-policy modal and the
 * create-role / create-group wizards, which is why it owns the candidate list
 * but never performs an attach itself.
 */
export function PolicyPicker({
  excludeArns = [],
  selectedArns,
  onChange,
  disabled = false,
}: PolicyPickerProps): ReactElement {
  const [scope, setScope] = useState<IamPolicyScope>('Local');
  const [items, setItems] = useState<readonly IamPolicy[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [filteringText, setFilteringText] = useState('');
  const [currentPageIndex, setCurrentPageIndex] = useState(1);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(
    async (options: { nextToken?: string; append?: boolean } = {}): Promise<void> => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      if (options.append === true) setLoadingMore(true);
      else setPhase('loading');

      try {
        const page = await listPolicies({
          scope,
          ...(options.nextToken === undefined ? {} : { nextToken: options.nextToken }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setItems((previous) =>
          options.append === true ? [...previous, ...page.items] : page.items,
        );
        setNextToken(page.nextToken);
        setError(null);
        setPhase('ready');
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toApiError(caught));
        setPhase('error');
      } finally {
        if (!controller.signal.aborted) setLoadingMore(false);
      }
    },
    [scope],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- policy picker fetch
    void load();
    return () => {
      inFlight.current?.abort();
    };
  }, [load]);

  const excluded = new Set(excludeArns);
  const candidates = items.filter(
    (policy) => policy.arn === undefined || !excluded.has(policy.arn),
  );
  const filtered = candidates.filter((policy) => matches(policy, filteringText));
  const pagesCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp the page index when the candidates shrink (scope switch, filter,
  // reload, exclusions); otherwise the table renders an out-of-range page.
  const currentPage = Math.min(currentPageIndex, pagesCount);
  const visibleItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const visibleSelected = visibleItems.filter(
    (policy) =>
      policy.isAttachable && policy.arn !== undefined && selectedArns.includes(policy.arn),
  );
  const hiddenSelectedCount = selectedArns.filter(
    (arn) => !visibleItems.some((policy) => policy.arn === arn),
  ).length;

  const columns: readonly TableProps.ColumnDefinition<IamPolicy>[] = [
    {
      id: 'policyName',
      header: 'Policy name',
      sortingField: 'policyName',
      isRowHeader: true,
      cell: (policy) => <Box>{policy.policyName}</Box>,
    },
    {
      id: 'policyType',
      header: 'Type',
      cell: (policy) => (policy.scope === 'AWS' ? 'AWS managed' : 'Customer managed'),
    },
    {
      id: 'attachmentCount',
      header: 'Attached entities',
      cell: (policy) => policy.attachmentCount,
    },
  ];

  if (phase === 'error') {
    return (
      <Alert
        type="error"
        header="Could not load policies"
        action={
          <Button
            onClick={() => {
              void load();
            }}
          >
            Retry
          </Button>
        }
      >
        {error?.message}
      </Alert>
    );
  }

  return (
    <SpaceBetween size="s">
      <SpaceBetween direction="horizontal" size="s">
        <Select
          selectedOption={SCOPE_OPTIONS.find((option) => option.value === scope) ?? null}
          options={[...SCOPE_OPTIONS]}
          disabled={disabled}
          ariaLabel="Policy type"
          onChange={({ detail }) => {
            const next = detail.selectedOption.value;
            if (next === 'Local' || next === 'AWS') {
              setScope(next);
              setFilteringText('');
              setCurrentPageIndex(1);
            }
          }}
        />
        <TextFilter
          filteringText={filteringText}
          filteringPlaceholder="Filter policies by name or ARN"
          filteringAriaLabel="Filter policies"
          countText={`${filtered.length} match${filtered.length === 1 ? '' : 'es'}`}
          disabled={disabled}
          onChange={({ detail }) => {
            setFilteringText(detail.filteringText);
            setCurrentPageIndex(1);
          }}
        />
      </SpaceBetween>

      {selectionNotice === null ? null : <Alert type="warning">{selectionNotice}</Alert>}

      {selectedArns.length > 0 ? (
        <Box variant="small" color="text-body-secondary">
          {selectedArns.length} polic{selectedArns.length === 1 ? 'y' : 'ies'} selected
          {hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} on another page or scope)` : ''}.
        </Box>
      ) : null}

      <Table<IamPolicy>
        variant="embedded"
        loading={phase === 'loading'}
        loadingText="Loading policies"
        items={visibleItems}
        columnDefinitions={columns}
        trackBy={(policy) => policy.arn ?? policy.policyName}
        selectionType="multi"
        selectedItems={visibleSelected}
        ariaLabels={{
          tableLabel: 'Policies',
          selectionGroupLabel: 'Policy selection',
          itemSelectionLabel: (_data, policy) => `Select ${policy.policyName}`,
          allItemsSelectionLabel: () => 'Select all policies on this page',
        }}
        onSelectionChange={({ detail }) => {
          const visibleArns = visibleItems.flatMap((policy) =>
            policy.arn === undefined ? [] : [policy.arn],
          );
          const keptHidden = selectedArns.filter((arn) => !visibleArns.includes(arn));
          const attemptedItems = detail.selectedItems;
          const blocked = attemptedItems.filter(
            (policy) => policy.arn === undefined || !policy.isAttachable,
          );
          setSelectionNotice(
            blocked.length === 0
              ? null
              : `${blocked.length} selected polic${blocked.length === 1 ? 'y is' : 'ies are'} marked IsAttachable=false by LocalStack, or LocalStack did not report an ARN, so ${blocked.length === 1 ? 'it' : 'they'} cannot be attached to an identity.`,
          );
          onChange([
            ...keptHidden,
            ...attemptedItems.flatMap((policy) =>
              policy.arn === undefined || !policy.isAttachable ? [] : [policy.arn],
            ),
          ]);
        }}
        empty={
          <Box textAlign="center" color="text-body-secondary">
            {filteringText.trim().length > 0
              ? 'No policies match the filter.'
              : 'No policies are available in this scope.'}
          </Box>
        }
        pagination={
          <SpaceBetween direction="horizontal" size="xs" alignItems="center">
            <Pagination
              currentPageIndex={currentPage}
              pagesCount={pagesCount}
              onChange={({ detail }) => {
                setCurrentPageIndex(detail.currentPageIndex);
              }}
            />
            {nextToken === undefined ? null : (
              <Button
                loading={loadingMore}
                disabled={disabled}
                onClick={() => {
                  void load({ nextToken, append: true });
                }}
              >
                Load more
              </Button>
            )}
          </SpaceBetween>
        }
        header={
          phase === 'loading' ? null : (
            <Box variant="small" color="text-body-secondary">
              {nextToken === undefined
                ? `${filtered.length} polic${filtered.length === 1 ? 'y' : 'ies'} available.`
                : 'More policies are available from LocalStack.'}
            </Box>
          )
        }
      />
    </SpaceBetween>
  );
}

export default PolicyPicker;
