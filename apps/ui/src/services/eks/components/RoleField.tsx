import Box from '@cloudscape-design/components/box';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { listAllRoles } from '../../iam/api';
import { validateRoleArn } from '../naming';

export interface RoleFieldProps {
  /** Currently selected role ARN (`''` when nothing is selected). */
  value: string;
  onChange: (roleArn: string) => void;
  /** Rendered form-field label, e.g. "Cluster IAM role". */
  label: string;
  description?: string;
  disabled?: boolean;
  /** Form-field error from the wizard/modal. */
  errorText?: string;
  /** Rendered below the field, e.g. a link to create a role. */
  children?: ReactElement;
}

/**
 * IAM role picker shared by the create-cluster wizard and the node group
 * modal. It lists the roles the IAM module reads from LocalStack and offers a
 * manual ARN entry for roles the user has not created through LocalDeck (or
 * for stacks where IAM is not emulated). EKS never validates the role locally,
 * but the console still shows exactly what it sends: a typed ARN must look
 * like a role ARN, and an ARN outside the loaded role list is flagged.
 */
export function RoleField({
  value,
  onChange,
  label,
  description,
  disabled = false,
  errorText,
  children,
}: RoleFieldProps): ReactElement {
  const [roles, setRoles] = useState<readonly { roleName: string; arn: string }[]>([]);
  const [rolesWithoutArn, setRolesWithoutArn] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<void> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      const result = await listAllRoles({ signal: controller.signal });
      if (controller.signal.aborted) return;
      const mapped = result.flatMap((role) =>
        role.arn === undefined ? [] : [{ roleName: role.roleName, arn: role.arn }],
      );
      setRoles(mapped);
      setRolesWithoutArn(result.length - mapped.length);
      setLoadError(null);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setLoadError(
        caught instanceof Error && caught.message.length > 0
          ? caught.message
          : 'The IAM role list could not be loaded from LocalStack.',
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- catalogue fetch for the picker
    void load();
    return () => {
      inFlight.current?.abort();
    };
  }, [load]);

  const options = useMemo<SelectProps.Option[]>(
    () => [
      ...roles.map((role) => ({
        label: role.roleName,
        description: role.arn,
        value: role.arn,
      })),
      { label: 'Enter an ARN manually', value: '__manual__' },
    ],
    [roles],
  );

  const selectedOption = useMemo<SelectProps.Option | null>(() => {
    if (manual) return options.find((option) => option.value === '__manual__') ?? null;
    const match = options.find((option) => option.value === value);
    if (match !== undefined) return match;
    if (value.length > 0) return { label: value, value };
    return null;
  }, [manual, options, value]);

  const trimmed = value.trim();
  const patternProblem = trimmed.length > 0 ? validateRoleArn(trimmed) : null;
  const outsideList = trimmed.length > 0 && !roles.some((role) => role.arn === trimmed);
  const showManualInput = manual || roles.length === 0;

  return (
    <FormField
      label={label}
      description={description}
      errorText={errorText ?? patternProblem ?? undefined}
      constraintText={
        roles.length === 0 && !loading
          ? 'LocalStack reported no IAM roles. Enter the role ARN you provision elsewhere.'
          : undefined
      }
    >
      <SpaceBetween size="xs">
        {loadError === null ? null : (
          <Box variant="small" color="text-status-warning">
            {loadError} You can still enter an ARN manually.
          </Box>
        )}
        {rolesWithoutArn > 0 ? (
          <Box variant="small" color="text-status-warning">
            {rolesWithoutArn} role{rolesWithoutArn === 1 ? '' : 's'} reported without an ARN{' '}
            {rolesWithoutArn === 1 ? 'was' : 'were'} omitted from the list; enter the ARN manually
            instead.
          </Box>
        ) : null}
        <Select
          selectedOption={selectedOption}
          options={options}
          loadingText="Loading IAM roles"
          statusType={loading ? 'loading' : 'finished'}
          disabled={disabled}
          placeholder="Choose an IAM role"
          ariaLabel={label}
          onChange={({ detail }) => {
            if (detail.selectedOption.value === '__manual__') {
              setManual(true);
              return;
            }
            setManual(false);
            onChange(detail.selectedOption.value ?? '');
          }}
        />
        {showManualInput ? (
          <Input
            value={value}
            disabled={disabled}
            placeholder="arn:aws:iam::000000000000:role/eks-cluster-role"
            ariaLabel={`${label} ARN`}
            onChange={({ detail }) => {
              onChange(detail.value);
            }}
          />
        ) : null}
        {outsideList && patternProblem === null ? (
          <Box variant="small" color="text-status-warning">
            This ARN is not one of the {roles.length} roles LocalStack reported. It is sent as
            typed; make sure the role exists before the cluster depends on it.
          </Box>
        ) : null}
        {children}
      </SpaceBetween>
    </FormField>
  );
}

export default RoleField;
