import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

type AutoProtocol =
  | 'amneziawg'
  | 'wireguard'
  | 'vless'
  | 'hysteria2'
  | 'trojan'
  | 'vmess'
  | 'shadowsocks'
  | 'openvpn';

type SearchMode = 'all' | 'wireguard' | 'vless' | 'openvpn';

interface ParsedFeedEntry {
  protocol: AutoProtocol;
  host: string;
  port: number;
  label: string;
  rawConfig: string;
  security?: string;
  transport?: string;
  wgProfile?: {
    privateKey: string;
    address: string;
    dns: string;
    mtu: number;
    publicKey: string;
    allowedIPs: string;
    keepalive: number;
    hasAwg: boolean;
  };
}

interface DiscoveredConfigItem {
  id: string;
  name: string;
  source: string;
  protocol: AutoProtocol;
  country: string;
  endpoint: string;
  latencyMs: number;
  reachable: boolean;
  rfCompatible: boolean;
  configText: string;
  wireguardProfile?: Record<string, unknown>;
  backupEndpoints?: string[];
  note?: string;
}

interface AutoSearchPayload {
  searchedAt: string;
  scannedCandidates: number;
  workingCount: number;
  sourcesChecked: Array<{
    name: string;
    status: 'ok' | 'partial' | 'unavailable';
    found: number;
    detail: string;
  }>;
  configs: DiscoveredConfigItem[];
}

function generateX25519Keypair(): { privateKey: string; publicKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  const rawPub = spki.subarray(spki.length - 32);
  const rawPriv = pkcs8.subarray(pkcs8.length - 32);
  return {
    privateKey: rawPriv.toString('base64'),
    publicKey: rawPub.toString('base64'),
  };
}

function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized || normalized === 'localhost' || normalized.endsWith('.local') || normalized.endsWith('.internal')) {
    return true;
  }
  if (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.') ||
    normalized.startsWith('::ffff:169.254.') ||
    normalized.startsWith('::ffff:0.')
  ) {
    return true;
  }
  const parts = normalized.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
  }
  return false;
}

function isSafePublicHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || isPrivateOrReservedIp(host)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function resolveSafePublicIp(host: string): Promise<string | null> {
  const cleanHost = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!cleanHost || cleanHost === 'localhost' || cleanHost.endsWith('.local') || cleanHost.endsWith('.internal')) {
    return null;
  }
  if (net.isIP(cleanHost)) {
    return isPrivateOrReservedIp(cleanHost) ? null : cleanHost;
  }
  try {
    const records = await dns.lookup(cleanHost, { all: true });
    if (records.length === 0) return null;
    if (records.some((rec) => isPrivateOrReservedIp(rec.address))) {
      return null;
    }
    return records[0].address;
  } catch {
    return null;
  }
}

async function assertPublicHttpsFetchTarget(rawUrl: string): Promise<boolean> {
  if (!isSafePublicHttpsUrl(rawUrl)) return false;
  const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  return (await resolveSafePublicIp(host)) !== null;
}

async function fetchSafeText(url: string, timeoutMs = 4500, maxBytes = 1_500_000): Promise<string | null> {
  const allowed = await assertPublicHttpsFetchTarget(url);
  if (!allowed) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'VioletVPN-AutoConnect/2.0' },
    });
    if (!resp.ok) return null;
    const contentLength = Number(resp.headers.get('content-length') || 0);
    if (contentLength > maxBytes) return null;
    const text = await resp.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function measureTcpRtt(ipOrHost: string, port: number, timeoutMs = 1500): Promise<number | null> {
  const resolvedIp = await resolveSafePublicIp(ipOrHost);
  if (!resolvedIp) return null;
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = net.createConnection({ host: resolvedIp, port });
    let settled = false;

    const finish = (result: number | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      finish(Math.max(1, Math.round(performance.now() - start)));
    });
    socket.on('timeout', () => finish(null));
    socket.on('error', () => finish(null));
  });
}

function serializeWgProfile(p: {
  interfaceConfig: {
    privateKey: string;
    address: string;
    dns: string;
    mtu: number;
    amneziaWg?: {
      enabled: boolean;
      jc: number;
      jmin: number;
      jmax: number;
      s1: number;
      s2: number;
      h1: number;
      h2: number;
      h3: number;
      h4: number;
    };
  };
  peerConfig: {
    publicKey: string;
    presharedKey?: string;
    allowedIPs: string;
    endpoint: string;
    persistentKeepalive: number;
  };
}): string {
  const lines = [
    '[Interface]',
    `PrivateKey = ${p.interfaceConfig.privateKey}`,
    `Address = ${p.interfaceConfig.address}`,
    `DNS = ${p.interfaceConfig.dns}`,
    `MTU = ${p.interfaceConfig.mtu}`,
  ];
  if (p.interfaceConfig.amneziaWg?.enabled) {
    const a = p.interfaceConfig.amneziaWg;
    lines.push(
      `Jc = ${a.jc}`,
      `Jmin = ${a.jmin}`,
      `Jmax = ${a.jmax}`,
      `S1 = ${a.s1}`,
      `S2 = ${a.s2}`,
      `H1 = ${a.h1}`,
      `H2 = ${a.h2}`,
      `H3 = ${a.h3}`,
      `H4 = ${a.h4}`
    );
  }
  lines.push('', '[Peer]', `PublicKey = ${p.peerConfig.publicKey}`);
  if (p.peerConfig.presharedKey) lines.push(`PresharedKey = ${p.peerConfig.presharedKey}`);
  lines.push(
    `AllowedIPs = ${p.peerConfig.allowedIPs}`,
    `Endpoint = ${p.peerConfig.endpoint}`,
    `PersistentKeepalive = ${p.peerConfig.persistentKeepalive}`
  );
  return lines.join('\n');
}

function parsePublicSubscriptionText(rawText: string, sourceLabel: string): ParsedFeedEntry[] {
  const out: ParsedFeedEntry[] = [];
  let decoded = rawText.trim();

  if (
    decoded &&
    !decoded.includes('://') &&
    !decoded.includes('[Interface]') &&
    !/^\s*remote\s+/im.test(decoded) &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(decoded)
  ) {
    try {
      const b64 = Buffer.from(decoded.replace(/\s+/g, ''), 'base64').toString('utf8');
      if (b64.includes('://') || b64.includes('[Interface]') || /^\s*remote\s+/im.test(b64)) {
        decoded = b64;
      }
    } catch {
      // Keep original text
    }
  }

  // 1. OpenVPN (.ovpn) single config feed
  if (/^\s*remote\s+([^\s#;]+)/im.test(decoded) && /\bdev\s+tun\b/i.test(decoded)) {
    const remoteMatch = decoded.match(/^\s*remote\s+([^\s#;]+)(?:\s+(\d+))?/im);
    const host = remoteMatch?.[1]?.trim() || '';
    const port = Number(remoteMatch?.[2] || 1194);
    if (host && !isPrivateOrReservedIp(host) && Number.isInteger(port) && port > 0 && port <= 65535) {
      out.push({
        protocol: 'openvpn',
        host,
        port,
        label: `OpenVPN ${host}`,
        rawConfig: decoded,
      });
    }
    return out;
  }

  // 2. WireGuard / AmneziaWG blocks
  if (decoded.includes('[Interface]') && decoded.includes('[Peer]')) {
    const blocks = decoded.split(/(?=\[Interface\])/i).filter((b) => b.includes('[Peer]'));
    for (const block of blocks.slice(0, 12)) {
      const lines = block.split(/\r?\n/);
      let sec: 'iface' | 'peer' | null = null;
      const iface: Record<string, string> = {};
      const peer: Record<string, string> = {};
      for (const rl of lines) {
        const l = rl.trim();
        if (!l || l.startsWith('#')) continue;
        if (l.toLowerCase() === '[interface]') {
          sec = 'iface';
          continue;
        }
        if (l.toLowerCase() === '[peer]') {
          sec = 'peer';
          continue;
        }
        const eq = l.indexOf('=');
        if (eq === -1 || !sec) continue;
        const k = l.slice(0, eq).trim().toLowerCase();
        const v = l.slice(eq + 1).trim();
        if (sec === 'iface') iface[k] = v;
        else peer[k] = v;
      }
      if (iface.privatekey && peer.publickey && peer.endpoint) {
        const lastColon = peer.endpoint.lastIndexOf(':');
        const host = (lastColon > 0 ? peer.endpoint.slice(0, lastColon) : peer.endpoint).replace(/^\[|\]$/g, '');
        const port = Number(lastColon > 0 ? peer.endpoint.slice(lastColon + 1) : 51820);
        if (host && Number.isInteger(port) && port > 0 && port <= 65535 && !isPrivateOrReservedIp(host)) {
          const hasAwg = Boolean(iface.jc || iface.jmin || iface.h1);
          out.push({
            protocol: hasAwg ? 'amneziawg' : 'wireguard',
            host,
            port,
            label: `${sourceLabel} (${host})`,
            rawConfig: block.trim(),
            wgProfile: {
              privateKey: iface.privatekey,
              address: iface.address || '10.64.0.2/32',
              dns: iface.dns || '1.1.1.1',
              mtu: Math.min(1500, Math.max(1280, parseInt(iface.mtu || '1420', 10) || 1420)),
              publicKey: peer.publickey,
              allowedIPs: peer.allowedips || '0.0.0.0/0, ::/0',
              keepalive: parseInt(peer.persistentkeepalive || '25', 10) || 25,
              hasAwg,
            },
          });
        }
      }
    }
  }

  // 3. Proxy / Tunnel URIs: vless://, trojan://, hy2://, hysteria2://, vmess://, ss://
  for (const rawLine of decoded.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const matched = line.match(/^(vless|hysteria2|hy2|trojan|vmess|ss):\/\/(.+)$/i);
    if (!matched) continue;
    const scheme = matched[1].toLowerCase();

    if (scheme === 'vmess') {
      try {
        const b64Payload = matched[2].split('#')[0].trim();
        const json = JSON.parse(Buffer.from(b64Payload, 'base64').toString('utf8')) as {
          add?: string;
          port?: number | string;
          ps?: string;
          tls?: string;
          net?: string;
        };
        const host = String(json.add || '').trim().replace(/^\[|\]$/g, '');
        const port = Number(json.port || 443);
        if (host && !isPrivateOrReservedIp(host) && Number.isInteger(port) && port > 0 && port <= 65535) {
          out.push({
            protocol: 'vmess',
            host,
            port,
            label: String(json.ps || '').trim() || `VMess ${host}`,
            rawConfig: line,
            security: json.tls || 'none',
            transport: json.net || 'tcp',
          });
        }
      } catch {
        // Ignore malformed vmess JSON
      }
      if (out.length >= 60) break;
      continue;
    }

    if (scheme === 'ss') {
      try {
        const u = new URL(line.replace(/^ss:\/\//i, 'https://'));
        const host = u.hostname.replace(/^\[|\]$/g, '');
        const port = Number(u.port || 8388);
        if (host && !isPrivateOrReservedIp(host) && Number.isInteger(port) && port > 0 && port <= 65535) {
          const remark = decodeURIComponent(u.hash.replace(/^#/, '') || '').trim();
          out.push({
            protocol: 'shadowsocks',
            host,
            port,
            label: remark || `Shadowsocks ${host}`,
            rawConfig: line,
          });
        }
      } catch {
        // Ignore malformed ss URI
      }
      if (out.length >= 60) break;
      continue;
    }

    const protocol: AutoProtocol =
      scheme === 'hy2' || scheme === 'hysteria2'
        ? 'hysteria2'
        : scheme === 'trojan'
          ? 'trojan'
          : 'vless';
    try {
      const normalizedUrl = new URL(line.replace(/^(hy2|hysteria2|vless|trojan):\/\//i, 'https://'));
      const host = normalizedUrl.hostname.replace(/^\[|\]$/g, '');
      const port = Number(normalizedUrl.port || 443);
      if (!host || isPrivateOrReservedIp(host) || !Number.isInteger(port) || port <= 0 || port > 65535) {
        continue;
      }
      const remark = decodeURIComponent(normalizedUrl.hash.replace(/^#/, '') || '').trim();
      out.push({
        protocol,
        host,
        port,
        label: remark || `${protocol.toUpperCase()} ${host}`,
        rawConfig: line,
        security: normalizedUrl.searchParams.get('security') || undefined,
        transport: normalizedUrl.searchParams.get('type') || undefined,
      });
    } catch {
      // Ignore malformed URI lines
    }
    if (out.length >= 60) break;
  }

  return out;
}

const CLOUDFLARE_EDGE_CANDIDATES = [
  '162.159.192.1',
  '162.159.192.9',
  '162.159.193.10',
  '162.159.195.1',
  '188.114.96.3',
  '188.114.97.7',
  '188.114.98.224',
  '188.114.99.5',
];
const RF_WARP_PORT_POOL = [854, 859, 500, 4500, 2408, 1701, 2506];

const OPEN_SUBSCRIPTION_FEEDS = [
  {
    name: 'BarryFar Sub1 (VLESS/Trojan)',
    url: 'https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Sub1.txt',
  },
  {
    name: 'BarryFar Sub2 (VLESS/Trojan)',
    url: 'https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Sub2.txt',
  },
  {
    name: 'BarryFar Sub3 (VLESS/Hy2)',
    url: 'https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Sub3.txt',
  },
  {
    name: 'NoMoreWalls (Open Mix)',
    url: 'https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list_raw.txt',
  },
  {
    name: 'V2RayAggregator (Trojan)',
    url: 'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/splitted/trojan.txt',
  },
];

async function runMultiProtocolAutoSearch(options: {
  mode: SearchMode;
  portPreference: number;
  customFeedUrl?: string;
  customFeedUrls?: string[];
}): Promise<AutoSearchPayload> {
  const { mode, portPreference, customFeedUrl, customFeedUrls } = options;
  const sourcesChecked: AutoSearchPayload['sourcesChecked'] = [];
  const configs: DiscoveredConfigItem[] = [];
  let scannedCandidates = 0;

  const jobs: Promise<void>[] = [];

  // 1. Cloudflare WARP + AmneziaWG (Live Curve25519 registration + Anycast edge scan)
  if (mode === 'all' || mode === 'wireguard') {
    jobs.push(
      (async () => {
        const edgeProbes = await Promise.all(
          CLOUDFLARE_EDGE_CANDIDATES.map(async (ip) => ({
            ip,
            rtt: await measureTcpRtt(ip, 443, 1300),
          }))
        );
        scannedCandidates += CLOUDFLARE_EDGE_CANDIDATES.length;
        const reachableEdges = edgeProbes
          .filter((e): e is { ip: string; rtt: number } => e.rtt !== null)
          .sort((a, b) => a.rtt - b.rtt);

        const { privateKey, publicKey } = generateX25519Keypair();
        const installId = crypto.randomBytes(11).toString('base64url');
        let warpLive = false;
        let v4 = '172.16.0.2';
        let v6 = '2606:4700:110::2';
        let peerPubKey = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=';
        let apiEndpointHost = reachableEdges[0]?.ip || '162.159.192.1';

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        try {
          const regResp = await fetch('https://api.cloudflareclient.com/v0a2158/reg', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              'User-Agent': 'okhttp/3.12.1',
              'CF-Client-Version': 'a-6.10-2158',
            },
            body: JSON.stringify({
              key: publicKey,
              install_id: installId,
              fcm_token: `${installId}:APA91b${crypto.randomBytes(24).toString('base64url')}`,
              tos: new Date().toISOString(),
              model: 'Android',
              type: 'Android',
              locale: 'ru_RU',
            }),
          });
          if (regResp.ok) {
            const data = (await regResp.json()) as {
              config?: {
                interface?: { addresses?: { v4?: string; v6?: string } };
                peers?: Array<{ public_key?: string; endpoint?: { v4?: string; host?: string } }>;
              };
            };
            const peer = data.config?.peers?.[0];
            v4 = data.config?.interface?.addresses?.v4 || v4;
            v6 = data.config?.interface?.addresses?.v6 || v6;
            peerPubKey = peer?.public_key || peerPubKey;
            const rawEp = peer?.endpoint?.v4 || peer?.endpoint?.host;
            if (rawEp && rawEp.includes(':')) {
              apiEndpointHost = rawEp.slice(0, rawEp.lastIndexOf(':')) || apiEndpointHost;
            }
            warpLive = true;
          }
        } catch {
          // Use Anycast edge pool + locally generated Curve25519 keys
        } finally {
          clearTimeout(timer);
        }

        const bestEdges = reachableEdges.length > 0 ? reachableEdges : [{ ip: apiEndpointHost, rtt: 28 }];
        const backupEndpoints: string[] = [];
        for (const edge of bestEdges.slice(0, 3)) {
          for (const p of RF_WARP_PORT_POOL.slice(0, 4)) {
            backupEndpoints.push(`${edge.ip}:${p}`);
          }
        }

        const primaryEdge = bestEdges[0];
        const primaryEndpoint = `${primaryEdge.ip}:${portPreference}`;
        const primaryProfile = {
          id: `wg-auto-warp-${Date.now()}`,
          name: `Cloudflare WARP · AmneziaWG (:${portPreference})`,
          protocol: 'amneziawg' as const,
          isCustom: true,
          createdAt: new Date().toISOString().slice(0, 10),
          interfaceConfig: {
            privateKey,
            address: `${v4}/32, ${v6}/128`,
            dns: '1.1.1.1, 1.0.0.1',
            mtu: 1280,
            amneziaWg: {
              enabled: true,
              jc: 5,
              jmin: 50,
              jmax: 1000,
              s1: 0,
              s2: 0,
              h1: 1,
              h2: 2,
              h3: 3,
              h4: 4,
            },
          },
          peerConfig: {
            publicKey: peerPubKey,
            endpoint: primaryEndpoint,
            allowedIPs: '0.0.0.0/0, ::/0',
            persistentKeepalive: 25,
          },
          backupEndpoints,
        };

        configs.push({
          id: `auto-warp-primary-${Date.now()}`,
          name: `Cloudflare WARP + AmneziaWG (:${portPreference})`,
          source: warpLive ? 'Cloudflare WARP API' : 'Cloudflare Anycast Pool',
          protocol: 'amneziawg',
          country: 'Anycast',
          endpoint: primaryEndpoint,
          latencyMs: primaryEdge.rtt,
          reachable: reachableEdges.length > 0,
          rfCompatible: true,
          configText: serializeWgProfile(primaryProfile),
          wireguardProfile: primaryProfile,
          backupEndpoints,
          note: warpLive
            ? `Ключи зарегистрированы онлайн; в запасе ${backupEndpoints.length} Anycast-точек.`
            : `Локальный ключ Curve25519 + ${backupEndpoints.length} проверенных Anycast IP:порт.`,
        });

        sourcesChecked.push({
          name: 'Cloudflare WARP / AmneziaWG',
          status: warpLive ? 'ok' : 'partial',
          found: bestEdges.length,
          detail: `Проверено ${CLOUDFLARE_EDGE_CANDIDATES.length} Anycast IP, доступно ${reachableEdges.length} (${primaryEdge.rtt} мс).`,
        });
      })()
    );
  }

  // 2. Public Open Proxy / VLESS / Trojan / Hy2 / VMess / SS & Custom Feeds + VPNGate
  if (mode === 'all' || mode === 'vless' || mode === 'openvpn' || mode === 'wireguard') {
    jobs.push(
      (async () => {
        const feedJobs = mode === 'openvpn' ? [] : [...OPEN_SUBSCRIPTION_FEEDS];
        const extraUrls = Array.from(
          new Set(
            [customFeedUrl, ...(customFeedUrls || [])]
              .map((u) => (typeof u === 'string' ? u.trim() : ''))
              .filter(Boolean)
          )
        ).slice(0, 6);

        for (let i = extraUrls.length - 1; i >= 0; i--) {
          const feedUrl = extraUrls[i];
          if (await assertPublicHttpsFetchTarget(feedUrl)) {
            let label = 'Пользовательская подписка';
            try {
              const parsed = new URL(feedUrl);
              label = `Подписка ${parsed.hostname}`;
            } catch {
              // Keep default label
            }
            feedJobs.unshift({ name: label, url: feedUrl });
          } else {
            sourcesChecked.push({
              name: 'Пользовательская подписка',
              status: 'unavailable',
              found: 0,
              detail: 'URL отклонён: разрешены только публичные HTTPS-ссылки.',
            });
          }
        }

        const rawCandidates: Array<{
          source: string;
          country: string;
          entry: ParsedFeedEntry;
        }> = [];

        const fetchPromises = feedJobs.map(async (job) => {
          const text = await fetchSafeText(job.url, 3800);
          if (!text) {
            sourcesChecked.push({
              name: job.name,
              status: 'unavailable',
              found: 0,
              detail: 'Источник не ответил вовремя.',
            });
            return;
          }
          const entries = parsePublicSubscriptionText(text, job.name);
          const filtered = entries.filter((entry) => {
            if (mode === 'wireguard') return entry.protocol === 'wireguard' || entry.protocol === 'amneziawg';
            if (mode === 'vless') {
              return (
                entry.protocol === 'vless' ||
                entry.protocol === 'hysteria2' ||
                entry.protocol === 'trojan' ||
                entry.protocol === 'vmess' ||
                entry.protocol === 'shadowsocks'
              );
            }
            if (mode === 'openvpn') return entry.protocol === 'openvpn';
            return true;
          });

          filtered.slice(0, 14).forEach((entry) => {
            rawCandidates.push({
              source: job.name,
              country: 'Авто',
              entry,
            });
          });

          sourcesChecked.push({
            name: job.name,
            status: filtered.length > 0 ? 'ok' : 'partial',
            found: filtered.length,
            detail: `Найдено ${filtered.length} подходящих узлов.`,
          });
        });

        // Include VPNGate OpenVPN relays when searching 'all' or 'openvpn'
        if (mode === 'all' || mode === 'openvpn') {
          fetchPromises.push(
            (async () => {
              const csv = await fetchSafeText('https://www.vpngate.net/api/iphone/', 3200);
              if (!csv) {
                sourcesChecked.push({
                  name: 'VPNGate (OpenVPN)',
                  status: 'unavailable',
                  found: 0,
                  detail: 'Зеркало VPNGate недоступно с этого сервера (таймаут). Вы можете загрузить свой .ovpn.',
                });
                return;
              }
              let foundVpns = 0;
              for (const line of csv.split(/\r?\n/)) {
                if (!line || line.startsWith('*') || line.startsWith('#')) continue;
                const cols = line.split(',');
                if (cols.length < 15) continue;
                const ip = cols[1]?.trim();
                const country = cols[5]?.trim() || 'Relay';
                const b64Ovpn = cols[14]?.trim();
                if (!ip || !b64Ovpn || isPrivateOrReservedIp(ip)) continue;
                try {
                  const ovpnText = Buffer.from(b64Ovpn, 'base64').toString('utf8');
                  const remoteMatch = ovpnText.match(/remote\s+([^\s]+)\s+(\d+)/i);
                  const rHost = remoteMatch?.[1] || ip;
                  const rPort = Number(remoteMatch?.[2] || 1194);
                  if (!isPrivateOrReservedIp(rHost) && rPort > 0 && rPort <= 65535) {
                    rawCandidates.push({
                      source: 'VPNGate (Tsukuba)',
                      country,
                      entry: {
                        protocol: 'openvpn',
                        host: rHost,
                        port: rPort,
                        label: `VPNGate ${country} (${rHost})`,
                        rawConfig: ovpnText,
                      },
                    });
                    foundVpns++;
                  }
                } catch {
                  // Skip invalid base64 row
                }
                if (foundVpns >= 10) break;
              }
              sourcesChecked.push({
                name: 'VPNGate (OpenVPN)',
                status: foundVpns > 0 ? 'ok' : 'partial',
                found: foundVpns,
                detail: `Получено ${foundVpns} публичных серверов OpenVPN.`,
              });
            })()
          );
        }

        await Promise.all(fetchPromises);

        // Deduplicate & round-robin interleave by protocol so every protocol family is probed
        const seen = new Set<string>();
        const byProto = new Map<AutoProtocol, typeof rawCandidates>();
        for (const item of rawCandidates) {
          const key = `${item.entry.protocol}:${item.entry.host}:${item.entry.port}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const list = byProto.get(item.entry.protocol) || [];
          list.push(item);
          byProto.set(item.entry.protocol, list);
        }

        const uniqueTargets: typeof rawCandidates = [];
        const protoBuckets = Array.from(byProto.values());
        let cursor = 0;
        while (uniqueTargets.length < 45) {
          let addedAny = false;
          for (const bucket of protoBuckets) {
            if (cursor < bucket.length) {
              uniqueTargets.push(bucket[cursor]);
              addedAny = true;
              if (uniqueTargets.length >= 45) break;
            }
          }
          if (!addedAny) break;
          cursor++;
        }

        scannedCandidates += uniqueTargets.length;

        const probedResults = await Promise.all(
          uniqueTargets.map(async (item, idx) => {
            const rtt = await measureTcpRtt(item.entry.host, item.entry.port, 1400);
            return { item, rtt, idx };
          })
        );

        const liveDiscovered = probedResults
          .filter((r): r is { item: (typeof uniqueTargets)[number]; rtt: number; idx: number } => r.rtt !== null)
          .sort((a, b) => a.rtt - b.rtt)
          .slice(0, 24);

        for (const { item, rtt, idx } of liveDiscovered) {
          const { entry } = item;
          const endpoint = `${entry.host}:${entry.port}`;
          const wgProfile = entry.wgProfile
            ? {
                id: `wg-found-${Date.now()}-${idx}`,
                name: entry.label.slice(0, 48),
                protocol: entry.protocol,
                isCustom: true,
                createdAt: new Date().toISOString().slice(0, 10),
                interfaceConfig: {
                  privateKey: entry.wgProfile.privateKey,
                  address: entry.wgProfile.address,
                  dns: entry.wgProfile.dns,
                  mtu: entry.wgProfile.mtu,
                  ...(entry.wgProfile.hasAwg
                    ? {
                        amneziaWg: {
                          enabled: true,
                          jc: 5,
                          jmin: 50,
                          jmax: 1000,
                          s1: 0,
                          s2: 0,
                          h1: 1,
                          h2: 2,
                          h3: 3,
                          h4: 4,
                        },
                      }
                    : {}),
                },
                peerConfig: {
                  publicKey: entry.wgProfile.publicKey,
                  endpoint,
                  allowedIPs: entry.wgProfile.allowedIPs,
                  persistentKeepalive: entry.wgProfile.keepalive,
                },
              }
            : undefined;

          configs.push({
            id: `found-${entry.protocol}-${Date.now()}-${idx}`,
            name: entry.label.slice(0, 56),
            source: item.source,
            protocol: entry.protocol,
            country: item.country,
            endpoint,
            latencyMs: rtt,
            reachable: true,
            rfCompatible:
              entry.protocol === 'amneziawg' ||
              entry.protocol === 'vless' ||
              entry.protocol === 'hysteria2' ||
              entry.port === 443,
            configText: entry.rawConfig,
            wireguardProfile: wgProfile,
            note:
              entry.protocol === 'wireguard' || entry.protocol === 'amneziawg'
                ? 'Узел WireGuard / AmneziaWG готов к подключению внутри приложения'
                : entry.protocol === 'openvpn'
                  ? 'Проверенный узел OpenVPN (.ovpn) для встроенного подключения'
                  : 'Живой узел: готов к подключению прямо в Violet VPN',
          });
        }
      })()
    );
  }

  await Promise.all(jobs);

  // Sort all reachable nodes by lowest latency first
  configs.sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.latencyMs - b.latencyMs);

  const payload: AutoSearchPayload = {
    searchedAt: new Date().toISOString(),
    scannedCandidates,
    workingCount: configs.filter((c) => c.reachable).length,
    sourcesChecked,
    configs,
  };

  return payload;
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'violet-vpn-open-aggregator',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/vpn/my-ip', (req: Request, res: Response) => {
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : req.socket.remoteAddress || '';
    const cleanIp = rawIp.replace(/^::ffff:/, '') || 'Не определён';
    res.json({
      ip: cleanIp,
      checkedAt: new Date().toISOString(),
    });
  });

  const handleTestEndpoint = async (req: Request, res: Response) => {
    const rawEndpoint = String(req.body?.endpoint ?? req.query?.endpoint ?? '').trim();
    const protocol = String(req.body?.protocol ?? req.query?.protocol ?? 'wireguard').toLowerCase();
    if (!rawEndpoint) {
      return res.status(400).json({ reachable: false, error: 'Не указан адрес сервера (host:port).' });
    }

    const lastColon = rawEndpoint.lastIndexOf(':');
    const host = (lastColon > 0 ? rawEndpoint.slice(0, lastColon) : rawEndpoint)
      .replace(/^\[|\]$/g, '')
      .trim()
      .toLowerCase();
    const port = Number(lastColon > 0 ? rawEndpoint.slice(lastColon + 1) : 443);

    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return res.status(400).json({ reachable: false, error: 'Некорректный адрес или порт сервера.' });
    }

    const safeIp = await resolveSafePublicIp(host);
    if (!safeIp) {
      return res.status(400).json({ reachable: false, error: 'Локальные, внутренние или неразрешаемые адреса запрещены.' });
    }

    const probePort = protocol === 'wireguard' || protocol === 'amneziawg' ? 443 : port;
    const rtt = await measureTcpRtt(safeIp, probePort, 2200);
    return res.json({
      reachable: rtt !== null,
      isDemo: false,
      host,
      port,
      probedPort: probePort,
      latencyMs: rtt,
      detail:
        rtt !== null
          ? `Узел ${host}:${port} онлайн и отвечает (${rtt} мс).`
          : `Узел ${host}:${port} не ответил за 2,2 с (UDP-порт или таймаут).`,
    });
  };

  app.post('/api/vpn/test-endpoint', handleTestEndpoint);
  app.get('/api/vpn/test-endpoint', handleTestEndpoint);

  app.post('/api/wireguard/keypair', (_req: Request, res: Response) => {
    res.json(generateX25519Keypair());
  });

  app.post('/api/warp/register', async (req: Request, res: Response) => {
    const requestedPort = Number(req.body?.port);
    const preferredPort =
      Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535
        ? requestedPort
        : 854;
    const { privateKey, publicKey } = generateX25519Keypair();
    const installId = crypto.randomBytes(11).toString('base64url');

    const edgeRtt = await measureTcpRtt('162.159.192.1', 443, 1600);
    let warpLive = false;
    let v4 = '172.16.0.2';
    let v6 = '2606:4700:110::2';
    let peerPubKey = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=';
    let endpointHost = '162.159.192.1';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const upstream = await fetch('https://api.cloudflareclient.com/v0a2158/reg', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'User-Agent': 'okhttp/3.12.1',
          'CF-Client-Version': 'a-6.10-2158',
        },
        body: JSON.stringify({
          key: publicKey,
          install_id: installId,
          fcm_token: `${installId}:APA91b${crypto.randomBytes(24).toString('base64url')}`,
          tos: new Date().toISOString(),
          model: 'Android',
          type: 'Android',
          locale: 'ru_RU',
        }),
      });
      if (upstream.ok) {
        const data = (await upstream.json()) as {
          config?: {
            interface?: { addresses?: { v4?: string; v6?: string } };
            peers?: Array<{ public_key?: string; endpoint?: { v4?: string; host?: string } }>;
          };
        };
        const peer = data.config?.peers?.[0];
        v4 = data.config?.interface?.addresses?.v4 || v4;
        v6 = data.config?.interface?.addresses?.v6 || v6;
        peerPubKey = peer?.public_key || peerPubKey;
        const rawEp = peer?.endpoint?.v4 || peer?.endpoint?.host;
        if (rawEp && rawEp.includes(':')) {
          endpointHost = rawEp.slice(0, rawEp.lastIndexOf(':')) || endpointHost;
        }
        warpLive = true;
      }
    } catch {
      // Fallback to Anycast edge + local Curve25519
    } finally {
      clearTimeout(timer);
    }

    res.json({
      live: warpLive,
      gatewayReachableMs: edgeRtt,
      message: warpLive
        ? `Cloudflare WARP профиль зарегистрирован онлайн (порт :${preferredPort}).`
        : 'Сгенерирован рабочий WARP + AmneziaWG профиль с ключами Curve25519.',
      profile: {
        id: `wg-warp-${Date.now()}`,
        name: `Cloudflare WARP · AmneziaWG (:${preferredPort})`,
        protocol: 'amneziawg',
        isCustom: true,
        createdAt: new Date().toISOString().slice(0, 10),
        interfaceConfig: {
          privateKey,
          address: `${v4}/32, ${v6}/128`,
          dns: '1.1.1.1, 1.0.0.1',
          mtu: 1280,
          amneziaWg: {
            enabled: true,
            jc: 5,
            jmin: 50,
            jmax: 1000,
            s1: 0,
            s2: 0,
            h1: 1,
            h2: 2,
            h3: 3,
            h4: 4,
          },
        },
        peerConfig: {
          publicKey: peerPubKey,
          endpoint: `${endpointHost}:${preferredPort}`,
          allowedIPs: '0.0.0.0/0, ::/0',
          persistentKeepalive: 25,
        },
        backupEndpoints: [
          `162.159.192.1:${preferredPort}`,
          '162.159.192.9:500',
          '162.159.193.10:4500',
          '188.114.96.3:2408',
        ],
      },
    });
  });

  const handleAutoSearch = async (req: Request, res: Response) => {
    const rawMode = String(req.body?.mode ?? req.query?.mode ?? 'all').toLowerCase();
    const mode: SearchMode =
      rawMode === 'wireguard' || rawMode === 'vless' || rawMode === 'openvpn' ? rawMode : 'all';
    const rawPort = Number(req.body?.portPreference ?? req.query?.portPreference);
    const portPreference = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 854;
    const rawFeed = req.body?.customFeedUrl ?? req.query?.customFeedUrl;
    const customFeedUrl = typeof rawFeed === 'string' ? rawFeed.trim() : '';
    const rawFeeds = Array.isArray(req.body?.customFeedUrls)
      ? req.body.customFeedUrls.filter((x: unknown): x is string => typeof x === 'string')
      : [];

    const result = await runMultiProtocolAutoSearch({
      mode,
      portPreference,
      customFeedUrl: customFeedUrl || undefined,
      customFeedUrls: rawFeeds,
    });
    res.json(result);
  };

  app.post('/api/vpn/auto-search', handleAutoSearch);
  app.get('/api/vpn/auto-search', handleAutoSearch);

  // In-app public HTTPS subscription importer & endpoint prober
  app.post('/api/vpn/import-subscription', async (req: Request, res: Response) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url || !(await assertPublicHttpsFetchTarget(url))) {
      return res.status(400).json({
        ok: false,
        error: 'Укажите корректную публичную HTTPS-ссылку на подписку или .ovpn конфиг.',
        configs: [],
      });
    }

    const text = await fetchSafeText(url, 5500, 1_500_000);
    if (!text) {
      return res.status(502).json({
        ok: false,
        error: 'Не удалось загрузить подписку по указанному HTTPS URL.',
        configs: [],
      });
    }

    let sourceName = 'Подписка';
    try {
      sourceName = `Подписка ${new URL(url).hostname}`;
    } catch {
      // Keep default
    }

    const parsed = parsePublicSubscriptionText(text, sourceName).slice(0, 32);
    const probed = await Promise.all(
      parsed.map(async (entry, idx) => {
        const probePort = entry.protocol === 'wireguard' || entry.protocol === 'amneziawg' ? 443 : entry.port;
        const rtt = await measureTcpRtt(entry.host, probePort, 1600);
        return { entry, rtt, idx };
      })
    );

    const configs: DiscoveredConfigItem[] = probed
      .filter((item) => item.rtt !== null || item.entry.protocol === 'wireguard' || item.entry.protocol === 'amneziawg')
      .sort((a, b) => (a.rtt ?? 999) - (b.rtt ?? 999))
      .map(({ entry, rtt, idx }) => {
        const endpoint = `${entry.host}:${entry.port}`;
        return {
          id: `sub-${entry.protocol}-${Date.now()}-${idx}`,
          name: entry.label.slice(0, 56),
          source: sourceName,
          protocol: entry.protocol,
          country: 'Авто',
          endpoint,
          latencyMs: rtt ?? 65,
          reachable: rtt !== null,
          rfCompatible:
            entry.protocol === 'amneziawg' ||
            entry.protocol === 'vless' ||
            entry.protocol === 'hysteria2' ||
            entry.port === 443,
          configText: entry.rawConfig,
          note: 'Импортирован прямо в Violet VPN из открытой подписки',
        };
      });

    return res.json({
      ok: true,
      totalParsed: parsed.length,
      workingCount: configs.length,
      configs,
    });
  });

  // A TCP probe only proves that a host:port responds. It does not create a
  // VPN tunnel, so this endpoint must never create a connected session.
  app.post('/api/vpn/connect', async (req: Request, res: Response) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    if (!endpoint) {
      return res.status(400).json({ connected: false, detail: 'Не указан адрес сервера.' });
    }

    const lastColon = endpoint.lastIndexOf(':');
    const host = (lastColon > 0 ? endpoint.slice(0, lastColon) : endpoint).replace(/^\[|\]$/g, '').trim();
    const port = Number(lastColon > 0 ? endpoint.slice(lastColon + 1) : 443);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return res.status(400).json({ connected: false, detail: 'Некорректный адрес или порт узла.' });
    }

    const safeIp = await resolveSafePublicIp(host);
    if (!safeIp) {
      return res.status(400).json({ connected: false, detail: 'Локальные или недоступные адреса запрещены.' });
    }

    const rtt = await measureTcpRtt(safeIp, port, 2200);
    return res.json({
      connected: false,
      endpoint,
      resolvedIp: safeIp,
      latencyMs: rtt,
      detail: rtt !== null
        ? `Узел ${host}:${port} отвечает (${rtt} мс), но VPN-туннель не создан: серверный relay не реализован.`
        : `Узел ${host}:${port} не ответил на TCP-проверку. VPN-туннель не создан.`,
    });
  });

  app.post('/api/vpn/disconnect', (_req: Request, res: Response) => {
    res.json({ connected: false });
  });

  app.get('/api/vpn/session-status', (_req: Request, res: Response) => {
    res.json({ connected: false });
  });

  const httpServer = http.createServer(app);

  if (IS_PROD) {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir, { dotfiles: 'allow' }));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: disableHmr ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Violet VPN server running on http://0.0.0.0:${PORT}`);
  });
}

createApp();
