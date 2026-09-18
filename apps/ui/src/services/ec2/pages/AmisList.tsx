import type { TableProps } from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import FormField from '@cloudscape-design/components/form-field';
import Link from '@cloudscape-design/components/link';
import Select from '@cloudscape-design/components/select';
import type { SelectProps } from '@cloudscape-design/components/select';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { listImages, type Ec2Image } from '../api';
import { copyTextToClipboard } from '../clipboard';
import { imageStatusName } from '../status';
import { EC2_PAGE_SIZE_OPTIONS } from '../listOptions';

const OWNER_SCOPES: readonly SelectProps.Option[] = [
  { label: 'Amazon images', value: 'amazon' },
  { label: 'Owned by me', value: 'self' },
  { label: 'All images', value: 'all' },
];

/**
 * The console's AMI catalogue: the images the running LocalStack can launch,
 * filtered by owner scope, with a launch action that opens the wizard with the
 * image preselected. The owner filter sits next to the text filter (it filters
 * the list, it is not an alert), and the state renders through the shared
 * indicator with console wording.
 */
export function AmisListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [filteringText, setFilteringText] = useState('');
  const [ownerScope, setOwnerScope] = useState<'amazon' | 'self' | 'all'>('amazon');
  const [reloadToken, setReloadToken] = useState(0);

  const imagePath = useCallback(
    (imageId: string): string =>
      `${serviceConsolePath(descriptor.id)}/amis/${encodeURIComponent(imageId)}`,
    [descriptor.id],
  );

  const launchPath = useCallback(
    (imageId: string): string =>
      `${serviceConsolePath(descriptor.id)}/instances/launch?imageId=${encodeURIComponent(imageId)}`,
    [descriptor.id],
  );

  const copyImageId = useCallback(
    async (imageId: string): Promise<void> => {
      try {
        await copyTextToClipboard(imageId);
        flashbar.notify({ type: 'success', header: 'Copied', content: imageId });
      } catch (caught) {
        flashbar.notify({
          type: 'error',
          header: 'Could not copy the AMI ID',
          content: caught instanceof Error ? caught.message : 'The clipboard is not available.',
        });
      }
    },
    [flashbar],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<Ec2Image>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortingField: 'name',
        isRowHeader: true,
        cell: (image) => (
          <Link
            href={imagePath(image.imageId)}
            onFollow={(event) => {
              event.preventDefault();
              navigate(imagePath(image.imageId));
            }}
          >
            {image.name ?? '—'}
          </Link>
        ),
      },
      {
        id: 'imageId',
        header: 'AMI ID',
        sortingField: 'imageId',
        cell: (image) => (
          <Link
            href={imagePath(image.imageId)}
            onFollow={(event) => {
              event.preventDefault();
              navigate(imagePath(image.imageId));
            }}
          >
            <Box variant="code" display="inline">
              {image.imageId}
            </Box>
          </Link>
        ),
      },
      {
        id: 'architecture',
        header: 'Architecture',
        sortingField: 'architecture',
        cell: (image) => image.architecture ?? '—',
      },
      {
        id: 'platform',
        header: 'Platform',
        cell: (image) => image.platformDetails ?? image.platform ?? 'Linux/UNIX',
      },
      {
        id: 'owner',
        header: 'Owner',
        sortingField: 'ownerAlias',
        cell: (image) => image.ownerAlias ?? image.ownerId ?? '—',
      },
      {
        id: 'creationDate',
        header: 'Creation date',
        sortingField: 'creationDate',
        cell: (image) => formatDateTime(image.creationDate),
      },
      {
        id: 'state',
        header: 'State',
        sortingField: 'state',
        cell: (image) => <StatusBadge status={imageStatusName(image.state)} />,
      },
      {
        id: 'rootDeviceType',
        header: 'Root device type',
        cell: (image) => image.rootDeviceType ?? '—',
      },
    ],
    [imagePath, navigate],
  );

  const isFiltering = filteringText.trim().length > 0;

  return (
    <ResourceListPage<Ec2Image>
      title="AMIs"
      description="Amazon Machine Images define the operating system and initial storage of an instance. LocalStack reports the images it can emulate."
      breadcrumbs={[
        { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
        { text: 'AMIs' },
      ]}
      columns={columns}
      getRowId={(image) => image.imageId}
      reloadToken={reloadToken}
      preferencesId="ec2-amis-list"
      pageSizeOptions={EC2_PAGE_SIZE_OPTIONS}
      fetcher={({ nextToken, signal }) =>
        listImages({
          ...(ownerScope === 'all' ? {} : { owners: [ownerScope] }),
          ...(nextToken === undefined ? {} : { nextToken }),
          ...(signal === undefined ? {} : { signal }),
        })
      }
      filtering={{
        text: filteringText,
        onChange: setFilteringText,
        placeholder: 'Find images by name, ID or architecture',
        match: (image, text) => {
          const needle = text.trim().toLowerCase();
          return [
            image.name ?? '',
            image.imageId,
            image.description ?? '',
            image.architecture ?? '',
            image.ownerAlias ?? '',
          ].some((value) => value.toLowerCase().includes(needle));
        },
      }}
      filterExtras={
        <FormField
          label="Image source"
          description="The owner scope LocalStack filters on for this list."
        >
          <Select
            selectedOption={OWNER_SCOPES.find((option) => option.value === ownerScope) ?? null}
            options={[...OWNER_SCOPES]}
            ariaLabel="Image source"
            onChange={({ detail }) => {
              setOwnerScope((detail.selectedOption.value ?? 'amazon') as 'amazon' | 'self' | 'all');
              setReloadToken((token) => token + 1);
            }}
          />
        </FormField>
      }
      rowActions={(image) => (
        <ButtonDropdown
          variant="icon"
          ariaLabel={`Actions for ${image.imageId}`}
          items={[
            { id: 'launch', text: 'Launch instance from this AMI' },
            { id: 'view', text: 'View details' },
            { id: 'copy', text: 'Copy AMI ID' },
          ]}
          onItemClick={({ detail }) => {
            if (detail.id === 'launch') navigate(launchPath(image.imageId));
            if (detail.id === 'view') navigate(imagePath(image.imageId));
            if (detail.id === 'copy') void copyImageId(image.imageId);
          }}
        />
      )}
      headerActions={
        <InfoTooltip content="LocalStack's CreateImage is not part of the LocalDeck EC2 module, so this image catalogue is read-only.">
          <Button disabled>Create image</Button>
        </InfoTooltip>
      }
      emptyTitle={isFiltering ? 'No matches' : 'No AMIs'}
      emptyDescription={
        isFiltering
          ? 'No AMI matches the current filter. Clear the filter or try another search term.'
          : 'LocalStack reports no images for this owner scope. Switch to All images to see the catalogue.'
      }
    />
  );
}

export default AmisListPage;
