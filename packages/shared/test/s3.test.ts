import { describe, expect, it } from 'vitest';
import {
  S3_PROXY_PATHS,
  S3_PUBLIC_ACCESS_ALL_BLOCKED,
  S3_PUBLIC_ACCESS_DEFAULTS,
  s3DownloadPath,
  s3UploadPath,
} from '../src/index.js';

describe('S3 proxy paths', () => {
  it('encodes the download request into the query string', () => {
    expect(s3DownloadPath({ bucket: 'my-bucket', key: 'folder/report 2026.csv' })).toBe(
      '/api/services/s3/objects/download?bucket=my-bucket&key=folder%2Freport%202026.csv',
    );
  });

  it('adds a version id only when one is set', () => {
    const plain = s3DownloadPath({ bucket: 'b', key: 'k' });
    expect(plain).not.toContain('versionId');

    const versioned = s3DownloadPath({ bucket: 'b', key: 'k', versionId: 'v1' });
    expect(versioned).toContain('versionId=v1');
  });

  it('keeps the download route query-encoded for link use', () => {
    expect(s3DownloadPath({ bucket: 'b', key: 'k' })).toBe(
      '/api/services/s3/objects/download?bucket=b&key=k',
    );
  });

  it('builds the upload target from bucket and key', () => {
    expect(s3UploadPath({ bucket: 'b', key: 'a/b.txt' })).toBe(
      `${S3_PROXY_PATHS.upload}?bucket=b&key=a%2Fb.txt`,
    );
  });
});

describe('Block Public Access presets', () => {
  it('blocks everything when the console toggle is on', () => {
    expect(S3_PUBLIC_ACCESS_ALL_BLOCKED).toEqual({
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    });
  });

  it('matches the console defaults when the toggle is turned off', () => {
    expect(S3_PUBLIC_ACCESS_DEFAULTS).toEqual({
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: false,
      RestrictPublicBuckets: false,
    });
  });
});
