import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useMemo, useState, type ReactElement } from 'react';
import { updateNodegroupScaling, type EksCluster, type EksNodegroup } from '../api';
import { toFriendlyEksError } from '../errors';
import { parseScalingValue, validateScaling } from '../naming';

export interface UpdateScalingModalProps {
  visible: boolean;
  cluster: EksCluster;
  nodegroup: EksNodegroup;
  onDismiss: () => void;
  /** Called after LocalStack accepted the update (status UPDATING/ACTIVE). */
  onUpdated: (nodegroup: EksNodegroup) => void;
}

/**
 * "Edit scaling" for one node group: min / max / desired. The console sends
 * `UpdateNodegroupConfig`; LocalStack scales the k3d agents and the emulated
 * EC2 instances asynchronously, so the Compute tab keeps polling afterwards.
 */
export function UpdateScalingModal({
  visible,
  cluster,
  nodegroup,
  onDismiss,
  onUpdated,
}: UpdateScalingModalProps): ReactElement {
  const [minSize, setMinSize] = useState(String(nodegroup.scaling.minSize ?? 1));
  const [maxSize, setMaxSize] = useState(String(nodegroup.scaling.maxSize ?? 2));
  const [desiredSize, setDesiredSize] = useState(String(nodegroup.scaling.desiredSize ?? 1));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const scaling = useMemo(
    () => ({
      minSize: parseScalingValue(minSize),
      maxSize: parseScalingValue(maxSize),
      desiredSize: parseScalingValue(desiredSize),
    }),
    [desiredSize, maxSize, minSize],
  );

  const scalingProblem = validateScaling(scaling);

  const submit = async (): Promise<void> => {
    // UpdateNodegroupConfig is not idempotent from the UI's point of view: a
    // double submit would send two overlapping updates.
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateNodegroupScaling({
        clusterName: cluster.name,
        nodegroupName: nodegroup.nodegroupName,
        scaling,
      });
      onUpdated(updated);
    } catch (caught) {
      const friendly = toFriendlyEksError(caught);
      setError({ ...friendly.apiError, message: friendly.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={submitting ? () => undefined : onDismiss}
      header={`Edit scaling for ${nodegroup.nodegroupName}`}
      size="medium"
      closeAriaLabel="Close update scaling"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={submitting} onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={submitting || scalingProblem !== null}
              onClick={() => {
                void submit();
              }}
            >
              Save changes
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {error === null ? null : (
          <Alert type="error" header="Could not update the scaling configuration">
            {error.message}
          </Alert>
        )}

        <Alert type="info">
          LocalStack provisions or removes one k3d agent (and one emulated EC2 instance) per change
          in the desired size. The node group status becomes UPDATING while that happens.
        </Alert>

        <SpaceBetween direction="horizontal" size="m">
          <FormField
            label="Minimum size"
            errorText={scalingProblem ?? undefined}
            description="Nodes the group never scales below."
          >
            <Input
              value={minSize}
              inputMode="numeric"
              disabled={submitting}
              ariaLabel="Minimum size"
              onChange={({ detail }) => {
                setMinSize(detail.value);
              }}
            />
          </FormField>
          <FormField label="Maximum size" description="Nodes the group never exceeds.">
            <Input
              value={maxSize}
              inputMode="numeric"
              disabled={submitting}
              ariaLabel="Maximum size"
              onChange={({ detail }) => {
                setMaxSize(detail.value);
              }}
            />
          </FormField>
          <FormField label="Desired size" description="Nodes to run now.">
            <Input
              value={desiredSize}
              inputMode="numeric"
              disabled={submitting}
              ariaLabel="Desired size"
              onChange={({ detail }) => {
                setDesiredSize(detail.value);
              }}
            />
          </FormField>
        </SpaceBetween>
      </SpaceBetween>
    </Modal>
  );
}

export default UpdateScalingModal;
