import type { CreatedAccessKey } from '../api';

/**
 * A spreadsheet executes a field starting with `=`, `+`, `-`, `@`, tab or
 * carriage return as a formula. IAM names and keys are user input, so the
 * leading apostrophe keeps them literal (CSV formula-injection defense).
 */
function guardFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Quotes one CSV field per RFC 4180. */
function csvField(value: string): string {
  return `"${guardFormula(value).replace(/"/g, '""')}"`;
}

/**
 * The access-key CSV the real console downloads ("Download .csv"), with the
 * header AWS uses. `User name` is empty when the service did not echo it.
 */
export function accessKeyCsv(accessKey: CreatedAccessKey): string {
  const header = ['User name', 'Access key ID', 'Secret access key'];
  const row = [accessKey.userName ?? '', accessKey.accessKeyId, accessKey.secretAccessKey];
  return `${header.map(csvField).join(',')}\n${row.map(csvField).join(',')}\n`;
}
