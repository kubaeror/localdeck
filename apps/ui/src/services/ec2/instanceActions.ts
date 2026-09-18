import type { Ec2Instance } from './api';

/**
 * Lifecycle-action metadata shared by the instances list and the instance
 * detail page, so the two views cannot drift apart in wording or eligibility.
 */

/** The four lifecycle actions the instances list and detail page offer. */
export type InstanceAction = 'start' | 'stop' | 'reboot' | 'terminate';

/** Which lifecycle actions make sense for the instance's current state. */
export function canRunInstanceAction(action: InstanceAction, instance: Ec2Instance): boolean {
  switch (action) {
    case 'start':
      return instance.state === 'stopped';
    case 'stop':
      return instance.state === 'running';
    case 'reboot':
      return instance.state === 'running';
    case 'terminate':
      return instance.state !== 'terminated' && instance.state !== 'shutting-down';
  }
}

/** Menu/button labels for each action. */
export const INSTANCE_ACTION_LABELS: Readonly<Record<InstanceAction, string>> = {
  start: 'Start instance',
  stop: 'Stop instance',
  reboot: 'Reboot instance',
  terminate: 'Terminate instance',
};

/** In-flight wording for the flashbar ("Instance stopping"). */
export const INSTANCE_ACTION_PROGRESS: Readonly<Record<InstanceAction, string>> = {
  start: 'starting',
  stop: 'stopping',
  reboot: 'rebooting',
  terminate: 'terminating',
};

/** The application order both views use for their action menus. */
export const INSTANCE_ACTIONS: readonly InstanceAction[] = ['start', 'stop', 'reboot', 'terminate'];
