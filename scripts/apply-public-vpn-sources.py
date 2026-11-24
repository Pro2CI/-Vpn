from pathlib import Path
import re

path = Path("src/services/autoSearchClient.ts")
source = path.read_text(encoding="utf-8")

start = source.index("const PUBLIC_CORS_GITHUB_FEEDS = [")
end = source.index("\n];", start) + 3
feeds = """const PUBLIC_CORS_GITHUB_FEEDS = [
  // Au1rxx publishes V2Ray links tested through real HTTP traffic and refreshes hourly.
  {
    name: 'Au1rxx — проверенные V2Ray узлы',
    url: 'https://raw.githubusercontent.com/Au1rxx/free-vpn-subscriptions/main/output/v2ray-base64.txt',
  },
  {
    name: 'Au1rxx — Франция',
    url: 'https://raw.githubusercontent.com/Au1rxx/free-vpn-subscriptions/main/output/v2ray-base64-FR.txt',
  },
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
];"""
source = source[:start] + feeds + source[end:]

source = source.replace(
    "const clean = input.replace(/\\s+/g, '');\n  const binary = atob(clean);",
    "const clean = input.replace(/\\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');\n  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);\n  const binary = atob(padded);"
)
source = source.replace(
    "!decoded.includes('://') &&\n    !decoded.includes('[Interface]') &&\n    !/^[A-Za-z0-9+/=\\r\\n]+$/.test(decoded) === false",
    "!decoded.includes('://') &&\n    !decoded.includes('[Interface]') &&\n    /^[A-Za-z0-9+/_=-]+$/.test(decoded.replace(/\\s+/g, ''))"
)
source = source.replace(
    "const match = line.match(/^(vless|hysteria2|hy2|trojan|vmess|ss):\\/\\/(.+)$/i);",
    "const uriMatch = line.match(/(vless|hysteria2|hy2|trojan|vmess|ss):\\/\\/[^\\s]+/i);\n      const candidate = uriMatch?.[0] || line;\n      const match = candidate.match(/^(vless|hysteria2|hy2|trojan|vmess|ss):\\/\\/(.+)$/i);"
)
source = source.replace("JSON.parse(atob(match[2].split('#')[0].trim()))", "JSON.parse(decodeBase64Utf8(match[2].split('#')[0].trim()))")
source = source.replace("configText: line,", "configText: candidate,")
source = source.replace(
    "const text = await resp.text();\n          const parsed",
    "const text = await resp.text();\n          if (text.length > 5_000_000) throw new Error('Feed exceeds 5 MB limit');\n          const parsed"
)
source = source.replace(
    "const text = await directResp.text();\n    const parsed",
    "const text = await directResp.text();\n    if (text.length > 5_000_000) return { ok: false, error: 'Подписка превышает лимит 5 МБ.', configs: [] };\n    const parsed"
)
path.write_text(source, encoding="utf-8")

# Xray's share-link converter handles these four protocols. Keep Hysteria2/TUIC
# out of this path: they require sing-box or another native engine.
native = Path("android-native/src/main/java/com/violetvpn/android/VioletWireGuardService.kt")
kotlin = native.read_text(encoding="utf-8")
kotlin = kotlin.replace(
    'if (protocol.equals("vless", ignoreCase = true)) {\n            connectVlessWithXray(rawConfig)',
    'if (protocol.lowercase() in setOf("vless", "vmess", "trojan", "shadowsocks", "ss")) {\n            connectXrayShareLink(rawConfig)'
)
kotlin = kotlin.replace("private fun connectVlessWithXray(shareLink: String)", "private fun connectXrayShareLink(shareLink: String)")
kotlin = kotlin.replace('Не удалось разобрать VLESS-ссылку', 'Не удалось разобрать ссылку Xray')
kotlin = kotlin.replace('В VLESS-ссылке не найден outbound', 'В ссылке не найден outbound')
kotlin = kotlin.replace('VLESS-ссылка не содержит допустимый outbound', 'Ссылка не содержит допустимый outbound')
kotlin = kotlin.replace('VLESS подключён через Xray-core', 'Xray подключён через Xray-core')
kotlin = kotlin.replace('Не удалось запустить VLESS:', 'Не удалось запустить Xray:')
native.write_text(kotlin, encoding="utf-8")

print("Patched public feeds, Base64/URI parsing, response limits, and Xray share-link dispatch (VLESS/VMess/Trojan/SS).")


# The WebView must not display CONNECTED merely because the native process started.
# A request issued by the app process is routed by Android through the VPN's default
# route unless the VPN engine explicitly protects/excludes that socket.
bridge_path = Path("src/services/androidVpnBridge.ts")
bridge = bridge_path.read_text(encoding="utf-8")

connect_start = bridge.find("export function connectNativeAnyProtocol(")
connect_end = bridge.find("\nexport function connectNativeWireGuard", connect_start)
if connect_start < 0 or connect_end < 0:
    raise RuntimeError("Cannot safely patch androidVpnBridge.ts: connectNativeAnyProtocol markers changed")

connect_impl = """const CONNECTABLE_NATIVE_PROTOCOLS = new Set<ProfileProtocol>([
  'wireguard', 'vless', 'vmess', 'trojan', 'shadowsocks',
]);

export function connectNativeAnyProtocol(protocol: ProfileProtocol, configText: string, splitMode: SplitTunnelMode, packageNames: string[]) {
  const bridge = window.VioletAndroidBridge;
  if (!isNativeAndroidBridgeAvailable() || !bridge) return false;
  if (!CONNECTABLE_NATIVE_PROTOCOLS.has(protocol)) return false;
  if (typeof bridge.hasNativeCore === 'function' && !bridge.hasNativeCore(protocol)) return false;

  const packagesJson = JSON.stringify(packageNames);
  if (typeof bridge.connectAny === 'function') {
    bridge.connectAny(protocol, configText, splitMode, packagesJson);
    return true;
  }
  if (protocol === 'wireguard') {
    bridge.connect(configText, splitMode, packagesJson);
    return true;
  }
  return false;
}
"""
bridge = bridge[:connect_start] + connect_impl + bridge[connect_end:]

# Treat native "connected" as "core started"; promote it to the UI's CONNECTED
# only after an external HTTPS request succeeds through Android's VPN routing.
subscribe_start = bridge.find("export function subscribeNativeVpnEvents(")
if subscribe_start < 0:
    raise RuntimeError("Cannot safely patch androidVpnBridge.ts: subscribeNativeVpnEvents marker missing")

subscribe_impl = """async function verifyVpnDataPlane(): Promise<void> {
  const endpoints = [
    'https://api.ipify.org?format=json',
    'https://api64.ipify.org?format=json',
  ];
  let lastError = 'нет ответа от контрольного сервера';

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5500);
    try {
      const separator = endpoint.includes('?') ? '&' : '?';
      const response = await fetch(endpoint + separator + 'probe=' + Date.now(), {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = 'HTTP ' + response.status;
        continue;
      }
      const payload = await response.json() as { ip?: unknown };
      if (typeof payload.ip === 'string' && payload.ip.length >= 7) return;
      lastError = 'контрольный сервер вернул некорректный ответ';
    } catch (error) {
      lastError = error instanceof Error && error.name === 'AbortError'
        ? 'тайм-аут проверки трафика'
        : (error instanceof Error ? error.message : String(error));
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw new Error('Реальный трафик через VPN не подтверждён: ' + lastError);
}

let vpnProbeGeneration = 0;

export function subscribeNativeVpnEvents(onStateChange: (status: ConnectionStatus, error?: string) => void) {
  if (typeof window === 'undefined') return () => {};
  vpnProbeGeneration += 1;
  window.onVioletVpnState = (state, error) => {
    if (state === 'connected') {
      const generation = ++vpnProbeGeneration;
      onStateChange('connecting', 'Проверяем реальную передачу данных через VPN…');
      void verifyVpnDataPlane().then(() => {
        if (generation === vpnProbeGeneration) onStateChange('connected');
      }).catch((reason: unknown) => {
        if (generation !== vpnProbeGeneration) return;
        vpnProbeGeneration += 1;
        try {
          window.VioletAndroidBridge?.disconnect();
        } catch {
          // Preserve the original connectivity failure for the UI.
        }
        const message = reason instanceof Error ? reason.message : String(reason);
        onStateChange('disconnected', message);
      });
      return;
    }

    if (state === 'disconnected' || state === 'disconnecting') {
      vpnProbeGeneration += 1;
    }
    if (['connecting', 'disconnected', 'disconnecting'].includes(state)) {
      onStateChange(state as ConnectionStatus, error || undefined);
    }
  };
  return () => {
    vpnProbeGeneration += 1;
    delete window.onVioletVpnState;
  };
}
"""
bridge = bridge[:subscribe_start] + subscribe_impl
bridge_path.write_text(bridge, encoding="utf-8")

# Apply a consistent glass/ambient visual treatment to the real React screen
# after the original source archive has been extracted.
css_path = Path("src/index.css")
css = css_path.read_text(encoding="utf-8")
premium_marker = "/* Violet VPN premium interface */"
if premium_marker not in css:
    css += r"""

/* Violet VPN premium interface */
:root {
  color-scheme: dark;
  --violet-accent: #9b8cff;
  --violet-accent-strong: #7865ff;
  --violet-surface: rgba(24, 21, 39, .74);
  --violet-border: rgba(191, 177, 255, .16);
}
html, body, #root {
  min-height: 100%;
  background:
    radial-gradient(ellipse at 14% 8%, rgba(114, 75, 231, .19), transparent 34%),
    radial-gradient(ellipse at 88% 78%, rgba(35, 132, 184, .13), transparent 36%),
    #09080f;
}
body {
  position: relative;
  isolation: isolate;
  color: #f5f2ff;
  overflow-x: hidden;
}
body::before, body::after {
  content: "";
  position: fixed;
  z-index: -1;
  pointer-events: none;
  width: min(62vw, 660px);
  aspect-ratio: 1;
  border-radius: 50%;
  filter: blur(78px);
  opacity: .24;
  will-change: transform;
}
body::before {
  top: -22%;
  left: -18%;
  background: radial-gradient(circle, rgba(129, 94, 255, .66), transparent 68%);
  animation: violet-drift-a 22s ease-in-out infinite alternate;
}
body::after {
  right: -22%;
  bottom: -28%;
  background: radial-gradient(circle, rgba(42, 172, 194, .42), transparent 68%);
  animation: violet-drift-b 27s ease-in-out infinite alternate;
}
@keyframes violet-drift-a {
  from { transform: translate3d(0, 0, 0) scale(.92); }
  to { transform: translate3d(13vw, 12vh, 0) scale(1.12); }
}
@keyframes violet-drift-b {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to { transform: translate3d(-12vw, -10vh, 0) scale(1.14); }
}
#root [class*="rounded-2xl"],
#root [class*="rounded-3xl"] {
  border-color: var(--violet-border);
  box-shadow: 0 16px 46px rgba(0, 0, 0, .18), inset 0 1px 0 rgba(255,255,255,.035);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
#root button {
  transition: transform .18s ease, box-shadow .22s ease, border-color .22s ease, filter .22s ease;
  -webkit-tap-highlight-color: transparent;
}
#root button:active { transform: scale(.975); }
#root button:focus-visible, #root input:focus-visible, #root textarea:focus-visible {
  outline: 2px solid rgba(169, 151, 255, .9);
  outline-offset: 3px;
}
#root button[class*="bg-violet-"],
#root button[class*="bg-purple-"],
#root button[class*="from-violet-"],
#root button[class*="from-purple-"] {
  box-shadow: 0 10px 30px rgba(115, 86, 255, .25), inset 0 1px 0 rgba(255,255,255,.16);
}
#root button[class*="bg-violet-"]:hover,
#root button[class*="bg-purple-"]:hover,
#root button[class*="from-violet-"]:hover,
#root button[class*="from-purple-"]:hover {
  filter: brightness(1.09);
  box-shadow: 0 14px 38px rgba(115, 86, 255, .34), inset 0 1px 0 rgba(255,255,255,.2);
}
#root input, #root textarea, #root select {
  border-color: rgba(191, 177, 255, .17);
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: .01ms !important;
  }
}
"""
    css_path.write_text(css, encoding="utf-8")

print("Applied subscription-feed parsing, native-protocol allowlist, HTTPS data-plane confirmation, and Violet glass/ambient UI styling.")


# Keep the tunnel probe in a small pure module so CI can exercise success,
# fallback and failure paths independently of an Android device.
import json

probe_path = Path("src/services/vpnDataPlaneCheck.ts")
probe_path.write_text("""function isIpAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  if (/^(?:\\\\d{1,3}\\\\.){3}\\\\d{1,3}$/.test(value)) {
    return value.split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
  }
  return value.includes(':') && /^[0-9a-f:]+$/i.test(value);
}

export async function verifyVpnDataPlane(fetcher: typeof fetch = fetch): Promise<void> {
  const endpoints = [
    'https://api.ipify.org?format=json',
    'https://api64.ipify.org?format=json',
  ];
  let lastError = 'нет ответа от контрольного сервера';

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);
    try {
      const response = await fetcher(endpoint + '&probe=' + Date.now(), {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = 'HTTP ' + response.status;
        continue;
      }
      const payload = await response.json() as { ip?: unknown };
      if (isIpAddress(payload.ip)) return;
      lastError = 'контрольный сервер вернул некорректный IP';
    } catch (error) {
      lastError = error instanceof Error && error.name === 'AbortError'
        ? 'тайм-аут проверки трафика'
        : (error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Реальный трафик через VPN не подтверждён: ' + lastError);
}
""", encoding="utf-8")

import_marker = "import {ConnectionStatus, ProfileProtocol, SplitTunnelMode} from '../types/vpn';"
if import_marker not in bridge:
    raise RuntimeError("Cannot safely add data-plane helper import to androidVpnBridge.ts")
if "from './vpnDataPlaneCheck'" not in bridge:
    bridge = bridge.replace(import_marker, import_marker + "\nimport { verifyVpnDataPlane } from './vpnDataPlaneCheck';", 1)

bridge, removed_probe = re.subn(
    r"async function verifyVpnDataPlane\(\): Promise<void> \{[\\s\\S]*?\\n\}\n\n(?=let vpnProbeGeneration)",
    "",
    bridge,
    count=1,
)
if removed_probe != 1:
    raise RuntimeError("Could not extract inline VPN probe into the tested helper module")
bridge_path.write_text(bridge, encoding="utf-8")

tests_dir = Path("scripts/tests")
tests_dir.mkdir(parents=True, exist_ok=True)
tests_dir.joinpath("vpnDataPlaneCheck.test.mjs").write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyVpnDataPlane } from '../../src/services/vpnDataPlaneCheck.ts';

const ipResponse = (ip, status = 200) => new Response(
  JSON.stringify({ ip }),
  { status, headers: { 'content-type': 'application/json' } },
);

test('accepts a successful HTTPS probe with a valid IPv4 address', async () => {
  await assert.doesNotReject(() => verifyVpnDataPlane(async () => ipResponse('203.0.113.8')));
});

test('falls back to the second probe endpoint when the first fails', async () => {
  let requests = 0;
  await verifyVpnDataPlane(async () => {
    requests += 1;
    if (requests === 1) throw new Error('temporary endpoint failure');
    return ipResponse('2001:db8::8');
  });
  assert.equal(requests, 2);
});

test('rejects the connection when neither endpoint confirms data traffic', async () => {
  await assert.rejects(
    () => verifyVpnDataPlane(async () => ipResponse('', 503)),
    /Реальный трафик через VPN не подтверждён/,
  );
});

test('rejects malformed IP responses', async () => {
  await assert.rejects(
    () => verifyVpnDataPlane(async () => ipResponse('not-an-ip')),
    /некорректный IP/,
  );
});
""", encoding="utf-8")

package_path = Path("package.json")
package_data = json.loads(package_path.read_text(encoding="utf-8"))
package_data.setdefault("scripts", {})["test"] = "tsx --test scripts/tests/*.test.mjs"
package_path.write_text(json.dumps(package_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("Added an isolated tunnel data-plane probe module and four Node test cases.")
