import { ApiClientError } from '../../lib/apiClient';
import { describe, expect, it } from 'vitest';
import { friendlyEc2Error, isEc2Code, toFriendlyEc2Error } from './errors';

describe('EC2 error mapping', () => {
  it('places AMI failures on the image field of the launch wizard', () => {
    const friendly = friendlyEc2Error({
      code: 'InvalidAMIID.NotFound',
      statusCode: 400,
      message: 'The image id does not exist',
    });

    expect(friendly.field).toBe('imageId');
    expect(friendly.message).toContain('LocalStack does not have this AMI');
  });

  it('maps the SDK flattening of dotted codes', () => {
    const friendly = friendlyEc2Error({
      code: 'InvalidKeyPairNotFound',
      statusCode: 400,
      message: 'Key pair does not exist',
    });

    expect(friendly.field).toBe('keyName');
    expect(friendly.message).toContain('key pair');
  });

  it('explains that an internal error is a LocalStack limitation, not a LocalDeck bug', () => {
    const friendly = friendlyEc2Error({
      code: 'InternalError',
      statusCode: 502,
      message: 'exception while calling ec2.DetachVolume',
    });

    expect(friendly.message).toContain('limitation of the running emulator');
  });

  it('explains an attached volume cannot be deleted', () => {
    const friendly = toFriendlyEc2Error(
      new ApiClientError({
        code: 'VolumeInUse',
        statusCode: 400,
        message: 'Volume vol-1 is currently attached',
      }),
    );

    expect(friendly.field).toBeNull();
    expect(friendly.message).toContain('still attached');
  });

  it('falls back to the api message for unknown codes', () => {
    const friendly = friendlyEc2Error(
      { code: 'SomethingNew', statusCode: 400, message: 'Upstream said no' },
      'network',
    );

    expect(friendly.message).toBe('Upstream said no');
    expect(friendly.field).toBe('network');
  });

  it('explains the newly mapped upstream volume and rule failures', () => {
    const zone = friendlyEc2Error({
      code: 'InvalidVolumeZoneMismatch',
      statusCode: 400,
      message: 'The volume is not in the same AZ',
    });
    expect(zone.message).toContain('different Availability Zones');

    const duplicate = friendlyEc2Error({
      code: 'InvalidPermission.Duplicate',
      statusCode: 400,
      message: 'The rule already exists',
    });
    expect(duplicate.field).toBe('securityGroups');
    expect(duplicate.message).toContain('identical rule already exists');

    const limit = friendlyEc2Error({
      code: 'RulesPerSecurityGroupLimitExceeded',
      statusCode: 400,
      message: 'Rules limit exceeded',
    });
    expect(limit.message).toContain('rule limit');

    const snapshot = friendlyEc2Error({
      code: 'InvalidSnapshot.NotFound',
      statusCode: 400,
      message: 'Snapshot does not exist',
    });
    expect(snapshot.field).toBe('volumeSize');

    const combination = friendlyEc2Error({
      code: 'InvalidParameterCombination',
      statusCode: 400,
      message: 'Invalid combination',
    });
    expect(combination.message).toContain('combination of parameters');
  });

  it('recognises codes on a caught ApiClientError regardless of the spelling', () => {
    const caught = new ApiClientError({
      code: 'InvalidGroupNotFound',
      statusCode: 404,
      message: 'The security group does not exist',
    });

    expect(isEc2Code(caught, 'InvalidGroup.NotFound')).toBe(true);
    expect(isEc2Code(caught, 'InvalidGroupNotFoundException')).toBe(true);
    expect(isEc2Code(caught, 'VolumeInUse')).toBe(false);
    expect(isEc2Code(new Error('nope'), 'InvalidGroup.NotFound')).toBe(false);
  });
});
