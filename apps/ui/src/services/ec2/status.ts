import type { StatusName } from '../../lib/format';

/**
 * Resource-state mappings shared by every EC2 view. Keeping them in one place
 * guarantees a failed resource never renders as a healthy green indicator:
 * `error` stays `error` and anything unrecognized becomes `unknown`, never
 * `available`.
 */

/** Maps an EBS volume state (`DescribeVolumes` `State`) onto status wording. */
export function volumeStatusName(state: string): StatusName {
  switch (state) {
    case 'creating':
    case 'available':
    case 'in-use':
    case 'deleting':
    case 'deleted':
    case 'error':
      return state;
    default:
      return 'unknown';
  }
}

/**
 * Maps an AMI state (`DescribeImages` `State`) onto status wording. The console
 * shows deregistered images as deleted rather than inventing a state.
 */
export function imageStatusName(state: string | undefined): StatusName {
  switch (state) {
    case 'available':
      return 'available';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'deregistered':
      return 'deleted';
    default:
      return 'unknown';
  }
}
