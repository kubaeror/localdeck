/**
 * CIDR parsing for the security-group rule modal. A single regex is not enough:
 * `999.999.999.999/99` matches a naive pattern but is not an address, and IPv6
 * prefix widths are measured in 128 bits, not 8-bit octets. These helpers parse
 * the real shape, family-aware, and are unit-tested.
 */

/** Splits `address/prefix`; returns `null` for a missing/extra slash. */
function splitCidr(value: string): { address: string; prefix: string } | null {
  const parts = value.trim().split('/');
  if (parts.length !== 2) return null;
  const address = parts[0] ?? '';
  const prefix = parts[1] ?? '';
  if (address.length === 0 || prefix.length === 0) return null;
  return { address, prefix };
}

/** True for a valid IPv4 CIDR: four 0–255 octets and a prefix of 0–32. */
export function isValidIpv4Cidr(value: string): boolean {
  const split = splitCidr(value);
  if (split === null) return false;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(split.address)) return false;
  const octets = split.address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  if (!/^\d{1,2}$/.test(split.prefix)) return false;
  const width = Number.parseInt(split.prefix, 10);
  return width >= 0 && width <= 32;
}

/**
 * True for a valid IPv6 CIDR: hex groups separated by single colons, at most
 * one `::` run-length marker, and a prefix of 0–128.
 */
export function isValidIpv6Cidr(value: string): boolean {
  const split = splitCidr(value);
  if (split === null) return false;
  if (!/^\d{1,3}$/.test(split.prefix)) return false;
  const width = Number.parseInt(split.prefix, 10);
  if (width < 0 || width > 128) return false;

  const address = split.address;
  if (address.includes(' ') || address.includes('%')) return false;
  const halves = address.split('::');
  if (halves.length > 2) return false;

  const groupsOf = (text: string): string[] => (text.length === 0 ? [] : text.split(':'));
  const groups = [
    ...groupsOf(halves[0] ?? ''),
    ...(halves.length === 2 ? groupsOf(halves[1] ?? '') : []),
  ];
  if (groups.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) return false;

  // `::` stands for at least one zero group, so a compressed address has at
  // most seven explicit groups; an uncompressed one has exactly eight.
  if (halves.length === 2) return groups.length <= 7;
  return groups.length === 8;
}

/** True for the two CIDRs that open a rule to the whole internet. */
export function isWorldOpenCidr(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '0.0.0.0/0' || normalized === '::/0';
}
