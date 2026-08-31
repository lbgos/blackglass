import { normalizeTarget } from "./normalize-target.js";
export const NMAP_PARSER_VERSION = "nmap-xml-v1" as const;
export const NMAP_MAX_BYTES = 16 * 1024 * 1024;
const MAX_HOSTS = 2048, MAX_SERVICES = 8192, MAX_ATTR = 256, MAX_SVC = 64;
export interface ParsedNmapService { address: string; port: number; protocol: "tcp"; hostname: string | null; serviceName: string | null; product: string | null; version: string | null; }
export type ParseNmapXmlResult = { ok: true; services: ParsedNmapService[] } | { ok: false; error: { code: "nmap_xml_invalid" } };
const invalid = (): ParseNmapXmlResult => ({ ok: false, error: { code: "nmap_xml_invalid" } });
function decEnt(v: string): string | null {
  let o = "", i = 0;
  while (i < v.length) {
    const a = v.indexOf("&", i); if (a === -1) { o += v.slice(i); break; }
    o += v.slice(i, a); const s = v.indexOf(";", a + 1);
    if (s === -1 || s - a > 12) return null; const e = v.slice(a + 1, s);
    if (e === "lt") o += "<"; else if (e === "gt") o += ">"; else if (e === "amp") o += "&"; else if (e === "quot") o += '"'; else if (e === "apos") o += "'"; else if (e.startsWith("#")) {
      let n: number | null = null;
      if (e[1] === "x" || e[1] === "X") { const h = e.slice(2); if (!/^[0-9A-Fa-f]{1,6}$/.test(h)) return null; n = parseInt(h, 16); }
      else { const d = e.slice(1); if (!/^[0-9]{1,7}$/.test(d)) return null; n = parseInt(d, 10); }
      if (n === null || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null; o += String.fromCodePoint(n);
    } else return null; i = s + 1;
  } return o;
}
function tagEnd(t: string, s: number): number {
  let q: string | null = null;
  for (let i = s; i < t.length; i += 1) { const c = t[i] as string; if (q !== null) { if (c === q) q = null; continue; } if (c === '"' || c === "'") { q = c; continue; } if (c === ">") return i; }
  return -1;
}
interface HostCtx { address: string | null; hostname: string | null; ports: PortCtx[] }
interface PortCtx { protocol: string | null; port: number | null; state: string | null; serviceName: string | null; product: string | null; version: string | null }
export function parseNmapXml(bytes: Uint8Array): ParseNmapXmlResult {
  if (bytes.length > NMAP_MAX_BYTES) return invalid();
  let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return invalid(); }
  const lo = text.toLowerCase(); if (lo.includes("<!doctype") || lo.includes("<!entity")) return invalid(); if (!lo.includes("<nmaprun")) return invalid();
  const stack: string[] = []; let seenOpen = false, seenClose = false; const hosts: HostCtx[] = []; let curHost: HostCtx | null = null; let curPort: PortCtx | null = null;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i); if (lt === -1) break;
    if (text.startsWith("<!--", lt)) { const e = text.indexOf("-->", lt + 4); if (e === -1) return invalid(); i = e + 3; continue; }
    if (text.startsWith("<![CDATA[", lt)) { const e = text.indexOf("]]>", lt + 9); if (e === -1) return invalid(); i = e + 3; continue; }
    if (text.startsWith("<?", lt)) { const e = text.indexOf("?>", lt + 2); if (e === -1) return invalid(); i = e + 2; continue; }
    if (text.startsWith("<!", lt)) return invalid();
    const gt = tagEnd(text, lt + 1); if (gt === -1) return invalid();
    const raw = text.slice(lt + 1, gt); const trimmed = raw.trim(); if (!trimmed) return invalid();
    let isClose = false; let inner = trimmed; if (inner.startsWith("/")) { isClose = true; inner = inner.slice(1).trim(); }
    let selfClose = false; if (!isClose && inner.endsWith("/")) { selfClose = true; inner = inner.slice(0, -1).trim(); }
    let p = 0; while (p < inner.length && /\s/.test(inner[p] as string)) p += 1;
    const ns = p; while (p < inner.length && /[A-Za-z0-9_.\-:]/.test(inner[p] as string)) p += 1;
    const name = inner.slice(ns, p); if (!name || name.length > 64 || !/^[A-Za-z_][A-Za-z0-9_.\-:]*$/.test(name)) return invalid();
    const attrs = new Map<string, string>();
    if (!isClose) {
      while (p < inner.length) {
        while (p < inner.length && /\s/.test(inner[p] as string)) p += 1; if (p >= inner.length) break;
        const aS = p; while (p < inner.length && /[A-Za-z0-9_:\-.]/.test(inner[p] as string)) p += 1; const aN = inner.slice(aS, p);
        if (!aN || aN.length > 64) return invalid();
        while (p < inner.length && /\s/.test(inner[p] as string)) p += 1; if (inner[p] !== "=") return invalid(); p += 1;
        while (p < inner.length && /\s/.test(inner[p] as string)) p += 1; const q = inner[p] as string; if (q !== '"' && q !== "'") return invalid(); p += 1;
        const vE = inner.indexOf(q, p); if (vE === -1) return invalid(); const rv = inner.slice(p, vE); p = vE + 1;
        const dec = decEnt(rv); if (dec === null || dec.length > MAX_ATTR || dec.includes("\0")) return invalid();
        if ((aN === "name" || aN === "product" || aN === "version") && dec.length > MAX_SVC) return invalid();
        if (aN === "addr" && dec.length > 45) return invalid(); if (attrs.has(aN)) return invalid(); attrs.set(aN, dec);
      }
    } else { while (p < inner.length && /\s/.test(inner[p] as string)) p += 1; if (p !== inner.length) return invalid(); }
    if (isClose) {
      if (!stack.length || stack[stack.length - 1] !== name) return invalid(); stack.pop();
      if (name === "nmaprun") seenClose = true;
      if (name === "host") { curHost = null; curPort = null; }
      if (name === "port") curPort = null;
      i = gt + 1; continue;
    }
    if (name === "nmaprun") { if (seenOpen || stack.length) return invalid(); seenOpen = true; if (selfClose) seenClose = true; else stack.push(name); i = gt + 1; continue; }
    const inside = seenOpen && !seenClose && stack.includes("nmaprun");
    if (!inside && !stack.includes("nmaprun")) { if (!selfClose) stack.push(name); i = gt + 1; continue; }
    if (name === "host") {
      if (hosts.length >= MAX_HOSTS || !stack.includes("nmaprun")) return invalid();
      const h: HostCtx = { address: null, hostname: null, ports: [] }; hosts.push(h); curHost = h; curPort = null;
      if (!selfClose) stack.push(name); i = gt + 1; continue;
    }
    if (name === "address" && curHost) {
      const a = attrs.get("addr"), t = attrs.get("addrtype");
      if (a && (t === "ipv4" || t === "ipv6") && curHost.address === null) curHost.address = a;
      if (!selfClose) stack.push(name); i = gt + 1; continue;
    }
    if (name === "hostname" && curHost) {
      if (curHost.hostname === null) { const hn = attrs.get("name"); if (hn && hn.length >= 1 && hn.length <= 253) curHost.hostname = hn; }
      if (!selfClose) stack.push(name); i = gt + 1; continue;
    }
    if (name === "port" && curHost) {
      const pr = attrs.get("protocol"), ps = attrs.get("portid"); let pn: number | null = null;
      if (ps && /^[0-9]{1,5}$/.test(ps)) { const n = Number(ps); if (n >= 1 && n <= 65535) pn = n; }
      const c: PortCtx = { protocol: pr ?? null, port: pn, state: null, serviceName: null, product: null, version: null };
      if (pr !== "tcp" || pn === null) curHost.ports.push(c); else curHost.ports.push(c);
      curPort = c; if (!selfClose) stack.push(name); i = gt + 1; continue;
    }
    if (name === "state" && curPort) { const s = attrs.get("state"); if (s) curPort.state = s; if (!selfClose) stack.push(name); i = gt + 1; continue; }
    if (name === "service" && curPort) {
      const sn = attrs.get("name") ?? null, pr = attrs.get("product") ?? null, ve = attrs.get("version") ?? null;
      if (sn) curPort.serviceName = sn; if (pr) curPort.product = pr; if (ve) curPort.version = ve;
      if (!selfClose) stack.push(name); i = gt + 1; continue;
    }
    if (!selfClose) stack.push(name); i = gt + 1;
  }
  if (!seenOpen || !seenClose || stack.length) return invalid();
  const services: ParsedNmapService[] = [];
  for (const h of hosts) {
    if (!h.address) continue; const n = normalizeTarget(h.address); if (!n.ok || n.target.kind !== "ip") continue;
    const addr = n.target.address;
    for (const p of h.ports) {
      if (p.protocol !== "tcp" || p.port === null || p.state !== "open") continue;
      if (services.length >= MAX_SERVICES) return invalid();
      services.push({ address: addr, port: p.port, protocol: "tcp", hostname: h.hostname, serviceName: p.serviceName, product: p.product, version: p.version });
    }
  }
  return { ok: true, services };
}
