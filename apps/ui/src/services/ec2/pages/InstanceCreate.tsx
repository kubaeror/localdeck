import type { ApiError, AwsTag } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Modal from '@cloudscape-design/components/modal';
import Pagination from '@cloudscape-design/components/pagination';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Select from '@cloudscape-design/components/select';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import Toggle from '@cloudscape-design/components/toggle';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreateWizard } from '../../../components/CreateWizard';
import { TagsEditor } from '../../../components/TagsEditor';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  createKeyPair,
  deleteKeyPair,
  getImage,
  listAllImages,
  listAllInstanceTypes,
  listKeyPairs,
  listSecurityGroups,
  listSubnets,
  listVpcs,
  newClientToken,
  runInstances,
  type CreatedEc2KeyPair,
  type Ec2Image,
  type Ec2InstanceType,
  type Ec2KeyPair,
  type Ec2SecurityGroup,
  type Ec2Subnet,
  type Ec2Vpc,
} from '../api';
import { toFriendlyEc2Error } from '../errors';
import {
  defaultVolumePerformance,
  validateVolumeIops,
  validateVolumeSize,
  volumeTypeLimit,
} from '../limits';
import {
  nextDeviceName,
  validateInstanceName,
  validateKeyPairName,
  INSTANCE_NAME_RULES,
  KEY_PAIR_NAME_RULES,
} from '../naming';

const VOLUME_TYPES: readonly SelectProps.Option[] = [
  { label: 'gp3 (General Purpose SSD)', value: 'gp3' },
  { label: 'gp2 (General Purpose SSD, previous generation)', value: 'gp2' },
  { label: 'io1 (Provisioned IOPS SSD)', value: 'io1' },
  { label: 'io2 (Provisioned IOPS SSD, latest generation)', value: 'io2' },
  { label: 'st1 (Throughput Optimized HDD)', value: 'st1' },
  { label: 'sc1 (Cold HDD)', value: 'sc1' },
  { label: 'standard (Magnetic, previous generation)', value: 'standard' },
];

const OWNER_SCOPES: readonly SelectProps.Option[] = [
  { label: 'Amazon images', value: 'amazon' },
  { label: 'Owned by me', value: 'self' },
  { label: 'All images', value: 'all' },
];

const AMI_PAGE_SIZE = 10;
const TYPE_PAGE_SIZE = 15;

interface ExtraVolume {
  rowId: number;
  deviceName: string;
  sizeGiB: number;
  volumeType: string;
  /** Only set for volume types that take an explicit IOPS value. */
  iops?: number;
  deleteOnTermination: boolean;
  encrypted: boolean;
}

/** Downloads the created key pair as a .pem file. */
function downloadKeyMaterial(keyPair: CreatedEc2KeyPair): void {
  const blob = new Blob([keyPair.keyMaterial], { type: 'application/x-pem-file' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${keyPair.keyName}.pem`;
  anchor.click();
  // Firefox needs the object URL to outlive the click handler turn; revoking
  // in the same tick can truncate the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Memory in MiB rendered the way the console does. */
function formatMemory(memoryMiB: number | undefined): string {
  if (memoryMiB === undefined) return '—';
  if (memoryMiB < 1024) return `${memoryMiB} MiB`;
  return `${(memoryMiB / 1024).toFixed(memoryMiB % 1024 === 0 ? 0 : 1)} GiB`;
}

function platformLabel(image: Ec2Image): string {
  if (image.platformDetails !== undefined) return image.platformDetails;
  if (image.platform !== undefined)
    return image.platform === 'windows' ? 'Windows' : image.platform;
  return 'Linux/UNIX';
}

/** The extra-volume problem for one row, or `null` when the row is valid. */
function extraVolumeProblem(volume: ExtraVolume): string | null {
  const sizeProblem = validateVolumeSize(volume.volumeType, volume.sizeGiB);
  if (sizeProblem !== null) return `Additional volume ${volume.deviceName}: ${sizeProblem}`;
  const limit = volumeTypeLimit(volume.volumeType).iops;
  if (limit === undefined) return null;
  if (volume.iops === undefined) {
    return `Additional volume ${volume.deviceName}: enter provisioned IOPS for ${volume.volumeType}.`;
  }
  const iopsProblem = validateVolumeIops(volume.volumeType, volume.sizeGiB, volume.iops);
  return iopsProblem === null ? null : `Additional volume ${volume.deviceName}: ${iopsProblem}`;
}

/**
 * The console's multi-step launch wizard: name and tags, AMI, instance type,
 * key pair, network settings, storage and review, with the right-hand summary
 * column updating on every change. Submitting calls `RunInstances` once, with
 * the Name tag and every extra tag applied in the same call; a key pair created
 * along the way is shown exactly once, like the console's .pem download, and is
 * kept across a failed launch so it can be downloaded, deleted or reused.
 */
export function InstanceCreatePage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [searchParams] = useSearchParams();
  const requestedImageId = searchParams.get('imageId');

  const [name, setName] = useState('');
  const [tags, setTags] = useState<readonly AwsTag[]>([]);

  const [images, setImages] = useState<readonly Ec2Image[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [ownerScope, setOwnerScope] = useState<'amazon' | 'self' | 'all'>('amazon');
  const [imageFilter, setImageFilter] = useState('');
  const [imagePage, setImagePage] = useState(1);
  const [imageId, setImageId] = useState<string | null>(null);

  const [instanceTypes, setInstanceTypes] = useState<readonly Ec2InstanceType[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [typePage, setTypePage] = useState(1);
  const [instanceType, setInstanceType] = useState('t3.micro');

  const [keyPairs, setKeyPairs] = useState<readonly Ec2KeyPair[]>([]);
  const [keyPairMode, setKeyPairMode] = useState<'none' | 'existing' | 'new'>('none');
  const [existingKeyName, setExistingKeyName] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKeyPair, setCreatedKeyPair] = useState<CreatedEc2KeyPair | null>(null);
  const [keyPairRecoveryError, setKeyPairRecoveryError] = useState<string | null>(null);
  const [keyPairDeleting, setKeyPairDeleting] = useState(false);

  const [vpcs, setVpcs] = useState<readonly Ec2Vpc[]>([]);
  const [vpcId, setVpcId] = useState<string | null>(null);
  const [subnets, setSubnets] = useState<readonly Ec2Subnet[]>([]);
  const [subnetId, setSubnetId] = useState<string | null>(null);
  const [securityGroups, setSecurityGroups] = useState<readonly Ec2SecurityGroup[]>([]);
  const [securityGroupIds, setSecurityGroupIds] = useState<readonly string[]>([]);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const [rootSizeGiB, setRootSizeGiB] = useState('8');
  const [rootVolumeType, setRootVolumeType] = useState('gp3');
  const [rootIops, setRootIops] = useState('3000');
  const [rootEncrypted, setRootEncrypted] = useState(false);
  const [deleteRootOnTermination, setDeleteRootOnTermination] = useState(true);
  const [extraVolumes, setExtraVolumes] = useState<readonly ExtraVolume[]>([]);
  const nextRowId = useRef(1);

  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [createdInstanceId, setCreatedInstanceId] = useState<string | null>(null);
  // One token per wizard mount: a retried launch is idempotent on the service
  // side instead of creating a second instance.
  const clientToken = useRef(newClientToken());

  const imagesRequestId = useRef(0);
  const typesRequestId = useRef(0);
  const networkRequestId = useRef(0);

  const loadImages = useCallback(
    async (scope: 'amazon' | 'self' | 'all'): Promise<void> => {
      const requestId = imagesRequestId.current + 1;
      imagesRequestId.current = requestId;
      setImagesLoading(true);
      try {
        let items = await listAllImages(scope === 'all' ? {} : { owners: [scope] });
        if (imagesRequestId.current !== requestId) return;
        // A wizard opened from an AMI outside the current owner scope still
        // preselects that AMI instead of silently falling back to the first.
        if (
          requestedImageId !== null &&
          !items.some((image) => image.imageId === requestedImageId)
        ) {
          try {
            const requested = await getImage(requestedImageId);
            if (imagesRequestId.current !== requestId) return;
            items = [requested, ...items];
          } catch {
            // The requested image is gone; the loaded catalogue stays usable.
          }
        }
        setImages(items);
        setImageId((current) => {
          if (current !== null && items.some((image) => image.imageId === current)) {
            return current;
          }
          if (
            requestedImageId !== null &&
            items.some((image) => image.imageId === requestedImageId)
          ) {
            return requestedImageId;
          }
          return items[0]?.imageId ?? null;
        });
        setImagesError(null);
      } catch (caught) {
        if (imagesRequestId.current !== requestId) return;
        setImagesError(toFriendlyEc2Error(caught).message);
      } finally {
        if (imagesRequestId.current === requestId) setImagesLoading(false);
      }
    },
    [requestedImageId],
  );

  const loadTypes = useCallback(async (): Promise<void> => {
    const requestId = typesRequestId.current + 1;
    typesRequestId.current = requestId;
    setTypesLoading(true);
    try {
      const items = await listAllInstanceTypes();
      if (typesRequestId.current !== requestId) return;
      setInstanceTypes(items);
      setInstanceType((current) =>
        items.some((entry) => entry.instanceType === current)
          ? current
          : (items.find((entry) => entry.instanceType === 't3.micro')?.instanceType ??
            items[0]?.instanceType ??
            current),
      );
      setTypesError(null);
    } catch (caught) {
      if (typesRequestId.current !== requestId) return;
      setTypesError(toFriendlyEc2Error(caught).message);
    } finally {
      if (typesRequestId.current === requestId) setTypesLoading(false);
    }
  }, []);

  const loadNetwork = useCallback(async (selectedVpcId: string | null): Promise<void> => {
    const requestId = networkRequestId.current + 1;
    networkRequestId.current = requestId;
    setNetworkLoading(true);
    try {
      const [subnetList, groupPage] = await Promise.all([
        listSubnets(selectedVpcId === null ? {} : { vpcId: selectedVpcId }),
        listSecurityGroups(
          selectedVpcId === null ? {} : { filters: [{ Name: 'vpc-id', Values: [selectedVpcId] }] },
        ),
      ]);
      if (networkRequestId.current !== requestId) return;
      setSubnets(subnetList);
      setSubnetId((current) =>
        current !== null && subnetList.some((subnet) => subnet.subnetId === current)
          ? current
          : (subnetList.find((subnet) => subnet.isDefaultForAz)?.subnetId ??
            subnetList[0]?.subnetId ??
            null),
      );
      const groups = groupPage.items;
      setSecurityGroups(groups);
      setSecurityGroupIds((current) => {
        const available = new Set(groups.map((group) => group.groupId));
        const kept = current.filter((id) => available.has(id));
        if (kept.length > 0) return kept;
        const fallback = groups.find((group) => group.groupName === 'default');
        return fallback === undefined ? [] : [fallback.groupId];
      });
      setNetworkError(null);
    } catch (caught) {
      if (networkRequestId.current !== requestId) return;
      setNetworkError(toFriendlyEc2Error(caught).message);
    } finally {
      if (networkRequestId.current === requestId) setNetworkLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wizard catalogue fetch
    void loadImages(ownerScope);
  }, [loadImages, ownerScope]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wizard catalogue fetch
    void loadTypes();
  }, [loadTypes]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const pairs = await listKeyPairs();
        if (!cancelled) setKeyPairs(pairs);
      } catch {
        // The key pair step renders "proceed without" when the list is empty.
        if (!cancelled) setKeyPairs([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const result = await listVpcs();
        if (cancelled) return;
        setVpcs(result);
        const next = result.find((vpc) => vpc.isDefault)?.vpcId ?? result[0]?.vpcId ?? null;
        setVpcId((current) => current ?? next);
      } catch (caught) {
        if (!cancelled) setNetworkError(toFriendlyEc2Error(caught).message);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wizard network fetch
    void loadNetwork(vpcId);
  }, [loadNetwork, vpcId]);

  const selectedImage = useMemo(
    () => images.find((image) => image.imageId === imageId) ?? null,
    [images, imageId],
  );

  const selectedSubnet = useMemo(
    () => subnets.find((subnet) => subnet.subnetId === subnetId) ?? null,
    [subnets, subnetId],
  );

  const filteredImages = useMemo(() => {
    const needle = imageFilter.trim().toLowerCase();
    if (needle.length === 0) return images;
    return images.filter((image) =>
      [image.name ?? '', image.imageId, image.description ?? '', image.architecture ?? ''].some(
        (value) => value.toLowerCase().includes(needle),
      ),
    );
  }, [imageFilter, images]);

  const imageArchitecture = selectedImage?.architecture;

  // The AMI's architecture constrains the instance types: an arm64 image can
  // only run on arm64 types (and vice versa).
  const compatibleTypes = useMemo(() => {
    if (imageArchitecture === undefined) return instanceTypes;
    return instanceTypes.filter(
      (type) => type.architecture === undefined || type.architecture === imageArchitecture,
    );
  }, [imageArchitecture, instanceTypes]);

  const filteredTypes = useMemo(() => {
    const needle = typeFilter.trim().toLowerCase();
    if (needle.length === 0) return compatibleTypes;
    return compatibleTypes.filter((type) => type.instanceType.toLowerCase().includes(needle));
  }, [compatibleTypes, typeFilter]);

  const effectiveInstanceType = useMemo(() => {
    if (imageArchitecture === undefined || instanceTypes.length === 0) return instanceType;
    const selected = instanceTypes.find((type) => type.instanceType === instanceType);
    if (selected?.architecture === undefined || selected.architecture === imageArchitecture) {
      return instanceType;
    }
    // The catalogue loaded after the AMI (or the AMI changed): keep the launch
    // valid by falling back to the first compatible type instead of leaving a
    // selection the table cannot even show.
    return compatibleTypes[0]?.instanceType ?? instanceType;
  }, [compatibleTypes, imageArchitecture, instanceType, instanceTypes]);

  const architectureProblem = useMemo(() => {
    if (imageArchitecture === undefined) return null;
    const selected = instanceTypes.find((type) => type.instanceType === effectiveInstanceType);
    if (selected?.architecture === undefined) return null;
    return selected.architecture === imageArchitecture
      ? null
      : `The selected AMI is built for ${imageArchitecture}, but ${effectiveInstanceType} supports ${selected.architecture}. Pick an instance type for ${imageArchitecture}.`;
  }, [effectiveInstanceType, imageArchitecture, instanceTypes]);

  const meaningfulTags = tags.filter(
    (tag) => tag.Key.trim().length > 0 || tag.Value.trim().length > 0,
  );

  const rootDeviceName = selectedImage?.rootDeviceName ?? '/dev/sda1';
  const rootSize = Number.parseInt(rootSizeGiB, 10);
  const rootIopsValue = Number.parseInt(rootIops, 10);
  const rootIopsLimit = volumeTypeLimit(rootVolumeType).iops;

  const rootStorageProblem =
    validateVolumeSize(rootVolumeType, rootSize) ??
    (rootIopsLimit === undefined
      ? null
      : rootIops.trim().length === 0
        ? `Enter provisioned IOPS for the ${rootVolumeType} root volume.`
        : validateVolumeIops(rootVolumeType, rootSize, rootIopsValue));

  const storageProblem =
    rootStorageProblem ??
    extraVolumes.map(extraVolumeProblem).find((problem) => problem !== null) ??
    null;

  const nameProblem = validateInstanceName(name);
  const newKeyPairProblem = keyPairMode === 'new' ? validateKeyPairName(newKeyName) : null;
  const keyPairRecoveryVisible =
    createdInstanceId === null && createdKeyPair !== null && keyPairRecoveryError !== null;

  const selectRootVolumeType = (next: string): void => {
    setRootVolumeType(next);
    const defaults = defaultVolumePerformance(next);
    if (defaults.iops !== undefined) setRootIops(String(defaults.iops));
  };

  const selectExtraVolumeType = (rowId: number, next: string): void => {
    const defaults = defaultVolumePerformance(next);
    setExtraVolumes((current) =>
      current.map((entry) =>
        entry.rowId === rowId ? { ...entry, volumeType: next, iops: defaults.iops } : entry,
      ),
    );
  };

  const removeCreatedKeyPair = async (): Promise<void> => {
    if (createdKeyPair === null || keyPairDeleting) return;
    setKeyPairDeleting(true);
    try {
      await deleteKeyPair(createdKeyPair.keyName);
      flashbar.notify({
        type: 'info',
        header: 'Key pair deleted',
        content: `${createdKeyPair.keyName} can be created again with another name or on the next launch.`,
      });
      setCreatedKeyPair(null);
      setKeyPairRecoveryError(null);
    } catch (caught) {
      flashbar.notify({
        type: 'error',
        header: 'Could not delete the key pair',
        content: toFriendlyEc2Error(caught).message,
      });
    } finally {
      setKeyPairDeleting(false);
    }
  };

  const submit = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    let keyName: string | undefined;
    try {
      if (keyPairMode === 'new') {
        if (createdKeyPair !== null) {
          // A failed launch keeps the created pair; retrying reuses it instead
          // of failing with InvalidKeyPair.Duplicate.
          keyName = createdKeyPair.keyName;
        } else {
          const created = await createKeyPair(newKeyName);
          setCreatedKeyPair(created);
          keyName = created.keyName;
        }
      } else if (keyPairMode === 'existing' && existingKeyName !== null) {
        keyName = existingKeyName;
      }

      const instance = await runInstances({
        imageId: imageId ?? '',
        instanceType: effectiveInstanceType,
        clientToken: clientToken.current,
        tags: [
          ...(name.trim().length === 0 ? [] : [{ Key: 'Name', Value: name.trim() }]),
          ...meaningfulTags.filter((tag) => tag.Key !== 'Name'),
        ],
        ...(keyName === undefined ? {} : { keyName }),
        ...(subnetId === null ? {} : { subnetId }),
        securityGroupIds,
        ...(selectedSubnet?.availabilityZone === undefined
          ? {}
          : { availabilityZone: selectedSubnet.availabilityZone }),
        volumeTags: [
          {
            Key: 'Name',
            Value: `${name.trim().length === 0 ? 'instance' : name.trim()}-root`,
          },
        ],
        blockDevices: [
          {
            deviceName: rootDeviceName,
            sizeGiB: rootSize,
            volumeType: rootVolumeType,
            deleteOnTermination: deleteRootOnTermination,
            encrypted: rootEncrypted,
            ...(rootIopsLimit === undefined ? {} : { iops: rootIopsValue }),
          },
          ...extraVolumes.map((volume) => ({
            deviceName: volume.deviceName,
            sizeGiB: volume.sizeGiB,
            volumeType: volume.volumeType,
            deleteOnTermination: volume.deleteOnTermination,
            encrypted: volume.encrypted,
            ...(volume.iops === undefined ? {} : { iops: volume.iops }),
          })),
        ],
      });

      flashbar.notify({
        type: 'info',
        header: 'Launch request submitted',
        content: `${instance.instanceId} is starting; the instance page refreshes automatically.`,
      });
      setKeyPairRecoveryError(null);
      setCreatedInstanceId(instance.instanceId);
    } catch (caught) {
      const friendly = toFriendlyEc2Error(caught);
      setError({ ...friendly.apiError, message: friendly.message });
      // A pair created before the failure is kept: the user sees the private
      // key once and can download it, delete it, or retry with the same pair.
      if (keyPairMode === 'new' && keyName !== undefined) {
        setKeyPairRecoveryError(friendly.message);
      }
      if (friendly.field === 'imageId') setActiveStepIndex(1);
      if (friendly.field === 'instanceType') setActiveStepIndex(2);
      if (friendly.field === 'keyName') setActiveStepIndex(3);
      if (friendly.field === 'network' || friendly.field === 'securityGroups') {
        setActiveStepIndex(4);
      }
      if (friendly.field === 'storage') setActiveStepIndex(5);
      if (friendly.field === 'name') setActiveStepIndex(0);
    } finally {
      setSubmitting(false);
    }
  };

  const leave = (): void => {
    navigate(`${serviceConsolePath(descriptor.id)}/instances`);
  };

  const imageColumns: readonly TableProps.ColumnDefinition<Ec2Image>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      cell: (image) => image.name ?? '—',
    },
    {
      id: 'imageId',
      header: 'AMI ID',
      cell: (image) => <Box variant="code">{image.imageId}</Box>,
    },
    { id: 'architecture', header: 'Architecture', cell: (image) => image.architecture ?? '—' },
    { id: 'platform', header: 'Platform', cell: (image) => platformLabel(image) },
    {
      id: 'owner',
      header: 'Owner',
      cell: (image) => image.ownerAlias ?? image.ownerId ?? '—',
    },
    {
      id: 'rootDeviceType',
      header: 'Root device type',
      cell: (image) => image.rootDeviceType ?? '—',
    },
  ];

  const typeColumns: readonly TableProps.ColumnDefinition<Ec2InstanceType>[] = [
    {
      id: 'instanceType',
      header: 'Instance type',
      isRowHeader: true,
      cell: (type) => <Box variant="code">{type.instanceType}</Box>,
    },
    { id: 'vCpus', header: 'vCPUs', cell: (type) => type.vCpus ?? '—' },
    { id: 'memory', header: 'Memory', cell: (type) => formatMemory(type.memoryMiB) },
    { id: 'architecture', header: 'Architecture', cell: (type) => type.architecture ?? '—' },
    {
      id: 'storage',
      header: 'Instance storage',
      cell: (type) => type.instanceStorage ?? 'EBS only',
    },
    {
      id: 'network',
      header: 'Network performance',
      cell: (type) => type.networkPerformance ?? '—',
    },
    {
      id: 'freeTier',
      header: 'Free tier eligible',
      cell: (type) => (type.freeTierEligible === true ? 'Yes' : 'No'),
    },
  ];

  const volumeTypeOptions = [...VOLUME_TYPES];

  const nameStep = (
    <Container header={<Header variant="h2">Name and tags</Header>}>
      <Form>
        <SpaceBetween size="m">
          <FormField
            label="Name"
            description="Sets the Name tag, which is how the console identifies the instance in lists."
            errorText={nameProblem ?? undefined}
            constraintText={<Box variant="small">{INSTANCE_NAME_RULES.join(' · ')}</Box>}
          >
            <Input
              value={name}
              autoFocus
              disabled={submitting}
              placeholder="web-server"
              onChange={({ detail }) => {
                setName(detail.value);
              }}
            />
          </FormField>

          <TagsEditor
            tags={tags}
            onChange={setTags}
            description="Additional tags applied to the instance in the same RunInstances call."
          />
        </SpaceBetween>
      </Form>
    </Container>
  );

  const amiStep = (
    <Container
      header={
        <Header
          variant="h2"
          description="The AMI determines the operating system and the initial root volume. LocalDeck loads the full catalogue LocalStack reports for the selected owner."
          actions={
            <Button
              iconName="refresh"
              ariaLabel="Refresh images"
              loading={imagesLoading}
              onClick={() => {
                void loadImages(ownerScope);
              }}
            />
          }
        >
          Application and OS Images (Amazon Machine Image)
        </Header>
      }
    >
      <SpaceBetween size="m">
        {imagesError === null ? null : <Alert type="error">{imagesError}</Alert>}

        <SpaceBetween direction="horizontal" size="m">
          <FormField label="Image source" stretch>
            <Select
              selectedOption={OWNER_SCOPES.find((option) => option.value === ownerScope) ?? null}
              options={[...OWNER_SCOPES]}
              ariaLabel="Image source"
              onChange={({ detail }) => {
                setOwnerScope(
                  (detail.selectedOption.value ?? 'amazon') as 'amazon' | 'self' | 'all',
                );
                setImagePage(1);
              }}
            />
          </FormField>
        </SpaceBetween>

        <Table<Ec2Image>
          variant="embedded"
          loading={imagesLoading}
          loadingText="Loading images"
          selectionType="single"
          selectedItems={selectedImage === null ? [] : [selectedImage]}
          onSelectionChange={({ detail }) => {
            const next = detail.selectedItems[0];
            if (next !== undefined) setImageId(next.imageId);
          }}
          items={filteredImages.slice((imagePage - 1) * AMI_PAGE_SIZE, imagePage * AMI_PAGE_SIZE)}
          columnDefinitions={imageColumns}
          trackBy={(image) => image.imageId}
          ariaLabels={{ tableLabel: 'Available AMIs', selectionGroupLabel: 'AMI selection' }}
          filter={
            <TextFilter
              filteringText={imageFilter}
              filteringPlaceholder="Find an AMI by name or ID"
              filteringAriaLabel="Filter AMIs"
              countText={`${filteredImages.length} match${filteredImages.length === 1 ? '' : 'es'}`}
              onChange={({ detail }) => {
                setImageFilter(detail.filteringText);
                setImagePage(1);
              }}
            />
          }
          pagination={
            <Pagination
              currentPageIndex={Math.min(
                imagePage,
                Math.max(1, Math.ceil(filteredImages.length / AMI_PAGE_SIZE)),
              )}
              pagesCount={Math.max(1, Math.ceil(filteredImages.length / AMI_PAGE_SIZE))}
              onChange={({ detail }) => {
                setImagePage(detail.currentPageIndex);
              }}
            />
          }
          empty={
            <Box textAlign="center" color="text-body-secondary">
              No images match this source and filter.
            </Box>
          }
        />

        {selectedImage === null ? null : (
          <Alert type="info" header={`Selected: ${selectedImage.name ?? selectedImage.imageId}`}>
            {selectedImage.description ?? 'No description reported by LocalStack.'}
          </Alert>
        )}
      </SpaceBetween>
    </Container>
  );

  const typeStep = (
    <Container
      header={
        <Header
          variant="h2"
          description="The instance type determines CPU, memory and network capacity. LocalDeck loads the full catalogue LocalStack reports."
          actions={
            <Button
              iconName="refresh"
              ariaLabel="Refresh instance types"
              loading={typesLoading}
              onClick={() => {
                void loadTypes();
              }}
            />
          }
        >
          Instance type
        </Header>
      }
    >
      <SpaceBetween size="m">
        {typesError === null ? null : <Alert type="error">{typesError}</Alert>}

        {imageArchitecture === undefined ? null : (
          <Alert type="info">
            Showing instance types that support <strong>{imageArchitecture}</strong>, the
            architecture of the selected AMI.
          </Alert>
        )}

        <Table<Ec2InstanceType>
          variant="embedded"
          loading={typesLoading}
          loadingText="Loading instance types"
          selectionType="single"
          selectedItems={compatibleTypes.filter(
            (type) => type.instanceType === effectiveInstanceType,
          )}
          onSelectionChange={({ detail }) => {
            const next = detail.selectedItems[0];
            if (next !== undefined) setInstanceType(next.instanceType);
          }}
          items={filteredTypes.slice((typePage - 1) * TYPE_PAGE_SIZE, typePage * TYPE_PAGE_SIZE)}
          columnDefinitions={typeColumns}
          trackBy={(type) => type.instanceType}
          ariaLabels={{
            tableLabel: 'Instance types',
            selectionGroupLabel: 'Instance type selection',
          }}
          filter={
            <TextFilter
              filteringText={typeFilter}
              filteringPlaceholder="Find an instance type, for example t3.micro"
              filteringAriaLabel="Filter instance types"
              countText={`${filteredTypes.length} match${filteredTypes.length === 1 ? '' : 'es'}`}
              onChange={({ detail }) => {
                setTypeFilter(detail.filteringText);
                setTypePage(1);
              }}
            />
          }
          pagination={
            <Pagination
              currentPageIndex={Math.min(
                typePage,
                Math.max(1, Math.ceil(filteredTypes.length / TYPE_PAGE_SIZE)),
              )}
              pagesCount={Math.max(1, Math.ceil(filteredTypes.length / TYPE_PAGE_SIZE))}
              onChange={({ detail }) => {
                setTypePage(detail.currentPageIndex);
              }}
            />
          }
          empty={
            <Box textAlign="center" color="text-body-secondary">
              {imageArchitecture === undefined
                ? 'No instance types match this filter.'
                : `No instance type for ${imageArchitecture} matches this filter.`}
            </Box>
          }
        />
      </SpaceBetween>
    </Container>
  );

  const keyPairStep = (
    <Container header={<Header variant="h2">Key pair (login)</Header>}>
      <SpaceBetween size="m">
        <RadioGroup
          value={keyPairMode}
          items={[
            ...(keyPairs.length === 0
              ? []
              : [{ value: 'existing', label: 'Choose an existing key pair' }]),
            {
              value: 'new',
              label: 'Create a new key pair',
              description:
                'LocalDeck creates the pair before launching; the private key is shown once, right after the launch request.',
            },
            {
              value: 'none',
              label: 'Proceed without a key pair',
              description: 'You cannot connect to the instance over SSH without one.',
            },
          ]}
          onChange={({ detail }) => {
            setKeyPairMode(detail.value as 'none' | 'existing' | 'new');
          }}
        />

        {keyPairMode === 'existing' ? (
          <FormField label="Key pair name">
            <Select
              selectedOption={
                keyPairs
                  .map((pair) => ({ label: pair.keyName, value: pair.keyName }))
                  .find((option) => option.value === existingKeyName) ?? null
              }
              options={keyPairs.map((pair) => ({ label: pair.keyName, value: pair.keyName }))}
              placeholder="Choose a key pair"
              ariaLabel="Key pair"
              onChange={({ detail }) => {
                setExistingKeyName(detail.selectedOption.value ?? null);
              }}
            />
          </FormField>
        ) : null}

        {keyPairMode === 'new' ? (
          <FormField
            label="New key pair name"
            errorText={newKeyPairProblem ?? undefined}
            constraintText={<Box variant="small">{KEY_PAIR_NAME_RULES.join(' · ')}</Box>}
            description={
              createdKeyPair === null
                ? undefined
                : `"${createdKeyPair.keyName}" already exists from the previous launch attempt; this wizard reuses it. Delete it to use another name.`
            }
          >
            <Input
              value={newKeyName}
              placeholder="localdeck-key"
              disabled={createdKeyPair !== null}
              onChange={({ detail }) => {
                setNewKeyName(detail.value);
              }}
            />
          </FormField>
        ) : null}

        {createdKeyPair === null ? null : (
          <Alert
            type="warning"
            header="The private key is only shown once"
            action={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  onClick={() => {
                    downloadKeyMaterial(createdKeyPair);
                  }}
                >
                  Download key pair
                </Button>
                <Button
                  loading={keyPairDeleting}
                  onClick={() => {
                    void removeCreatedKeyPair();
                  }}
                >
                  Delete key pair
                </Button>
              </SpaceBetween>
            }
          >
            LocalDeck created{' '}
            <Box variant="code" display="inline">
              {createdKeyPair.keyName}
            </Box>{' '}
            for this launch. Download the .pem now or keep it — retrying the launch reuses it.
          </Alert>
        )}

        <Alert type="info">
          LocalStack stores key pairs like AWS does: the private key material is returned only by
          CreateKeyPair, so LocalDeck shows it before you leave the wizard.
        </Alert>
      </SpaceBetween>
    </Container>
  );

  const networkStep = (
    <Container
      header={
        <Header
          variant="h2"
          description="Choose the VPC, subnet and security groups from the networking LocalStack reports."
          actions={
            <Button
              iconName="refresh"
              ariaLabel="Refresh network"
              loading={networkLoading}
              onClick={() => {
                void loadNetwork(vpcId);
              }}
            />
          }
        >
          Network settings
        </Header>
      }
    >
      <SpaceBetween size="m">
        {networkError === null ? null : <Alert type="error">{networkError}</Alert>}

        <FormField label="VPC">
          <Select
            selectedOption={
              vpcs
                .map((vpc) => ({
                  label: `${vpc.vpcId}${vpc.isDefault ? ' (default)' : ''}`,
                  description: vpc.cidrBlock ?? '',
                  value: vpc.vpcId,
                }))
                .find((option) => option.value === vpcId) ?? null
            }
            options={vpcs.map((vpc) => ({
              label: `${vpc.vpcId}${vpc.isDefault ? ' (default)' : ''}`,
              description: vpc.cidrBlock ?? '',
              value: vpc.vpcId,
            }))}
            disabled={networkLoading}
            placeholder="Choose a VPC"
            ariaLabel="VPC"
            onChange={({ detail }) => {
              setVpcId(detail.selectedOption.value ?? null);
            }}
          />
        </FormField>

        <FormField
          label="Subnet"
          description="The subnet determines the Availability Zone and the address range."
        >
          <Select
            selectedOption={
              subnets
                .map((subnet) => ({
                  label: `${subnet.subnetId}${subnet.isDefaultForAz ? ' (default)' : ''}`,
                  description: `${subnet.availabilityZone ?? 'unknown zone'} · ${subnet.cidrBlock ?? ''}`,
                  value: subnet.subnetId,
                }))
                .find((option) => option.value === subnetId) ?? null
            }
            options={subnets.map((subnet) => ({
              label: `${subnet.subnetId}${subnet.isDefaultForAz ? ' (default)' : ''}`,
              description: `${subnet.availabilityZone ?? 'unknown zone'} · ${subnet.cidrBlock ?? ''}`,
              value: subnet.subnetId,
            }))}
            disabled={networkLoading}
            placeholder="Choose a subnet"
            ariaLabel="Subnet"
            onChange={({ detail }) => {
              setSubnetId(detail.selectedOption.value ?? null);
            }}
          />
        </FormField>

        <SpaceBetween size="xs">
          <Box variant="h3">Security groups</Box>
          <Table<Ec2SecurityGroup>
            variant="embedded"
            loading={networkLoading}
            loadingText="Loading security groups"
            selectionType="multi"
            selectedItems={securityGroups.filter((group) =>
              securityGroupIds.includes(group.groupId),
            )}
            onSelectionChange={({ detail }) => {
              setSecurityGroupIds(detail.selectedItems.map((group) => group.groupId));
            }}
            items={[...securityGroups]}
            columnDefinitions={[
              {
                id: 'groupName',
                header: 'Security group name',
                isRowHeader: true,
                cell: (group) => group.groupName,
              },
              {
                id: 'groupId',
                header: 'Security group ID',
                cell: (group) => <Box variant="code">{group.groupId}</Box>,
              },
              { id: 'description', header: 'Description', cell: (group) => group.description },
            ]}
            trackBy={(group) => group.groupId}
            ariaLabels={{
              tableLabel: 'Security groups',
              selectionGroupLabel: 'Security group selection',
            }}
            empty={
              <Box textAlign="center" color="text-body-secondary">
                This VPC has no security groups.
              </Box>
            }
          />
        </SpaceBetween>
      </SpaceBetween>
    </Container>
  );

  const storageStep = (
    <Container header={<Header variant="h2">Configure storage</Header>}>
      <SpaceBetween size="l">
        <SpaceBetween size="m">
          <Box variant="h3">Root volume ({rootDeviceName})</Box>
          <SpaceBetween direction="horizontal" size="m">
            <FormField
              label="Size (GiB)"
              errorText={rootStorageProblem ?? undefined}
              constraintText={
                rootVolumeType === 'st1' || rootVolumeType === 'sc1'
                  ? 'st1/sc1 volumes start at 125 GiB.'
                  : undefined
              }
            >
              <Input
                value={rootSizeGiB}
                inputMode="numeric"
                ariaLabel="Root volume size"
                onChange={({ detail }) => {
                  setRootSizeGiB(detail.value);
                }}
              />
            </FormField>
            <FormField label="Volume type">
              <Select
                selectedOption={
                  volumeTypeOptions.find((option) => option.value === rootVolumeType) ?? null
                }
                options={volumeTypeOptions}
                ariaLabel="Root volume type"
                onChange={({ detail }) => {
                  selectRootVolumeType(detail.selectedOption.value ?? 'gp3');
                }}
              />
            </FormField>
            {rootIopsLimit === undefined ? null : (
              <FormField
                label="Provisioned IOPS"
                description={`${rootVolumeType} supports ${rootIopsLimit.min}–${rootIopsLimit.max} IOPS.`}
              >
                <Input
                  value={rootIops}
                  inputMode="numeric"
                  ariaLabel="Root volume IOPS"
                  onChange={({ detail }) => {
                    setRootIops(detail.value);
                  }}
                />
              </FormField>
            )}
          </SpaceBetween>
          <SpaceBetween size="xs">
            <Checkbox
              checked={deleteRootOnTermination}
              onChange={({ detail }) => {
                setDeleteRootOnTermination(detail.checked);
              }}
            >
              Delete on termination
            </Checkbox>
            <Toggle
              checked={rootEncrypted}
              onChange={({ detail }) => {
                setRootEncrypted(detail.checked);
              }}
            >
              Encrypt the root volume
            </Toggle>
          </SpaceBetween>
        </SpaceBetween>

        <SpaceBetween size="m">
          <Box variant="h3">Additional volumes</Box>
          <Table<ExtraVolume>
            variant="embedded"
            items={[...extraVolumes]}
            columnDefinitions={[
              {
                id: 'device',
                header: 'Device name',
                isRowHeader: true,
                cell: (volume) => <Box variant="code">{volume.deviceName}</Box>,
              },
              {
                id: 'size',
                header: 'Size (GiB)',
                cell: (volume) => (
                  <Input
                    value={String(volume.sizeGiB)}
                    inputMode="numeric"
                    ariaLabel={`Size of ${volume.deviceName}`}
                    onChange={({ detail }) => {
                      const parsed = Number.parseInt(detail.value, 10);
                      setExtraVolumes((current) =>
                        current.map((entry) =>
                          entry.rowId === volume.rowId
                            ? { ...entry, sizeGiB: Number.isNaN(parsed) ? 0 : parsed }
                            : entry,
                        ),
                      );
                    }}
                  />
                ),
              },
              {
                id: 'type',
                header: 'Volume type',
                cell: (volume) => (
                  <Select
                    selectedOption={
                      volumeTypeOptions.find((option) => option.value === volume.volumeType) ?? null
                    }
                    options={volumeTypeOptions}
                    ariaLabel={`Volume type of ${volume.deviceName}`}
                    onChange={({ detail }) => {
                      selectExtraVolumeType(volume.rowId, detail.selectedOption.value ?? 'gp3');
                    }}
                  />
                ),
              },
              {
                id: 'iops',
                header: 'IOPS',
                cell: (volume) =>
                  volumeTypeLimit(volume.volumeType).iops === undefined ? (
                    '—'
                  ) : (
                    <Input
                      value={volume.iops === undefined ? '' : String(volume.iops)}
                      inputMode="numeric"
                      ariaLabel={`Provisioned IOPS of ${volume.deviceName}`}
                      onChange={({ detail }) => {
                        const parsed = Number.parseInt(detail.value, 10);
                        setExtraVolumes((current) =>
                          current.map((entry) =>
                            entry.rowId === volume.rowId
                              ? {
                                  ...entry,
                                  iops:
                                    detail.value.trim().length === 0 || Number.isNaN(parsed)
                                      ? undefined
                                      : parsed,
                                }
                              : entry,
                          ),
                        );
                      }}
                    />
                  ),
              },
              {
                id: 'delete',
                header: 'Delete on termination',
                cell: (volume) => (
                  <Checkbox
                    checked={volume.deleteOnTermination}
                    ariaLabel={`Delete ${volume.deviceName} on termination`}
                    onChange={({ detail }) => {
                      setExtraVolumes((current) =>
                        current.map((entry) =>
                          entry.rowId === volume.rowId
                            ? { ...entry, deleteOnTermination: detail.checked }
                            : entry,
                        ),
                      );
                    }}
                  >
                    {volume.deleteOnTermination ? 'Yes' : 'No'}
                  </Checkbox>
                ),
              },
              {
                id: 'encrypted',
                header: 'Encryption',
                cell: (volume) => (
                  <Checkbox
                    checked={volume.encrypted}
                    ariaLabel={`Encrypt ${volume.deviceName}`}
                    onChange={({ detail }) => {
                      setExtraVolumes((current) =>
                        current.map((entry) =>
                          entry.rowId === volume.rowId
                            ? { ...entry, encrypted: detail.checked }
                            : entry,
                        ),
                      );
                    }}
                  >
                    {volume.encrypted ? 'Encrypted' : 'Not encrypted'}
                  </Checkbox>
                ),
              },
              {
                id: 'actions',
                header: 'Actions',
                cell: (volume) => (
                  <Button
                    variant="inline-link"
                    onClick={() => {
                      setExtraVolumes((current) =>
                        current.filter((entry) => entry.rowId !== volume.rowId),
                      );
                    }}
                  >
                    Remove
                  </Button>
                ),
              },
            ]}
            trackBy={(volume) => String(volume.rowId)}
            ariaLabels={{ tableLabel: 'Additional volumes' }}
            empty={
              <Box textAlign="center" color="text-body-secondary">
                No additional volumes. The instance starts with its root volume only.
              </Box>
            }
          />
          <Button
            iconName="add-plus"
            disabled={
              nextDeviceName([
                rootDeviceName,
                ...extraVolumes.map((volume) => volume.deviceName),
              ]) === undefined
            }
            onClick={() => {
              const next = nextDeviceName([
                rootDeviceName,
                ...extraVolumes.map((volume) => volume.deviceName),
              ]);
              if (next === undefined) return;
              setExtraVolumes((current) => [
                ...current,
                {
                  rowId: nextRowId.current++,
                  deviceName: next,
                  sizeGiB: 8,
                  volumeType: 'gp3',
                  iops: defaultVolumePerformance('gp3').iops,
                  deleteOnTermination: false,
                  encrypted: false,
                },
              ]);
            }}
          >
            Add new volume
          </Button>
        </SpaceBetween>
      </SpaceBetween>
    </Container>
  );

  const reviewStep = (
    <Container header={<Header variant="h2">Review and launch</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={1}
          items={[
            { label: 'Name', value: name.trim().length === 0 ? '— (no Name tag)' : name },
            {
              label: 'AMI',
              value:
                selectedImage === null
                  ? 'Not selected'
                  : `${selectedImage.name ?? selectedImage.imageId} (${selectedImage.imageId})`,
            },
            { label: 'Instance type', value: effectiveInstanceType },
            {
              label: 'Key pair',
              value:
                keyPairMode === 'existing'
                  ? (existingKeyName ?? 'Not selected')
                  : keyPairMode === 'new'
                    ? (createdKeyPair?.keyName ?? `${newKeyName} (created on launch)`)
                    : 'None',
            },
            {
              label: 'Network',
              value:
                subnetId === null
                  ? 'Not selected'
                  : `${subnetId}${selectedSubnet?.availabilityZone === undefined ? '' : ` (${selectedSubnet.availabilityZone})`}`,
            },
            {
              label: 'Security groups',
              value:
                securityGroupIds.length === 0
                  ? 'VPC default'
                  : securityGroupIds
                      .map(
                        (id) =>
                          securityGroups.find((group) => group.groupId === id)?.groupName ?? id,
                      )
                      .join(', '),
            },
            {
              label: 'Storage',
              value: `${rootSizeGiB} GiB ${rootVolumeType} root${extraVolumes.length === 0 ? '' : ` + ${extraVolumes.length} additional volume${extraVolumes.length === 1 ? '' : 's'}`}`,
            },
            {
              label: 'Tags',
              value:
                meaningfulTags.length === 0
                  ? 'None'
                  : meaningfulTags.map((tag) => `${tag.Key}=${tag.Value}`).join(', '),
            },
          ]}
        />
        <Alert type="info" header="What happens next">
          LocalDeck sends one RunInstances call with these settings. LocalStack creates the instance
          and reports it through DescribeInstances; the instance list and detail page refresh
          automatically while the state settles.
        </Alert>
      </SpaceBetween>
    </Container>
  );

  const instancePath =
    createdInstanceId === null
      ? `${serviceConsolePath(descriptor.id)}/instances`
      : `${serviceConsolePath(descriptor.id)}/instances/${encodeURIComponent(createdInstanceId)}`;

  return (
    <>
      <CreateWizard
        title="Launch instance"
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Instances', href: `${serviceConsolePath(descriptor.id)}/instances` },
          { text: 'Launch instance' },
        ]}
        activeStepIndex={activeStepIndex}
        steps={[
          {
            id: 'name',
            title: 'Name and tags',
            description: 'Name the instance and add tags.',
            validate: () => nameProblem,
            content: nameStep,
          },
          {
            id: 'ami',
            title: 'Application and OS Images',
            description: 'Choose the AMI.',
            validate: () => (imageId === null ? 'Select an AMI to continue.' : null),
            content: amiStep,
          },
          {
            id: 'type',
            title: 'Instance type',
            description: 'Choose CPU and memory.',
            validate: () =>
              instanceType.length === 0 ? 'Select an instance type.' : architectureProblem,
            content: typeStep,
          },
          {
            id: 'key-pair',
            title: 'Key pair',
            description: 'Choose how to log in.',
            validate: () => {
              if (keyPairMode === 'new') {
                return createdKeyPair === null ? newKeyPairProblem : null;
              }
              if (keyPairMode === 'existing' && existingKeyName === null) {
                return 'Select a key pair or proceed without one.';
              }
              return null;
            },
            content: keyPairStep,
          },
          {
            id: 'network',
            title: 'Network settings',
            description: 'VPC, subnet and security groups.',
            validate: () =>
              vpcId === null
                ? 'Select a VPC.'
                : subnetId === null
                  ? 'Select a subnet.'
                  : networkError,
            content: networkStep,
          },
          {
            id: 'storage',
            title: 'Configure storage',
            description: 'Root and additional volumes.',
            validate: () => storageProblem,
            content: storageStep,
          },
          {
            id: 'review',
            title: 'Summary',
            description: 'Review and launch.',
            content: reviewStep,
          },
        ]}
        summary={[
          { label: 'Service', value: descriptor.displayName },
          { label: 'Name', value: name.trim().length === 0 ? '—' : name },
          { label: 'AMI', value: selectedImage?.name ?? imageId ?? '—' },
          { label: 'Instance type', value: instanceType },
          {
            label: 'Key pair',
            value:
              keyPairMode === 'existing'
                ? (existingKeyName ?? '—')
                : keyPairMode === 'new'
                  ? (createdKeyPair?.keyName ?? `${newKeyName} (new)`)
                  : 'None',
          },
          { label: 'Subnet', value: subnetId ?? '—' },
          {
            label: 'Security groups',
            value:
              securityGroupIds.length === 0 ? 'VPC default' : `${securityGroupIds.length} selected`,
          },
          {
            label: 'Storage',
            value: `${rootSizeGiB} GiB root${extraVolumes.length === 0 ? '' : ` +${extraVolumes.length}`}`,
          },
          { label: 'Tags', value: `${meaningfulTags.length}` },
        ]}
        summaryTitle="Launch summary"
        submitLabel="Launch instance"
        submitting={submitting}
        error={error}
        onSubmit={submit}
        onCancel={leave}
        onStepChange={setActiveStepIndex}
      />

      {createdInstanceId === null ? null : (
        <Modal
          visible
          onDismiss={() => {
            navigate(instancePath);
          }}
          header={
            createdKeyPair === null
              ? 'Launch request submitted'
              : 'Launch request submitted — save your private key'
          }
          size={createdKeyPair === null ? 'medium' : 'large'}
          closeAriaLabel="Close launch summary"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                {createdKeyPair === null ? null : (
                  <Button
                    onClick={() => {
                      downloadKeyMaterial(createdKeyPair);
                    }}
                  >
                    Download key pair
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={() => {
                    navigate(instancePath);
                  }}
                >
                  View instance
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="m">
            <Alert type="success" header={`${createdInstanceId} is starting`}>
              LocalStack accepted the launch request. The instance page refreshes automatically
              while the state settles.
            </Alert>

            {createdKeyPair === null ? null : (
              <SpaceBetween size="s">
                <Alert type="warning" header="This is the only time the private key is shown">
                  Store{' '}
                  <Box variant="code" display="inline">
                    {createdKeyPair.keyName}.pem
                  </Box>{' '}
                  now. LocalStack cannot return the key material again.
                </Alert>
                <FormField label="Private key material">
                  <Box variant="code">
                    <textarea
                      readOnly
                      value={createdKeyPair.keyMaterial}
                      rows={6}
                      aria-label="Private key material"
                      style={{ width: '100%', fontFamily: 'monospace' }}
                    />
                  </Box>
                </FormField>
              </SpaceBetween>
            )}
          </SpaceBetween>
        </Modal>
      )}

      {keyPairRecoveryVisible ? (
        <Modal
          visible
          onDismiss={() => {
            setKeyPairRecoveryError(null);
          }}
          header="Launch failed — save your private key"
          size="large"
          closeAriaLabel="Close launch failure summary"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  onClick={() => {
                    if (createdKeyPair !== null) downloadKeyMaterial(createdKeyPair);
                  }}
                >
                  Download key pair
                </Button>
                <Button
                  loading={keyPairDeleting}
                  onClick={() => {
                    void removeCreatedKeyPair();
                  }}
                >
                  Delete key pair
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setKeyPairRecoveryError(null);
                  }}
                >
                  Back to the wizard
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="m">
            <Alert type="error" header="The launch request failed">
              {keyPairRecoveryError}
            </Alert>

            {createdKeyPair === null ? null : (
              <>
                <Alert type="warning" header="This is the only time the private key is shown">
                  LocalDeck created{' '}
                  <Box variant="code" display="inline">
                    {createdKeyPair.keyName}
                  </Box>{' '}
                  before the launch failed. Download it now, or keep it — the wizard reuses this
                  pair on the next launch attempt instead of creating a duplicate.
                </Alert>
                <FormField label="Private key material">
                  <Box variant="code">
                    <textarea
                      readOnly
                      value={createdKeyPair.keyMaterial}
                      rows={6}
                      aria-label="Private key material"
                      style={{ width: '100%', fontFamily: 'monospace' }}
                    />
                  </Box>
                </FormField>
              </>
            )}
          </SpaceBetween>
        </Modal>
      ) : null}
    </>
  );
}

export default InstanceCreatePage;
