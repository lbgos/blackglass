import {
  NMAP_MAX_HOSTS as MAX_HOSTS,
  NMAP_MAX_SERVICES as MAX_SERVICES,
  NMAP_MAX_XML_BYTES as MAX_BYTES,
  type NmapServiceObservation,
} from "@blackglass/contracts";
import { normalizeTarget } from "./normalize-target.js";
const MAX_ATTR = 256, MAX_SVC = 64, MAX_DEPTH = 32;
export type ParsedNmapService = NmapServiceObservation;
export type ParseNmapXmlResult = { ok: true; services: ParsedNmapService[] } | { ok: false; error: {
  code: "nmap_xml_invalid" } };
const invalid = (): ParseNmapXmlResult => ({ ok: false, error: { code: "nmap_xml_invalid" } });
function decodeEntities(v: string): string | null {
  let out = "", i = 0;
  while (i < v.length) {
    const a = v.indexOf("&", i);
    if (a === -1) { out += v.slice(i); break; }
    out += v.slice(i, a);
    const s = v.indexOf(";", a + 1);
    if (s === -1 || s - a > 12) return null;
    const e = v.slice(a + 1, s);
    if (e === "lt") out += "<"; else if (e === "gt") out += ">";
    else if (e === "amp") out += "&"; else if (e === "quot") out += '"';
    else if (e === "apos") out += "'"; else if (e.startsWith("#")) {
      let cp: number | null = null;
      if (e[1] === "x" || e[1] === "X") {
        const h = e.slice(2); if (!/^[0-9A-Fa-f]{1,6}$/.test(h)) return null; cp = Number.parseInt(h, 16);
      } else { const d = e.slice(1); if (!/^[0-9]{1,7}$/.test(d)) return null; cp = Number.parseInt(d, 10); }
      if (cp === null || cp < 1 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      out += String.fromCodePoint(cp);
    } else return null;
    i = s + 1;
  }
  return out;
}
function findTagEnd(t: string, s: number): number {
  let q: string | null = null;
  for (let i = s; i < t.length; i += 1) {
    const c = t[i];
    if (q !== null) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ">") return i;
  }
  return -1;
}
interface HostCtx { address: string | null; hostname: string | null; ports: PortCtx[]; }
interface PortCtx { protocol: string | null; port: number | null; state: string | null; serviceName: string | null;
  product: string | null; version: string | null; }
export function parseNmapXml(bytes: Uint8Array): ParseNmapXmlResult {
  if (bytes.length > MAX_BYTES) return invalid();
  let xml: string; try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return invalid(); }
  const lo = xml.toLowerCase();
  if (lo.includes("<!doctype") || lo.includes("<!entity")) return invalid();
  if (!lo.includes("<nmaprun")) return invalid();
  const stack: string[] = []; let seenOpen = false, seenClose = false;
  const hosts: HostCtx[] = []; let curHost: HostCtx | null = null, curPort: PortCtx | null = null, totalPorts = 0,
  pos = 0;
  while (pos < xml.length) {
    const lt = xml.indexOf("<", pos);
    if (lt === -1) {
      const tail = xml.slice(pos);
      if (decodeEntities(tail) === null) return invalid();
      if (/\S/.test(tail) && stack.length === 0) return invalid();
      break;
    }
    if (lt > pos) {
      const between = xml.slice(pos, lt);
      if (decodeEntities(between) === null) return invalid();
      if (/\S/.test(between) && stack.length === 0) return invalid();
    }
    if (xml.startsWith("<!--", lt)) { const e = xml.indexOf("-->", lt + 4); if (e === -1) return invalid();
  pos = e + 3; continue; }
    if (xml.startsWith("<![CDATA[", lt)) { const e = xml.indexOf("]]>", lt + 9); if (e === -1) return invalid();
  pos = e + 3; continue; }
    if (xml.startsWith("<?", lt)) { const e = xml.indexOf("?>", lt + 2); if (e === -1) return invalid(); pos = e + 2;
  continue; }
    if (xml.startsWith("<!", lt)) return invalid();
    const gt = findTagEnd(xml, lt + 1); if (gt === -1) return invalid();
    const raw = xml.slice(lt + 1, gt); const trimmed = raw.trim(); if (!trimmed) return invalid();
    let closing = false, inner = trimmed;
    if (inner.startsWith("/")) { closing = true; inner = inner.slice(1).trim(); }
    let selfClose = false;
    if (!closing && inner.endsWith("/")) { selfClose = true; inner = inner.slice(0, -1).trim(); }
    let p = 0; while (p < inner.length && /\s/.test(inner[p] ?? "")) p += 1;
    const ns = p; while (p < inner.length && /[A-Za-z0-9_.\-:]/.test(inner[p] ?? "")) p += 1;
    const name = inner.slice(ns, p);
    if (!name || name.length > 64 || !/^[A-Za-z_][A-Za-z0-9_.\-:]*$/.test(name)) return invalid();
    const attrs = new Map<string, string>();
    if (!closing) {
      while (p < inner.length) {
        while (p < inner.length && /\s/.test(inner[p] ?? "")) p += 1;
        if (p >= inner.length) break;
        const aS = p; while (p < inner.length && /[A-Za-z0-9_:\-.]/.test(inner[p] ?? "")) p += 1;
        const aN = inner.slice(aS, p); if (!aN || aN.length > 64) return invalid();
        while (p < inner.length && /\s/.test(inner[p] ?? "")) p += 1;
        if (inner[p] !== "=") return invalid(); p += 1;
        while (p < inner.length && /\s/.test(inner[p] ?? "")) p += 1;
        const q = inner[p]; if (q !== '"' && q !== "'") return invalid(); p += 1;
        const vE = inner.indexOf(q, p); if (vE === -1) return invalid();
        const rv = inner.slice(p, vE); p = vE + 1;
        const dec = decodeEntities(rv); if (dec === null || dec.length > MAX_ATTR ||
  dec.includes("\0")) return invalid();
        if ((aN === "name" || aN === "product" || aN === "version") && dec.length > MAX_SVC) return invalid();
        if (aN === "addr" && dec.length > 45) return invalid();
        if (attrs.has(aN)) return invalid(); attrs.set(aN, dec);
      }
    } else { while (p < inner.length && /\s/.test(inner[p] ?? "")) p += 1; if (p !== inner.length) return invalid(); }
    if (closing) {
      const top = stack[stack.length - 1]; if (!top || top !== name) return invalid(); stack.pop();
      if (name === "nmaprun") seenClose = true;
      if (name === "host") { curHost = null; curPort = null; }
      if (name === "port") curPort = null;
      pos = gt + 1; continue;
    }
    if (name === "nmaprun") {
      if (seenOpen || stack.length !== 0) return invalid(); seenOpen = true;
      if (selfClose) seenClose = true; else { if (stack.length >= MAX_DEPTH) return invalid(); stack.push(name); }
      pos = gt + 1; continue;
    }
    if (stack.length === 0 || stack[0] !== "nmaprun") return invalid();
    const parent = stack[stack.length - 1] ?? null, grand = stack[stack.length - 2] ?? null;
    if (name === "host") {
      if (parent !== "nmaprun") return invalid(); if (hosts.length >= MAX_HOSTS) return invalid();
      const h: HostCtx = { address: null, hostname: null, ports: [] }; hosts.push(h);
      if (!selfClose) { if (stack.length >= MAX_DEPTH) return invalid(); curHost = h; curPort = null; stack.push(name);
  }
      pos = gt + 1; continue;
    }
    if (name === "hostnames" || name === "ports") {
      if (parent !== "host") return invalid();
      if (!selfClose) { if (stack.length >= MAX_DEPTH) return invalid(); stack.push(name); }
      pos = gt + 1; continue;
    }
    if (name === "address") {
      if (parent !== "host" || curHost === null) return invalid();
      const a = attrs.get("addr"), t = attrs.get("addrtype");
      if (a && (t === "ipv4" || t === "ipv6") && curHost.address === null) curHost.address = a;
      if (!selfClose) { if (stack.length >= MAX_DEPTH) return invalid(); stack.push(name); }
      pos = gt + 1; continue;
    }
    if (name === "hostname") {
      if (parent !== "hostnames" || grand !== "host" || curHost === null) return invalid();
      if (curHost.hostname === null) { const hn = attrs.get("name"); if (hn && hn.length >= 1 &&
  hn.length <= 253) curHost.hostname = hn; }
      if (!selfClose) { if (stack.length >= MAX_DEPTH) return invalid(); stack.push(name); }
      pos = gt + 1; continue;
    }
    if (name === "port") {
      if (parent !== "ports" || grand !== "host" || curHost === null) return invalid();
      if (totalPorts >= MAX_SERVICES) return invalid();
      const pr = attrs.get("protocol") ?? null, ps = attrs.get("portid"); let pn: number | null = null;
      if (ps && /^[0-9]{1,5}$/.test(ps)) { const n = Number(ps); if (n >= 1 && n <= 65535) pn = n; }
      const c: PortCtx = { protocol: pr, port: pn, state: null, serviceName: null, product: null, version: null };
      curHost.ports.push(c); totalPorts += 1;
      if (!selfClose) { if (stack.length >= MAX_DEPTH) return invalid(); curPort = c; stack.push(name); }
  else curPort = null;
      pos = gt + 1; continue;
    }
    if (name === "state") {
      if (parent !== "port" || curPort === null) return invalid();
      const s = attrs.get("state"); if (s) curPort.state = s;
      if (!selfClose) { if (stack.length >= MAX_DEPTH) return invalid(); stack.push(name); }
      pos = gt + 1; continue;
    }
    if (name === "service") {
      if (parent !== "port" || curPort === null) return invalid();
      const sn = attrs.get("name") ?? null, pr = attrs.get("product") ?? null, ve = attrs.get("version") ?? null;
      if (sn) curPort.serviceName = sn; if (pr) curPort.product = pr; if (ve) curPort.version = ve;
      if (!selfClose) { if (stack.length >= MAX_DEPTH) return invalid(); stack.push(name); }
      pos = gt + 1; continue;
    }
    if (!selfClose) { if (stack.length >= MAX_DEPTH) return invalid(); stack.push(name); }
    pos = gt + 1;
  }
  if (!seenOpen || !seenClose || stack.length !== 0) return invalid();
  const services: ParsedNmapService[] = [];
  for (const h of hosts) {
    if (!h.address) continue;
    const n = normalizeTarget(h.address);
    if (!n.ok || n.target.kind !== "ip") continue;
    const addr = n.target.address;
    for (const p of h.ports) {
      if (p.protocol !== "tcp" || p.port === null || p.state !== "open") continue;
      if (services.length >= MAX_SERVICES) return invalid();
      services.push({ address: addr, port: p.port, protocol: "tcp", hostname: h.hostname, serviceName: p.serviceName,
  product: p.product, version: p.version });
    }
  }
  return { ok: true, services };
}
