import { AndroidAppEntry, DnsPreset, ProfileProtocol, VpnSettings, WireGuardProfile } from '../types/vpn';

export const DNS_PRESETS: DnsPreset[] = [
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    address: '1.1.1.1, 1.0.0.1',
    description: 'Быстрый публичный DNS без фильтрации',
  },
  {
    id: 'adguard',
    label: 'AdGuard DNS',
    address: '94.140.14.14, 94.140.15.15',
    description: 'Блокировка рекламы, трекеров и фишинга',
  },
  {
    id: 'quad9',
    label: 'Quad9 Security',
    address: '9.9.9.9',
    description: 'Защита от вредоносных доменов',
  },
];

export const INITIAL_ANDROID_APPS: AndroidAppEntry[] = [
  { id: 'chrome', name: 'Google Chrome', packageName: 'com.android.chrome', category: 'Браузер', bypassVpn: false },
  { id: 'telegram', name: 'Telegram', packageName: 'org.telegram.messenger', category: 'Мессенджер', bypassVpn: false },
  { id: 'youtube', name: 'YouTube', packageName: 'com.google.android.youtube', category: 'Медиа', bypassVpn: false },
  { id: 'sber', name: 'СберБанк Онлайн', packageName: 'ru.sberbankmobile', category: 'Финансы', bypassVpn: true },
  { id: 'gosuslugi', name: 'Госуслуги', packageName: 'ru.rostel', category: 'Сервисы', bypassVpn: true },
];

export const DEFAULT_SETTINGS: VpnSettings = {
  killSwitch: true,
  ipv6Enabled: true,
  dnsPresetId: 'cloudflare',
  mtu: 1280,
  keepalive: 25,
  preferredWarpPort: 854,
  splitTunnelMode: 'exclude',
  theme: 'dark',
};

export const DEFAULT_WARP_AMNEZIA_WG = {
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
};

export function generateBase64Key(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function createWarpDefaultProfile(port = 854, dns = '1.1.1.1, 1.0.0.1', mtu = 1280): WireGuardProfile {
  return {
    id: `wg-warp-${Date.now()}`,
    name: `Cloudflare WARP · AmneziaWG (:${port})`,
    protocol: 'amneziawg',
    isCustom: true,
    source: 'Cloudflare Anycast',
    createdAt: new Date().toISOString().slice(0, 10),
    interfaceConfig: {
      privateKey: generateBase64Key(),
      address: '172.16.0.2/32, 2606:4700:110:8a0e::2/128',
      dns,
      mtu,
      amneziaWg: { ...DEFAULT_WARP_AMNEZIA_WG, enabled: true },
    },
    peerConfig: {
      publicKey: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
      endpoint: `162.159.192.1:${port}`,
      allowedIPs: '0.0.0.0/0, ::/0',
      persistentKeepalive: 25,
    },
    backupEndpoints: [
      `162.159.192.1:${port}`,
      '162.159.192.9:500',
      '162.159.193.10:4500',
      '188.114.96.3:2408',
    ],
  };
}

export const INITIAL_PROFILES: WireGuardProfile[] = [createWarpDefaultProfile(854)];

export function getProfileProtocol(profile?: WireGuardProfile): ProfileProtocol {
  if (!profile) return 'amneziawg';
  if (profile.protocol) return profile.protocol;
  if (profile.openvpnConfig) return 'openvpn';
  if (profile.vlessConfig) return 'vless';
  return profile.interfaceConfig.amneziaWg?.enabled ? 'amneziawg' : 'wireguard';
}

export function isWireGuardFamily(proto: ProfileProtocol): boolean {
  return proto === 'wireguard' || proto === 'amneziawg';
}

export function isProxyUriFamily(proto: ProfileProtocol): boolean {
  return (
    proto === 'vless' ||
    proto === 'hysteria2' ||
    proto === 'trojan' ||
    proto === 'vmess' ||
    proto === 'shadowsocks'
  );
}

export function getProfileProtocolLabel(proto: ProfileProtocol): string {
  switch (proto) {
    case 'amneziawg':
      return 'AmneziaWG';
    case 'wireguard':
      return 'WireGuard';
    case 'openvpn':
      return 'OpenVPN';
    case 'vless':
      return 'VLESS';
    case 'hysteria2':
      return 'Hysteria2';
    case 'trojan':
      return 'Trojan';
    case 'vmess':
      return 'VMess';
    case 'shadowsocks':
      return 'Shadowsocks';
  }
}

export function getProfileFileExtension(profile?: WireGuardProfile): 'conf' | 'ovpn' | 'txt' {
  const proto = getProfileProtocol(profile);
  if (proto === 'openvpn') return 'ovpn';
  if (isProxyUriFamily(proto)) return 'txt';
  return 'conf';
}

export function serializeWireGuardConfig(profile: WireGuardProfile): string {
  const proto = getProfileProtocol(profile);
  if (profile.rawOriginalConfig && !isWireGuardFamily(proto)) {
    return profile.rawOriginalConfig;
  }

  const lines = [
    '[Interface]',
    `PrivateKey = ${profile.interfaceConfig.privateKey}`,
    `Address = ${profile.interfaceConfig.address}`,
    `DNS = ${profile.interfaceConfig.dns}`,
    `MTU = ${profile.interfaceConfig.mtu}`,
  ];
  const awg = profile.interfaceConfig.amneziaWg;
  if (awg?.enabled) {
    lines.push(
      `Jc = ${awg.jc}`,
      `Jmin = ${awg.jmin}`,
      `Jmax = ${awg.jmax}`,
      `S1 = ${awg.s1}`,
      `S2 = ${awg.s2}`,
      `H1 = ${awg.h1}`,
      `H2 = ${awg.h2}`,
      `H3 = ${awg.h3}`,
      `H4 = ${awg.h4}`
    );
  }
  lines.push('', '[Peer]', `PublicKey = ${profile.peerConfig.publicKey}`);
  if (profile.peerConfig.presharedKey) {
    lines.push(`PresharedKey = ${profile.peerConfig.presharedKey}`);
  }
  lines.push(
    `AllowedIPs = ${profile.peerConfig.allowedIPs}`,
    `Endpoint = ${profile.peerConfig.endpoint}`,
    `PersistentKeepalive = ${profile.peerConfig.persistentKeepalive}`
  );
  return lines.join('\n');
}

export function detectVpnConfigFormat(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^vless:\/\//im.test(trimmed)) return 'VLESS (URI / Reality / TLS)';
  if (/^(hysteria2|hy2):\/\//im.test(trimmed)) return 'Hysteria2 (QUIC)';
  if (/^trojan:\/\//im.test(trimmed)) return 'Trojan (TLS)';
  if (/^vmess:\/\//im.test(trimmed)) return 'VMess';
  if (/^ss:\/\//im.test(trimmed)) return 'Shadowsocks';
  if (/\[Interface\]/i.test(trimmed) && /\[Peer\]/i.test(trimmed)) {
    return /\b(Jc|Jmin|Jmax|H1)\s*=/i.test(trimmed) ? 'AmneziaWG (.conf)' : 'WireGuard (.conf)';
  }
  if (/^\s*remote\s+[^\s]+/im.test(trimmed) || /<ca>/i.test(trimmed) || /^\s*dev\s+tun/im.test(trimmed)) {
    return 'OpenVPN (.ovpn)';
  }
  if (/^[A-Za-z0-9+/=\r\n]{24,}$/.test(trimmed)) {
    return 'Base64-подписка';
  }
  return null;
}

export function parseWireGuardConfig(raw: string, customName?: string): { profile?: WireGuardProfile; error?: string } {
  const lines = raw.split(/\r?\n/);
  let section: 'interface' | 'peer' | null = null;
  const iface: Record<string, string> = {};
  const peer: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.toLowerCase() === '[interface]') {
      section = 'interface';
      continue;
    }
    if (line.toLowerCase() === '[peer]') {
      section = 'peer';
      continue;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1 || !section) continue;
    const key = line.slice(0, eqIndex).trim().toLowerCase();
    const val = line.slice(eqIndex + 1).trim();
    if (section === 'interface') iface[key] = val;
    else peer[key] = val;
  }

  if (!iface.privatekey || !peer.publickey || !peer.endpoint) {
    return {
      error: 'Файл WireGuard должен содержать [Interface] (PrivateKey) и [Peer] (PublicKey, Endpoint).',
    };
  }

  const mtuParsed = parseInt(iface.mtu || '1420', 10);
  const keepaliveParsed = parseInt(peer.persistentkeepalive || '25', 10);
  const hostPart = peer.endpoint.split(':')[0] || 'Custom Peer';
  const hasAmnezia =
    iface.jc !== undefined ||
    iface.jmin !== undefined ||
    iface.jmax !== undefined ||
    iface.h1 !== undefined;

  return {
    profile: {
      id: `wg-custom-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: customName?.trim() || `Туннель ${hostPart}`,
      protocol: hasAmnezia ? 'amneziawg' : 'wireguard',
      isCustom: true,
      createdAt: new Date().toISOString().slice(0, 10),
      interfaceConfig: {
        privateKey: iface.privatekey,
        address: iface.address || '10.64.0.2/32',
        dns: iface.dns || '1.1.1.1',
        mtu: Number.isFinite(mtuParsed) ? Math.min(1500, Math.max(1280, mtuParsed)) : 1420,
        ...(hasAmnezia
          ? {
              amneziaWg: {
                enabled: true,
                jc: parseInt(iface.jc || '5', 10) || 5,
                jmin: parseInt(iface.jmin || '50', 10) || 50,
                jmax: parseInt(iface.jmax || '1000', 10) || 1000,
                s1: parseInt(iface.s1 || '0', 10) || 0,
                s2: parseInt(iface.s2 || '0', 10) || 0,
                h1: parseInt(iface.h1 || '1', 10) || 1,
                h2: parseInt(iface.h2 || '2', 10) || 2,
                h3: parseInt(iface.h3 || '3', 10) || 3,
                h4: parseInt(iface.h4 || '4', 10) || 4,
              },
            }
          : {}),
      },
      peerConfig: {
        publicKey: peer.publickey,
        presharedKey: peer.presharedkey || undefined,
        endpoint: peer.endpoint,
        allowedIPs: peer.allowedips || '0.0.0.0/0, ::/0',
        persistentKeepalive: Number.isFinite(keepaliveParsed) ? keepaliveParsed : 25,
      },
    },
  };
}

export function parseOpenVpnConfig(raw: string, customName?: string): { profile?: WireGuardProfile; error?: string } {
  const trimmed = raw.trim();
  const remoteMatch = trimmed.match(/^\s*remote\s+([^\s#;]+)(?:\s+(\d+))?(?:\s+(udp|tcp\S*))?/im);
  if (!remoteMatch) {
    return { error: 'Файл .ovpn должен содержать директиву «remote <сервер> <порт>».' };
  }

  const remoteHost = remoteMatch[1].trim();
  const parsedPort = Number(remoteMatch[2] || 1194);
  const remotePort = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 1194;
  const protoMatch = trimmed.match(/^\s*proto\s+([^\s#;]+)/im);
  const rawProto = (remoteMatch[3] || protoMatch?.[1] || 'udp').toLowerCase();
  const proto: 'udp' | 'tcp' = rawProto.startsWith('tcp') ? 'tcp' : 'udp';
  const cipherMatch = trimmed.match(/^\s*(?:data-ciphers|cipher)\s+([^\r\n#;]+)/im);
  const cipher = cipherMatch?.[1]?.trim();
  const hasInlineCerts = /<ca>|<cert>|<key>|<tls-auth>|<tls-crypt>/i.test(trimmed);
  const authUserPass = /^\s*auth-user-pass\b/im.test(trimmed);

  return {
    profile: {
      id: `ovpn-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: customName?.trim() || `OpenVPN ${remoteHost}`,
      protocol: 'openvpn',
      isCustom: true,
      createdAt: new Date().toISOString().slice(0, 10),
      rawOriginalConfig: trimmed,
      openvpnConfig: {
        remoteHost,
        remotePort,
        proto,
        cipher,
        hasInlineCerts,
        authUserPass,
      },
      interfaceConfig: {
        privateKey: '',
        address: `OpenVPN (${proto.toUpperCase()})`,
        dns: 'Авто (от сервера)',
        mtu: 1500,
      },
      peerConfig: {
        publicKey: '',
        endpoint: `${remoteHost}:${remotePort}`,
        allowedIPs: '0.0.0.0/0',
        persistentKeepalive: 10,
      },
    },
  };
}

export function parseVlessUri(rawLine: string, customName?: string): { profile?: WireGuardProfile; error?: string } {
  const line = rawLine.trim();
  const schemeMatch = line.match(/^(vless|hysteria2|hy2|trojan|vmess|ss):\/\/(.+)$/i);
  if (!schemeMatch) {
    return { error: 'Ссылка должна начинаться с vless://, hy2://, trojan://, vmess:// или ss://' };
  }
  const rawScheme = schemeMatch[1].toLowerCase();

  if (rawScheme === 'vmess') {
    try {
      const b64Payload = schemeMatch[2].split('#')[0].trim();
      const json = JSON.parse(atob(b64Payload)) as {
        add?: string;
        port?: number | string;
        id?: string;
        ps?: string;
        tls?: string;
        net?: string;
        sni?: string;
      };
      const host = String(json.add || '').trim().replace(/^\[|\]$/g, '');
      const port = Number(json.port || 443);
      const uuid = String(json.id || '').trim();
      if (!host || !uuid || !Number.isInteger(port) || port <= 0 || port > 65535) {
        return { error: 'Некорректный VMess-конфиг.' };
      }
      const security = (json.tls || 'none').toLowerCase();
      const network = (json.net || 'tcp').toLowerCase();
      return {
        profile: {
          id: `vmess-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: customName?.trim() || String(json.ps || '').trim() || `VMess ${host}`,
          protocol: 'vmess',
          isCustom: true,
          createdAt: new Date().toISOString().slice(0, 10),
          rawOriginalConfig: line,
          vlessConfig: {
            uuid,
            host,
            port,
            security,
            sni: json.sni || undefined,
            network,
            uri: line,
          },
          interfaceConfig: {
            privateKey: '',
            address: `VMESS · ${security.toUpperCase()} · ${network.toUpperCase()}`,
            dns: '1.1.1.1',
            mtu: 1500,
          },
          peerConfig: {
            publicKey: uuid,
            endpoint: `${host}:${port}`,
            allowedIPs: '0.0.0.0/0, ::/0',
            persistentKeepalive: 0,
          },
        },
      };
    } catch {
      return { error: 'Не удалось декодировать VMess JSON.' };
    }
  }

  const protocol: ProfileProtocol =
    rawScheme === 'hy2' || rawScheme === 'hysteria2'
      ? 'hysteria2'
      : rawScheme === 'trojan'
        ? 'trojan'
        : rawScheme === 'ss'
          ? 'shadowsocks'
          : 'vless';

  try {
    const normalized = new URL(line.replace(/^(vless|hysteria2|hy2|trojan|ss):\/\//i, 'https://'));
    const uuid = decodeURIComponent(normalized.username || '').trim() || 'sip002';
    const host = normalized.hostname.replace(/^\[|\]$/g, '');
    const port = Number(normalized.port || (protocol === 'shadowsocks' ? 8388 : 443));
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return { error: 'Некорректная ссылка: проверьте хост и порт.' };
    }
    const q = normalized.searchParams;
    const security = (q.get('security') || (protocol === 'vless' ? 'none' : 'tls')).toLowerCase();
    const network = (q.get('type') || (protocol === 'hysteria2' ? 'udp' : 'tcp')).toLowerCase();
    const sni = q.get('sni') || q.get('host') || undefined;
    const flow = q.get('flow') || undefined;
    const pbk = q.get('pbk') || undefined;
    const remark = decodeURIComponent(normalized.hash.replace(/^#/, '') || '').trim();

    return {
      profile: {
        id: `${protocol}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: customName?.trim() || remark || `${protocol.toUpperCase()} ${host}`,
        protocol,
        isCustom: true,
        createdAt: new Date().toISOString().slice(0, 10),
        rawOriginalConfig: line,
        vlessConfig: {
          uuid,
          host,
          port,
          security,
          sni,
          pbk,
          flow,
          network,
          uri: line,
        },
        interfaceConfig: {
          privateKey: '',
          address: `${protocol.toUpperCase()} · ${security.toUpperCase()} · ${network.toUpperCase()}`,
          dns: '1.1.1.1',
          mtu: 1500,
        },
        peerConfig: {
          publicKey: pbk || uuid,
          endpoint: `${host}:${port}`,
          allowedIPs: '0.0.0.0/0, ::/0',
          persistentKeepalive: 0,
        },
      },
    };
  } catch {
    return { error: 'Не удалось разобрать ссылку. Проверьте её синтаксис.' };
  }
}

export function parseAnyVpnConfigs(
  raw: string,
  customName?: string
): { profiles?: WireGuardProfile[]; error?: string } {
  let content = raw.trim();
  if (!content) {
    return { error: 'Конфигурация пуста.' };
  }

  if (
    !content.includes('://') &&
    !content.includes('[Interface]') &&
    !/^\s*remote\s+/im.test(content) &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(content)
  ) {
    try {
      const binary = atob(content.replace(/\s+/g, ''));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (decoded.includes('://') || decoded.includes('[Interface]') || /^\s*remote\s+/im.test(decoded)) {
        content = decoded.trim();
      }
    } catch {
      // Keep original text
    }
  }

  if (content.includes('[Interface]') && content.includes('[Peer]')) {
    const res = parseWireGuardConfig(content, customName);
    return res.profile ? { profiles: [res.profile] } : { error: res.error };
  }

  const uriLines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(vless|hysteria2|hy2|trojan|vmess|ss):\/\//i.test(l));
  if (uriLines.length > 0) {
    const parsed: WireGuardProfile[] = [];
    for (const line of uriLines.slice(0, 25)) {
      const r = parseVlessUri(line, uriLines.length === 1 ? customName : undefined);
      if (r.profile) parsed.push(r.profile);
    }
    if (parsed.length > 0) return { profiles: parsed };
    return { error: 'Найдены ссылки, но не удалось разобрать их параметры.' };
  }

  if (/^\s*remote\s+/im.test(content) || /\bdev\s+tun\b/i.test(content) || /<ca>/i.test(content)) {
    const res = parseOpenVpnConfig(content, customName);
    return res.profile ? { profiles: [res.profile] } : { error: res.error };
  }

  return {
    error: 'Неизвестный формат. Поддерживаются .conf (WireGuard/AmneziaWG), .ovpn (OpenVPN) и vless:// / trojan:// / hy2:// / vmess:// / ss://.',
  };
}
