import { describe, expect, it } from 'vitest';
import { accessKeyCsv } from './accessKeyCsv';

describe('AccessKeySecret CSV export', () => {
  it('writes the AWS header and one quoted row', () => {
    const csv = accessKeyCsv({
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 's3cret',
      status: 'Active',
      userName: 'alice',
    });

    expect(csv).toBe(
      '"User name","Access key ID","Secret access key"\n"alice","AKIAEXAMPLE","s3cret"\n',
    );
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'prefixes a value starting with %j so spreadsheets do not execute it',
    (lead) => {
      const csv = accessKeyCsv({
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: `${lead}SUM(A1)`,
        status: 'Active',
        userName: 'alice',
      });

      expect(csv).toContain(`"'${lead}SUM(A1)"`);
    },
  );

  it('leaves ordinary values and escaped quotes untouched', () => {
    const csv = accessKeyCsv({
      accessKeyId: 'AKIA"EXAMPLE',
      secretAccessKey: 's3cret=not-a-formula',
      status: 'Active',
      userName: 'alice',
    });

    expect(csv).toContain('"AKIA""EXAMPLE"');
    expect(csv).toContain('"s3cret=not-a-formula"');
  });
});
