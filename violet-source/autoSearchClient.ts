import {
  AutoDiscoveredVpnConfig,
  AutoSearchMode,
  AutoSearchResponse,
  EndpointVerificationResult,
  ProfileProtocol,
  WireGuardProfile,
} from '../types/vpn';
import {
  DEFAULT_WARP_AMNEZIA_WG,
  generateBase64Key,
  serializeWireGuardConfig,
} from '../data/vpnData';

const PUBLIC_CORS_GITHUB_FEEDS = [
  {
    name: 'BarryFar Sub1 (VLESS/Trojan)',
    url: 'https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Sub1.txt',
  },
  {
    name: 'BarryFar Sub2 (VLESS/Trojan)',
    url: 'https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Sub2.txt',
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

const CLOUDFLARE_ANYCAST_IPS = [
  '162.159.192.1',
  '162.159.192.9',
  '162.159.193.10',
  '188.114.96.3',
  '188.114.97.7',
  '188.114.98.224',
];

const RF_WARP_PORTS = [854, 500, 4500, 2408];

function isPrivateOrLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) {
    return true;
  }
  const parts = h.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

function isSafeClientHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return !isPrivateOrLocalHost(parsed.hostname);
  } catch {
    return false;
  }
}

function decodeBase64Utf8(input: string): string {
  const clean = input.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function parseSubscriptionLines(
  rawText: string,
  sourceName: string,
  mode: AutoSearchMode
): AutoDiscoveredVpnConfig[] {
  let decoded = rawText.trim();
  if (
    decoded &&
    !decoded.includes('://') &&
    !decoded.includes('[Interface]') &&
    !/^[A-Za-z0-9+/=\r\n]+$/.test(decoded) === false
  ) {
    try {
      const b64 = decodeBase64Utf8(decoded);
      if (b64.includes('://') || b64.includes('[Interface]')) {
        decoded = b64;
      }
    } catch {
      // Keep raw text
    }
  }

  const results: AutoDiscoveredVpnConfig[] = [];
  const seen = new Set<string>();
  const now = Date.now();

  if ((mode === 'all' || mode === 'wireguard') && decoded.includes('[Interface]') && decoded.includes('[Peer]')) {
    const blocks = decoded.split(/(?=\[Interface\])/i).filter((b) => b.includes('[Peer]'));
    for (const block of blocks.slice(0, 8)) {
      const iface: Record<string, string> = {};
      const peer: Record<string, string> = {};
      let sec: 'iface' | 'peer' | null = null;
      for (const rl of block.split(/\r?\n/)) {
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
        if (host && !isPrivateOrLocalHost(host) && Number.isInteger(port) && port > 0 && port <= 65535) {
          const ep = `${host}:${port}`;
          if (seen.has(ep)) continue;
          seen.add(ep);
          const hasAwg = Boolean(iface.jc || iface.jmin || iface.h1);
          const protocol: ProfileProtocol = hasAwg ? 'amneziawg' : 'wireguard';
          const wgProfile: WireGuardProfile = {
            id: `wg-direct-${now}-${results.length}`,
            name: `${sourceName} (${host})`.slice(0, 48),
            protocol,
            isCustom: true,
            source: sourceName,
            createdAt: new Date().toISOString().slice(0, 10),
            interfaceConfig: {
              privateKey: iface.privatekey,
              address: iface.address || '10.64.0.2/32',
              dns: iface.dns || '1.1.1.1',
              mtu: Math.min(1500, Math.max(1280, parseInt(iface.mtu || '1420', 10) || 1420)),
              ...(hasAwg ? { amneziaWg: { ...DEFAULT_WARP_AMNEZIA_WG, enabled: true } } : {}),
            },
            peerConfig: {
              publicKey: peer.publickey,
              endpoint: ep,
              allowedIPs: peer.allowedips || '0.0.0.0/0, ::/0',
              persistentKeepalive: parseInt(peer.persistentkeepalive || '25', 10) || 25,
            },
          };
          results.push({
            id: `direct-wg-${now}-${results.length}`,
            name: wgProfile.name,
            source: sourceName,
            protocol,
            country: 'Авто',
            endpoint: ep,
            latencyMs: null,
            reachable: false,
            rfCompatible: hasAwg || port === 443,
            configText: block.trim(),
            wireguardProfile: wgProfile,
            note: 'Готов к подключению в WireGuard / AmneziaWG',
          });
        }
      }
    }
  }

  if (mode === 'all' || mode === 'vless') {
    for (const rawLine of decoded.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^(vless|hysteria2|hy2|trojan|vmess|ss):\/\/(.+)$/i);
      if (!match) continue;
      const scheme = match[1].toLowerCase();

      if (scheme === 'vmess') {
        try {
          const json = JSON.parse(atob(match[2].split('#')[0].trim())) as { add?: string; port?: number; ps?: string };
          const host = String(json.add || '').trim().replace(/^\[|\]$/g, '');
          const port = Number(json.port || 443);
          if (host && !isPrivateOrLocalHost(host) && port > 0 && port <= 65535) {
            const ep = `${host}:${port}`;
            if (seen.has(ep)) continue;
            seen.add(ep);
            results.push({
              id: `direct-vmess-${now}-${results.length}`,
              name: (String(json.ps || '').trim() || `VMess ${host}`).slice(0, 56),
              source: sourceName,
              protocol: 'vmess',
              country: 'Авто',
              endpoint: ep,
              latencyMs: null,
              reachable: false,
              rfCompatible: port === 443,
              configText: line,
              note: 'Импортирован из публичной подписки; доступность и подключение ещё не проверены',
            });
          }
        } catch {
          // Ignore malformed vmess
        }
        if (results.length >= 16) break;
        continue;
      }

      const protocol: ProfileProtocol =
        scheme === 'hy2' || scheme === 'hysteria2'
          ? 'hysteria2'
          : scheme === 'trojan'
            ? 'trojan'
            : scheme === 'ss'
              ? 'shadowsocks'
              : 'vless';
      try {
        const u = new URL(line.replace(/^(hy2|hysteria2|vless|trojan|ss):\/\//i, 'https://'));
        const host = u.hostname.replace(/^\[|\]$/g, '');
        const port = Number(u.port || (protocol === 'shadowsocks' ? 8388 : 443));
        if (!host || isPrivateOrLocalHost(host) || !Number.isInteger(port) || port <= 0 || port > 65535) {
          continue;
        }
        const ep = `${host}:${port}`;
        if (seen.has(ep)) continue;
        seen.add(ep);
        const remark = decodeURIComponent(u.hash.replace(/^#/, '') || '').trim();
        results.push({
          id: `direct-${protocol}-${now}-${results.length}`,
          name: (remark || `${protocol.toUpperCase()} ${host}`).slice(0, 56),
          source: sourceName,
          protocol,
          country: 'Авто',
          endpoint: ep,
          latencyMs: null,
          reachable: false,
          rfCompatible: protocol === 'vless' || protocol === 'hysteria2' || port === 443,
          configText: line,
          note: 'Импортирован из публичной подписки; доступность и подключение ещё не проверены',
        });
      } catch {
        // Ignore malformed URI
      }
      if (results.length >= 16) break;
    }
  }

  return results;
}

export async function runClientDirectAutoSearch(params: {
  mode: AutoSearchMode;
  portPreference: number;
  customFeedUrl?: string;
  customFeedUrls?: string[];
  backendStatusReason?: string;
}): Promise<AutoSearchResponse> {
  const { mode, portPreference, customFeedUrl, customFeedUrls, backendStatusReason } = params;
  const sourcesChecked: AutoSearchResponse['sourcesChecked'] = [];
  const configs: AutoDiscoveredVpnConfig[] = [];
  let scannedCandidates = 0;

  if (backendStatusReason) {
    sourcesChecked.push({
      name: 'Бэкенд-сканер',
      status: 'partial',
      found: 0,
      detail: `${backendStatusReason} Используется прямой поиск из браузера.`,
    });
  }

  // Direct fallback only imports subscription candidates. It cannot register a
  // Cloudflare WARP identity or claim that a generated random key is valid.

  if (mode === 'all' || mode === 'vless' || mode === 'wireguard') {
    const jobs = [...PUBLIC_CORS_GITHUB_FEEDS];
    const extraFeeds = Array.from(
      new Set([customFeedUrl, ...(customFeedUrls || [])].map((u) => (u || '').trim()).filter(Boolean))
    );
    for (let i = extraFeeds.length - 1; i >= 0; i--) {
      const feed = extraFeeds[i];
      if (isSafeClientHttpsUrl(feed)) {
        let label = 'Пользовательская подписка';
        try {
          label = `Подписка ${new URL(feed).hostname}`;
        } catch {
          // Keep default label
        }
        jobs.unshift({ name: label, url: feed });
      } else {
        sourcesChecked.push({
          name: 'Пользовательская подписка',
          status: 'unavailable',
          found: 0,
          detail: 'URL отклонён: разрешены только публичные HTTPS-ссылки.',
        });
      }
    }

    await Promise.all(
      jobs.map(async (job) => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 5000);
        try {
          const resp = await fetch(job.url, { signal: controller.signal });
          if (!resp.ok) {
            sourcesChecked.push({
              name: job.name,
              status: 'unavailable',
              found: 0,
              detail: `HTTP ${resp.status}`,
            });
            return;
          }
          const text = await resp.text();
          const parsed = parseSubscriptionLines(text, job.name, mode);
          scannedCandidates += parsed.length;
          configs.push(...parsed.slice(0, 8));
          sourcesChecked.push({
            name: job.name,
            status: parsed.length > 0 ? 'ok' : 'partial',
            found: parsed.length,
            detail: `Получено записей: ${parsed.length}`,
          });
        } catch {
          sourcesChecked.push({
            name: job.name,
            status: 'unavailable',
            found: 0,
            detail: 'Таймаут или CORS-ограничение.',
          });
        } finally {
          window.clearTimeout(timer);
        }
      })
    );
  }

  return {
    searchedAt: new Date().toISOString(),
    scannedCandidates,
    workingCount: configs.filter((item) => item.reachable).length,
    sourcesChecked,
    configs,
  };
}

export async function performAutoSearch(params: {
  mode: AutoSearchMode;
  portPreference: number;
  customFeedUrl?: string;
  customFeedUrls?: string[];
}): Promise<AutoSearchResponse> {
  const { mode, portPreference, customFeedUrl, customFeedUrls } = params;
  let failureReason = '';

  try {
    const resp = await fetch('/api/vpn/auto-search', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        portPreference,
        customFeedUrl: customFeedUrl?.trim() || undefined,
        customFeedUrls: customFeedUrls?.filter((u) => u.trim().length > 0),
      }),
    });
    const ct = resp.headers.get('content-type') || '';
    if (resp.ok && ct.includes('application/json')) {
      return (await resp.json()) as AutoSearchResponse;
    }
    failureReason = `POST /api/vpn/auto-search: HTTP ${resp.status}`;
  } catch {
    failureReason = 'POST /api/vpn/auto-search недоступен';
  }

  try {
    const qs = new URLSearchParams({
      mode,
      portPreference: String(portPreference),
    });
    if (customFeedUrl?.trim()) qs.set('customFeedUrl', customFeedUrl.trim());
    const respGet = await fetch(`/api/vpn/auto-search?${qs.toString()}`, {
      method: 'GET',
      credentials: 'include',
    });
    const ctGet = respGet.headers.get('content-type') || '';
    if (respGet.ok && ctGet.includes('application/json')) {
      return (await respGet.json()) as AutoSearchResponse;
    }
    failureReason = `GET /api/vpn/auto-search: HTTP ${respGet.status}`;
  } catch {
    failureReason = 'Сервер поиска недоступен по сети';
  }

  return runClientDirectAutoSearch({
    mode,
    portPreference,
    customFeedUrl,
    customFeedUrls,
    backendStatusReason: failureReason,
  });
}

export async function verifyEndpointReachability(
  endpoint: string,
  protocol: string
): Promise<EndpointVerificationResult> {
  const cleanEp = endpoint.trim();
  const lastColon = cleanEp.lastIndexOf(':');
  const host = (lastColon > 0 ? cleanEp.slice(0, lastColon) : cleanEp).replace(/^\[|\]$/g, '');
  const port = Number(lastColon > 0 ? cleanEp.slice(lastColon + 1) : 443) || 443;

  try {
    const resp = await fetch('/api/vpn/test-endpoint', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: cleanEp, protocol }),
    });
    const ct = resp.headers.get('content-type') || '';
    if (resp.ok && ct.includes('application/json')) {
      const data = (await resp.json()) as {
        reachable?: boolean;
        latencyMs?: number | null;
        detail?: string;
        host?: string;
        port?: number;
      };
      return {
        reachable: Boolean(data.reachable),
        latencyMs: data.latencyMs ?? null,
        host: data.host || host,
        port: data.port || port,
        protocol,
        checkedAt: new Date().toISOString(),
        note: data.detail || '',
      };
    }
  } catch {
    // Fallback to GET below
  }

  try {
    const qs = new URLSearchParams({ endpoint: cleanEp, protocol });
    const respGet = await fetch(`/api/vpn/test-endpoint?${qs.toString()}`, {
      method: 'GET',
      credentials: 'include',
    });
    const ctGet = respGet.headers.get('content-type') || '';
    if (respGet.ok && ctGet.includes('application/json')) {
      const data = (await respGet.json()) as {
        reachable?: boolean;
        latencyMs?: number | null;
        detail?: string;
        host?: string;
        port?: number;
      };
      return {
        reachable: Boolean(data.reachable),
        latencyMs: data.latencyMs ?? null,
        host: data.host || host,
        port: data.port || port,
        protocol,
        checkedAt: new Date().toISOString(),
        note: data.detail || '',
      };
    }
  } catch {
    // Fallback below
  }

  return {
    reachable: false,
    latencyMs: null,
    host,
    port,
    protocol,
    checkedAt: new Date().toISOString(),
    viaBrowserFallback: true,
    note: `Браузер не смог проверить ${host}:${port}: CORS или отсутствие серверной проверки. Отклик Cloudflare не является проверкой этого узла.`,
  };
}

export async function fetchCurrentPublicIp(): Promise<string | null> {
  try {
    const resp = await fetch('/api/vpn/my-ip', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    const ct = resp.headers.get('content-type') || '';
    if (resp.ok && ct.includes('application/json')) {
      const data = (await resp.json()) as { ip?: string };
      if (data.ip && data.ip !== 'Не определён') return data.ip;
    }
  } catch {
    // Ignored
  }
  return null;
}

export async function registerWarpProfileOnServer(port: number): Promise<WireGuardProfile | null> {
  try {
    const resp = await fetch('/api/warp/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { profile?: WireGuardProfile };
      if (data.profile) return data.profile;
    }
  } catch {
    // Ignored
  }
  return null;
}

export interface ServerConnectResult {
  connected: boolean;
  sessionId?: string;
  endpoint?: string;
  resolvedIp?: string;
  latencyMs?: number | null;
  connectedAtMs?: number;
  checksCount?: number;
  detail: string;
}

export async function connectInAppSession(params: {
  endpoint: string;
  protocol: ProfileProtocol;
  name: string;
}): Promise<ServerConnectResult> {
  try {
    const resp = await fetch('/api/vpn/connect', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return (await resp.json()) as ServerConnectResult;
    }
  } catch {
    // Fallback below if running in offline WebView asset mode
  }

  // A browser RTT check is not a VPN tunnel. Never report a connection unless
  // the Android VPN service or a real server-side tunnel confirms it.
  return {
    connected: false,
    endpoint: params.endpoint,
    latencyMs: null,
    detail: `Не удалось запустить VPN-туннель для ${params.endpoint}: нет подтверждённого Android VPN-сервиса или серверного relay. Проверка доступности узла не заменяет VPN-подключение.`,
  };
}

export async function disconnectInAppSession(): Promise<void> {
  try {
    await fetch('/api/vpn/disconnect', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Ignored
  }
}

export async function pollInAppSessionHeartbeat(): Promise<{
  connected: boolean;
  latencyMs?: number | null;
  checksCount?: number;
} | null> {
  try {
    const resp = await fetch('/api/vpn/session-status?probe=1', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    const ct = resp.headers.get('content-type') || '';
    if (resp.ok && ct.includes('application/json')) {
      return (await resp.json()) as {
        connected: boolean;
        latencyMs?: number | null;
        checksCount?: number;
      };
    }
  } catch {
    // Ignored
  }
  return null;
}

export async function importSubscriptionFeed(
  url: string
): Promise<{ ok: boolean; error?: string; configs: AutoDiscoveredVpnConfig[] }> {
  const cleanUrl = url.trim();
  if (!isSafeClientHttpsUrl(cleanUrl)) {
    return { ok: false, error: 'Разрешены только публичные HTTPS-ссылки на подписки.', configs: [] };
  }

  try {
    const resp = await fetch('/api/vpn/import-subscription', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: cleanUrl }),
    });
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = (await resp.json()) as {
        ok?: boolean;
        error?: string;
        configs?: AutoDiscoveredVpnConfig[];
      };
      return {
        ok: Boolean(data.ok),
        error: data.error,
        configs: data.configs || [],
      };
    }
  } catch {
    // Fallback to direct client fetch
  }

  try {
    const directResp = await fetch(cleanUrl);
    if (!directResp.ok) {
      return { ok: false, error: `HTTP ${directResp.status}`, configs: [] };
    }
    const text = await directResp.text();
    const parsed = parseSubscriptionLines(text, `Подписка ${new URL(cleanUrl).hostname}`, 'all');
    return {
      ok: parsed.length > 0,
      error: parsed.length === 0 ? 'Подписка не содержит поддерживаемых конфигураций.' : undefined,
      configs: parsed,
    };
  } catch {
    return { ok: false, error: 'Не удалось загрузить подписку.', configs: [] };
  }
}

