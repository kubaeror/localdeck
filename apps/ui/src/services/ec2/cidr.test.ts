import { describe, expect, it } from 'vitest';
import { isWorldOpenCidr, isValidIpv4Cidr, isValidIpv6Cidr } from './cidr';

describe('isValidIpv4Cidr', () => {
  it('accepts real IPv4 CIDRs, including /0 and /32', () => {
    expect(isValidIpv4Cidr('0.0.0.0/0')).toBe(true);
    expect(isValidIpv4Cidr('10.0.0.0/8')).toBe(true);
    expect(isValidIpv4Cidr('203.0.113.17/32')).toBe(true);
    expect(isValidIpv4Cidr('255.255.255.255/31')).toBe(true);
  });

  it('rejects octets over 255 and prefix widths over 32', () => {
    expect(isValidIpv4Cidr('999.999.999.999/99')).toBe(false);
    expect(isValidIpv4Cidr('256.0.0.1/24')).toBe(false);
    expect(isValidIpv4Cidr('10.0.0.0/33')).toBe(false);
    expect(isValidIpv4Cidr('10.0.0.0/-1')).toBe(false);
  });

  it('rejects malformed shapes', () => {
    expect(isValidIpv4Cidr('10.0.0')).toBe(false);
    expect(isValidIpv4Cidr('10.0.0.0')).toBe(false);
    expect(isValidIpv4Cidr('10.0.0.0/8/9')).toBe(false);
    expect(isValidIpv4Cidr('example.com/8')).toBe(false);
    expect(isValidIpv4Cidr(' 10.0.0.0 / 8 ')).toBe(false);
  });
});

describe('isValidIpv6Cidr', () => {
  it('accepts compressed and full IPv6 CIDRs', () => {
    expect(isValidIpv6Cidr('::/0')).toBe(true);
    expect(isValidIpv6Cidr('2001:db8::/32')).toBe(true);
    expect(isValidIpv6Cidr('2001:db8::1/128')).toBe(true);
    expect(isValidIpv6Cidr('fd00:0:0:0:0:0:0:1/64')).toBe(true);
  });

  it('rejects bad groups and prefix widths over 128', () => {
    expect(isValidIpv6Cidr('2001:db8::/129')).toBe(false);
    expect(isValidIpv6Cidr('2001:db8::/abc')).toBe(false);
    expect(isValidIpv6Cidr('2001:zzzz::/32')).toBe(false);
    expect(isValidIpv6Cidr('2001:db8:::1/32')).toBe(false);
    expect(isValidIpv6Cidr('fd00:0:0:0:0:0:0:0:1/64')).toBe(false);
    expect(isValidIpv6Cidr('10.0.0.0/8')).toBe(false);
  });
});

describe('isWorldOpenCidr', () => {
  it('flags only the two internet-wide CIDRs', () => {
    expect(isWorldOpenCidr('0.0.0.0/0')).toBe(true);
    expect(isWorldOpenCidr(' ::/0 ')).toBe(true);
    expect(isWorldOpenCidr('10.0.0.0/8')).toBe(false);
    expect(isWorldOpenCidr('0.0.0.0/1')).toBe(false);
  });
});
