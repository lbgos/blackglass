import { describe, expect, it } from "vitest";
import { NMAP_MAX_XML_BYTES } from "@blackglass/contracts";
import { parseNmapXml } from "./nmap-xml.js";
const enc = new TextEncoder();
const valid = enc.encode(`<?xml version="1.0"?><nmaprun><host><address addr="192.0.2.10" addrtype="ipv4"/><hostnames><hostname name="host.test"/></hostnames><ports><port protocol="tcp" portid="80"><state state="open"/><service name="http" product="nginx" version="1.18"/></port></ports></host></nmaprun>`);
const empty = enc.encode(`<?xml version="1.0"?><nmaprun></nmaprun>`);
describe("parseNmapXml", () => {
  it("parses valid single service", () => {
    const r = parseNmapXml(valid);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.services).toHaveLength(1); expect(r.services[0]).toMatchObject({ address: "192.0.2.10", port: 80, hostname: "host.test", serviceName: "http" }); }
  });
  it("accepts empty nmaprun with zero services", () => {
    const r = parseNmapXml(empty);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.services).toHaveLength(0);
  });
  it("rejects adversarial structure", () => {
    const cases = [
      enc.encode(`<?xml version="1.0"?><nmaprun><host><host><address addr="192.0.2.1" addrtype="ipv4"/></host></host></nmaprun>`),
      enc.encode(`<?xml version="1.0"?><nmaprun></nmaprun><nmaprun></nmaprun>`),
      enc.encode(`<?xml version="1.0"?><nmaprun><host><address addr="192.0.2.1" addrtype="ipv4"></nmaprun></host>`),
      enc.encode(`<?xml version="1.0"?><nmaprun><host><address addr="192.0.2.1" addrtype="ipv4"/><ports><port protocol="tcp" portid="80"><port protocol="tcp" portid="81"><state state="open"/></port></port></ports></host></nmaprun>`),
      enc.encode(`<?xml version="1.0"?><nmaprun><host><address addr="192.0.2.1" addrtype="ipv4"/><state state="open"/></host></nmaprun>`),
      enc.encode(`<?xml version="1.0"?><nmaprun><host><address addr="192.0.2.1" addrtype="ipv4"/><ports><port protocol="tcp" portid="80"/><state state="open"/></ports></host></nmaprun>`),
      enc.encode(`<?xml version="1.0"?><nmaprun>hello<nmaprun></nmaprun>`),
    ];
    for (const c of cases) expect(parseNmapXml(c).ok).toBe(false);
  });
  it("rejects DTD and entities", () => {
    expect(parseNmapXml(enc.encode(`<!DOCTYPE nmaprun [<!ENTITY x "y">]><nmaprun></nmaprun>`)).ok).toBe(false);
    expect(parseNmapXml(enc.encode(`<?xml version="1.0"?><nmaprun><host><address addr="a &foo; b" addrtype="ipv4"/></host></nmaprun>`)).ok).toBe(false);
  });
  it("rejects invalid UTF-8 and oversize", () => {
    expect(parseNmapXml(new Uint8Array([0xff, 0xfe]))).toMatchObject({ ok: false });
    const big = new Uint8Array(NMAP_MAX_XML_BYTES + 1);
    big.fill(0x41);
    expect(parseNmapXml(big).ok).toBe(false);
  });
});
