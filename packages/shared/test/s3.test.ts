import { describe, expect, it } from 'vitest';
import {
  S3_BUCKET_NAME_MAX_LENGTH,
  S3_BUCKET_NAME_PATTERN,
  S3_KEY_MAX_BYTES,
  S3_PROXY_PATHS,
  S3_PUBLIC_ACCESS_ALL_BLOCKED,
  S3_PUBLIC_ACCESS_DEFAULTS,
  isS3KeyWithinLimit,
  s3DownloadPath,
  s3UploadPath,
  utf8ByteLength,
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

describe('S3 naming rules', () => {
  it('exposes the bucket pattern and length used by both apps', () => {
    const pattern = new RegExp(S3_BUCKET_NAME_PATTERN);
    expect(pattern.test('my-bucket')).toBe(true);
    expect(pattern.test('localdeck.verify-1')).toBe(true);
    expect(pattern.test('INVALID_BUCKET')).toBe(false);
    expect(S3_BUCKET_NAME_MAX_LENGTH).toBe(63);
  });

  it('measures keys in UTF-8 bytes, not UTF-16 code units', () => {
    // 400 four-byte emoji are 800 UTF-16 code units but 1600 UTF-8 bytes.
    const emojiKey = '\u{1f600}'.repeat(400);
    expect(emojiKey.length).toBe(800);
    expect(utf8ByteLength(emojiKey)).toBe(1600);
    expect(isS3KeyWithinLimit(emojiKey)).toBe(false);
    expect(S3_KEY_MAX_BYTES).toBe(1024);
  });

  it('accepts ASCII keys at the limit and rejects empty keys', () => {
    expect(isS3KeyWithinLimit('a'.repeat(S3_KEY_MAX_BYTES))).toBe(true);
    expect(isS3KeyWithinLimit('a'.repeat(S3_KEY_MAX_BYTES + 1))).toBe(false);
    expect(isS3KeyWithinLimit('')).toBe(false);
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
