import { describe, expect, it } from 'vitest';
import {
  defaultVolumePerformance,
  validateVolumeIops,
  validateVolumeSize,
  validateVolumeThroughput,
  volumeTypeLimit,
} from './limits';

describe('EBS type-aware limits', () => {
  it('enforces the size floor for st1/sc1 and the ceiling for standard', () => {
    expect(validateVolumeSize('st1', 100)).toMatch(/between 125 and 16384 GiB/);
    expect(validateVolumeSize('st1', 125)).toBeNull();
    expect(validateVolumeSize('sc1', 16384)).toBeNull();
    expect(validateVolumeSize('standard', 1025)).toMatch(/between 1 and 1024 GiB/);
    expect(validateVolumeSize('standard', 1024)).toBeNull();
    expect(validateVolumeSize('gp3', 8)).toBeNull();
    expect(validateVolumeSize('io2', 65536)).toBeNull();
    expect(validateVolumeSize('io2', 65537)).toMatch(/between 4 and 65536 GiB/);
  });

  it('rejects non-integer sizes', () => {
    expect(validateVolumeSize('gp3', Number.NaN)).toMatch(/whole GiB/);
    expect(validateVolumeSize('gp3', 8.5)).toMatch(/whole GiB/);
  });

  it('keeps gp3 IOPS inside 3000–16000', () => {
    expect(validateVolumeIops('gp3', 8, 2999)).toMatch(/between 3000 and 16000/);
    expect(validateVolumeIops('gp3', 8, 3000)).toBeNull();
    expect(validateVolumeIops('gp3', 8, 16000)).toBeNull();
    expect(validateVolumeIops('gp3', 8, 16001)).toMatch(/between 3000 and 16000/);
  });

  it('applies the io1/io2 IOPS-per-GiB ratios', () => {
    // io1: 50 IOPS/GiB
    expect(validateVolumeIops('io1', 100, 5000)).toBeNull();
    expect(validateVolumeIops('io1', 100, 5001)).toMatch(/at most 5000 IOPS/);
    // io2: 500 IOPS/GiB
    expect(validateVolumeIops('io2', 100, 50000)).toBeNull();
    expect(validateVolumeIops('io2', 100, 50001)).toMatch(/at most 50000 IOPS/);
  });

  it('validates gp3 throughput and ignores it for other types', () => {
    expect(validateVolumeThroughput('gp3', 124)).toMatch(/between 125 and 1000 MiB\/s/);
    expect(validateVolumeThroughput('gp3', 125)).toBeNull();
    expect(validateVolumeThroughput('gp3', 1000)).toBeNull();
    expect(validateVolumeThroughput('gp3', 1001)).toMatch(/between 125 and 1000 MiB\/s/);
    expect(validateVolumeThroughput('io2', 99999)).toBeNull();
  });

  it('does not require IOPS for types that have none', () => {
    expect(validateVolumeIops('gp2', 8, 1)).toBeNull();
    expect(validateVolumeIops('standard', 8, 1)).toBeNull();
  });

  it('exposes the console defaults used when the type changes', () => {
    expect(defaultVolumePerformance('gp3')).toEqual({ iops: 3000, throughput: 125 });
    expect(defaultVolumePerformance('io1')).toEqual({ iops: 100 });
    expect(defaultVolumePerformance('gp2')).toEqual({});
    expect(volumeTypeLimit('unknown-type').maxSizeGiB).toBe(16384);
  });
});
