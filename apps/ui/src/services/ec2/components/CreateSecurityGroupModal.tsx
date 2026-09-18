import type { AwsTag } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { TagsEditor } from '../../../components/TagsEditor';
import { createSecurityGroup, listVpcs, type Ec2SecurityGroup, type Ec2Vpc } from '../api';
import { toFriendlyEc2Error } from '../errors';
import {
  SECURITY_GROUP_DESCRIPTION_RULES,
  SECURITY_GROUP_NAME_RULES,
  validateSecurityGroupDescription,
  validateSecurityGroupName,
} from '../naming';

export interface CreateSecurityGroupModalProps {
  /** Preselected VPC; defaults to the account's default VPC. */
  vpcId?: string;
  onDismiss: () => void;
  onCreated: (group: Ec2SecurityGroup) => void;
}

/** The console's "Create security group" form, scoped to one VPC. */
export function CreateSecurityGroupModal({
  vpcId,
  onDismiss,
  onCreated,
}: CreateSecurityGroupModalProps): ReactElement {
  const [vpcs, setVpcs] = useState<readonly Ec2Vpc[]>([]);
  const [selectedVpcId, setSelectedVpcId] = useState<string | null>(vpcId ?? null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<readonly AwsTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const result = await listVpcs();
        if (cancelled) return;
        setVpcs(result);
        setSelectedVpcId(
          (current) =>
            current ?? result.find((vpc) => vpc.isDefault)?.vpcId ?? result[0]?.vpcId ?? null,
        );
      } catch (caught) {
        if (!cancelled) setError(toFriendlyEc2Error(caught).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const vpcOptions = useMemo<readonly SelectProps.Option[]>(
    () =>
      vpcs.map((vpc) => ({
        label: `${vpc.vpcId}${vpc.isDefault ? ' (default)' : ''}`,
        description: vpc.cidrBlock ?? '',
        value: vpc.vpcId,
      })),
    [vpcs],
  );

  const selectedVpc = vpcOptions.find((option) => option.value === selectedVpcId) ?? null;

  const submit = async (): Promise<void> => {
    const nameProblem = validateSecurityGroupName(name);
    const descriptionProblem = validateSecurityGroupDescription(description);
    setNameError(nameProblem);
    setDescriptionError(descriptionProblem);
    if (nameProblem !== null || descriptionProblem !== null) return;
    if (selectedVpcId === null) {
      setError('Choose a VPC for the security group.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createSecurityGroup({
        groupName: name,
        description,
        vpcId: selectedVpcId,
        tags: tags.filter((tag) => tag.Key.trim().length > 0 || tag.Value.trim().length > 0),
      });
      onCreated(created);
    } catch (caught) {
      const friendly = toFriendlyEc2Error(caught, 'groupName');
      if (friendly.field === 'groupName') setNameError(friendly.message);
      else setError(friendly.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      header="Create security group"
      size="large"
      closeAriaLabel="Close create security group"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={loading}
              onClick={() => {
                void submit();
              }}
            >
              Create security group
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form>
        <SpaceBetween size="m">
          {error === null ? null : <Alert type="error">{error}</Alert>}

          <FormField label="VPC" constraintText="LocalStack reports the VPCs in this account.">
            <Select
              selectedOption={selectedVpc}
              options={vpcOptions}
              disabled={loading}
              placeholder="Choose a VPC"
              ariaLabel="VPC"
              onChange={({ detail }) => {
                setSelectedVpcId(detail.selectedOption.value ?? null);
              }}
            />
          </FormField>

          <FormField
            label="Security group name"
            errorText={nameError ?? undefined}
            constraintText={<Box variant="small">{SECURITY_GROUP_NAME_RULES.join(' · ')}</Box>}
          >
            <Input
              value={name}
              autoFocus
              disabled={submitting}
              placeholder="web-servers"
              onChange={({ detail }) => {
                setName(detail.value);
                setNameError(null);
              }}
            />
          </FormField>

          <FormField
            label="Description"
            errorText={descriptionError ?? undefined}
            constraintText={
              <Box variant="small">{SECURITY_GROUP_DESCRIPTION_RULES.join(' · ')}</Box>
            }
          >
            <Input
              value={description}
              disabled={submitting}
              placeholder="Allow HTTP and HTTPS traffic"
              onChange={({ detail }) => {
                setDescription(detail.value);
                setDescriptionError(null);
              }}
            />
          </FormField>

          <TagsEditor
            tags={tags}
            onChange={setTags}
            description="Tags are optional; they are applied to the security group in the same call."
          />
        </SpaceBetween>
      </Form>
    </Modal>
  );
}

export default CreateSecurityGroupModal;
