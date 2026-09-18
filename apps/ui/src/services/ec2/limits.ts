/**
 * Type-aware EBS limits, shared by the create-volume wizard and the launch
 * wizard's storage step, so both validate a configuration locally instead of
 * letting LocalStack reject it with a generic upstream error.
 *
 * The numbers follow the EBS volume type table: gp3 baseline 3000 IOPS /
 * 125 MiB/s, io1 supports 50 IOPS per GiB, io2 500, st1/sc1 start at 125 GiB
 * and standard (magnetic) stops at 1024 GiB.
 */

export interface VolumeIopsLimit {
  min: number;
  max: number;
  /** gp3/io defaults the console prefills. */
  default: number;
  /** Maximum provisioned IOPS per GiB, when the type has a ratio rule. */
  maxRatio?: number;
}

export interface VolumeThroughputLimit {
  min: number;
  max: number;
  default: number;
}

export interface VolumeTypeLimit {
  minSizeGiB: number;
  maxSizeGiB: number;
  iops?: VolumeIopsLimit;
  throughput?: VolumeThroughputLimit;
}

/** Limits keyed by the `VolumeType` the EC2 API expects. */
export const VOLUME_TYPE_LIMITS: Readonly<Record<string, VolumeTypeLimit>> = {
  gp3: {
    minSizeGiB: 1,
    maxSizeGiB: 16384,
    iops: { min: 3000, max: 16000, default: 3000 },
    throughput: { min: 125, max: 1000, default: 125 },
  },
  gp2: { minSizeGiB: 1, maxSizeGiB: 16384 },
  io1: {
    minSizeGiB: 4,
    maxSizeGiB: 16384,
    iops: { min: 100, max: 64000, default: 100, maxRatio: 50 },
  },
  io2: {
    minSizeGiB: 4,
    maxSizeGiB: 65536,
    iops: { min: 100, max: 65536, default: 100, maxRatio: 500 },
  },
  st1: { minSizeGiB: 125, maxSizeGiB: 16384 },
  sc1: { minSizeGiB: 125, maxSizeGiB: 16384 },
  standard: { minSizeGiB: 1, maxSizeGiB: 1024 },
};

/** Used for an unknown type: the widest range the console accepts. */
const FALLBACK_LIMIT: VolumeTypeLimit = { minSizeGiB: 1, maxSizeGiB: 16384 };

/** Limits for one volume type, falling back to the generic range. */
export function volumeTypeLimit(volumeType: string): VolumeTypeLimit {
  return VOLUME_TYPE_LIMITS[volumeType] ?? FALLBACK_LIMIT;
}

/** Validates a size against the type's floor/ceiling. `null` = valid. */
export function validateVolumeSize(volumeType: string, sizeGiB: number): string | null {
  if (!Number.isInteger(sizeGiB)) return 'Enter the volume size in whole GiB.';
  const limit = volumeTypeLimit(volumeType);
  if (sizeGiB < limit.minSizeGiB || sizeGiB > limit.maxSizeGiB) {
    return `${volumeType} volumes must be between ${limit.minSizeGiB} and ${limit.maxSizeGiB} GiB.`;
  }
  return null;
}

/** Validates IOPS for the type, including the IOPS-per-GiB ratio. */
export function validateVolumeIops(
  volumeType: string,
  sizeGiB: number,
  iops: number,
): string | null {
  const limit = volumeTypeLimit(volumeType).iops;
  if (limit === undefined) return null;
  if (!Number.isInteger(iops)) return 'Enter the provisioned IOPS as a whole number.';
  if (iops < limit.min || iops > limit.max) {
    return `Provisioned IOPS for ${volumeType} must be between ${limit.min} and ${limit.max}.`;
  }
  if (
    limit.maxRatio !== undefined &&
    Number.isInteger(sizeGiB) &&
    sizeGiB > 0 &&
    iops > sizeGiB * limit.maxRatio
  ) {
    return `At ${sizeGiB} GiB, ${volumeType} volumes support at most ${sizeGiB * limit.maxRatio} IOPS (${limit.maxRatio} IOPS per GiB).`;
  }
  return null;
}

/** Validates gp3 throughput; other types do not take an explicit value. */
export function validateVolumeThroughput(volumeType: string, throughput: number): string | null {
  const limit = volumeTypeLimit(volumeType).throughput;
  if (limit === undefined) return null;
  if (!Number.isInteger(throughput)) return 'Enter the throughput as a whole number.';
  if (throughput < limit.min || throughput > limit.max) {
    return `Throughput for ${volumeType} must be between ${limit.min} and ${limit.max} MiB/s.`;
  }
  return null;
}

/** The console's prefilled values for a type, used when switching types. */
export function defaultVolumePerformance(volumeType: string): {
  iops?: number;
  throughput?: number;
} {
  const limit = volumeTypeLimit(volumeType);
  return {
    ...(limit.iops === undefined ? {} : { iops: limit.iops.default }),
    ...(limit.throughput === undefined ? {} : { throughput: limit.throughput.default }),
  };
}
