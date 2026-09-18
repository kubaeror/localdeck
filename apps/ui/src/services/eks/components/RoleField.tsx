import Box from '@cloudscape-design/components/box';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { listAllRoles } from '../../iam/api';

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
 * but the console still shows exactly what it sends.
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await listAllRoles();
      setRoles(result.map((role) => ({ roleName: role.roleName, arn: role.arn })));
      setLoadError(null);
    } catch (caught) {
      setLoadError(
        caught instanceof Error && caught.message.length > 0
          ? caught.message
          : 'The IAM role list could not be loaded from LocalStack.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- catalogue fetch for the picker
    void load();
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

  return (
    <FormField
      label={label}
      description={description}
      errorText={errorText}
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
        {manual || roles.length === 0 ? (
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
        {children}
      </SpaceBetween>
    </FormField>
  );
}

export default RoleField;
