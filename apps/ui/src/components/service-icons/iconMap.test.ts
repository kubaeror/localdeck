import { SERVICE_CATALOG } from '@localdeck/shared';
import { describe, expect, it } from 'vitest';
import {
  AWS_ICON_MAP,
  CONSOLE_ICON_KEYS,
  LUCIDE_ICON_MAP,
  lucideIconFor,
  matchVendoredIcon,
  resolveAwsIconUrl,
  tokenizeIconPath,
} from './iconMap';
import type { ServiceIconKey } from './iconMap';

const FAKE_PACK = {
  'Arch_Storage/Res_Amazon-Simple-Storage-Service_Bucket_48.svg': '/icons/s3.svg',
  'Arch_Compute/Res_Amazon-EC2_Instance_48.svg': '/icons/ec2.svg',
  'Arch_Database/Res_Amazon-DynamoDB_Table_48.svg': '/icons/dynamodb.svg',
};

describe('icon map', () => {
  it('has a Lucide fallback for every registry icon key and chrome key', () => {
    for (const service of SERVICE_CATALOG) {
      expect(
        LUCIDE_ICON_MAP[service.iconKey as ServiceIconKey],
        `${service.id} icon`,
      ).toBeDefined();
    }
    for (const chromeKey of CONSOLE_ICON_KEYS) {
      expect(LUCIDE_ICON_MAP[chromeKey], `${chromeKey} icon`).toBeDefined();
    }
  });

  it('keeps the AWS icon map limited to real registry keys', () => {
    const known = new Set<string>([
      ...SERVICE_CATALOG.map((service) => service.iconKey),
      ...CONSOLE_ICON_KEYS,
    ]);
    for (const key of Object.keys(AWS_ICON_MAP)) {
      expect(known.has(key), `${key} is not a known icon key`).toBe(true);
      expect(AWS_ICON_MAP[key as keyof typeof AWS_ICON_MAP]?.endsWith('.svg')).toBe(true);
    }
  });

  it('prefers the mapped official file when the pack provides it', () => {
    const url = resolveAwsIconUrl('dynamodb', FAKE_PACK);
    expect(url).toBe('/icons/dynamodb.svg');
  });

  it('falls back to a tolerant file-name match', () => {
    expect(matchVendoredIcon(FAKE_PACK, 'ec2')).toBe('/icons/ec2.svg');
    expect(matchVendoredIcon(FAKE_PACK, 'dynamodb')).toBe('/icons/dynamodb.svg');
    expect(matchVendoredIcon(FAKE_PACK, 'lambda')).toBeUndefined();
  });

  it('documents why s3 needs the explicit map entry', () => {
    // The official S3 file name spells out "Simple Storage Service", so token
    // matching alone cannot find it — the typed map is what makes S3 work.
    const officialFileName = 'Arch_Storage/Res_Amazon-Simple-Storage-Service_48.svg';
    expect(matchVendoredIcon({ [officialFileName]: '/s.svg' }, 's3')).toBeUndefined();
    expect(AWS_ICON_MAP.s3).toBeDefined();
    expect(resolveAwsIconUrl('s3', { [AWS_ICON_MAP.s3 as string]: '/s.svg' })).toBe('/s.svg');
  });

  it('returns nothing when the pack is not vendored', () => {
    expect(resolveAwsIconUrl('s3', {})).toBeUndefined();
  });

  it('tokenizes official file names, skipping prefixes and sizes', () => {
    // Only the file name is tokenized; the folder and size suffixes are noise.
    expect(tokenizeIconPath('Arch_Compute/Res_Amazon-EC2_Instance_48.svg')).toEqual([
      'ec2',
      'instance',
    ]);
  });

  it('falls back to the default glyph for unknown keys', () => {
    expect(lucideIconFor('not-a-service')).toBeDefined();
    expect(lucideIconFor('not-a-service', 's3')).toBe(LUCIDE_ICON_MAP['s3']);
  });
});
