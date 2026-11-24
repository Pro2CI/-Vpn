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
  const octets = value.split('.');
  if (octets.length === 4 && octets.every(part => {
    if (part.length < 1 || part.length > 3) return false;
    const number = Number(part);
    return Number.isInteger(number) && number >= 0 && number <= 255 && String(number) === part;
  })) return true;
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

if "from './vpnDataPlaneCheck'" not in bridge:
    bridge = "import { verifyVpnDataPlane } from './vpnDataPlaneCheck';\n" + bridge

bridge, removed_probe = re.subn(
    r"async function verifyVpnDataPlane\(\): Promise<void> \{[\s\S]*?\n\}\n\n(?=let vpnProbeGeneration)",
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


# Do not import Hysteria2 share links into this Xray-only path. Hysteria2/TUIC
# remain unavailable until a sing-box engine is added to the Android package.
auto_search_path = Path("src/services/autoSearchClient.ts")
auto_search_source = auto_search_path.read_text(encoding="utf-8")
auto_search_source = auto_search_source.replace("hysteria2|hy2|", "")
auto_search_path.write_text(auto_search_source, encoding="utf-8")

# Resolve nullable latency values at JSX boundaries; child props are optional
# numbers rather than explicit nullable numbers.
app_path = Path("src/App.tsx")
app_source = app_path.read_text(encoding="utf-8")
app_source = app_source.replace("latencyMs: item.latencyMs,", "latencyMs: item.latencyMs ?? undefined,")

def normalize_latency_prop(match):
    expression = match.group(2).rstrip()
    if "??" not in expression:
        expression += " ?? undefined"
    return match.group(1) + expression + match.group(3)

app_source, latency_props_patched = re.subn(
    r"(\w+\s*=\s*\{)([^{}\n]*\blatencyMs\b[^{}\n]*)(\})",
    normalize_latency_prop,
    app_source,
)
app_path.write_text(app_source, encoding="utf-8")



# Keep a soft animated halo on primary violet actions; the reduced-motion rule
# already installed above disables it for users who request less motion.
css_path = Path("src/index.css")
css = css_path.read_text(encoding="utf-8")
if "violet-button-breathe" not in css:
    css += r"""
#root button[class*="bg-violet-"]:not(:disabled),
#root button[class*="bg-purple-"]:not(:disabled),
#root button[class*="from-violet-"]:not(:disabled),
#root button[class*="from-purple-"]:not(:disabled) {
  animation: violet-button-breathe 3s ease-in-out infinite;
}
@keyframes violet-button-breathe {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.08); }
}
"""
    css_path.write_text(css, encoding="utf-8")

native_check = native.read_text(encoding="utf-8")
if 'protocol.lowercase() in setOf("vless", "vmess", "trojan", "shadowsocks", "ss")' not in native_check:
    raise RuntimeError("Native Xray protocol dispatch patch did not apply")
if "connectXrayShareLink" not in native_check:
    raise RuntimeError("Xray share-link converter rename did not apply")

print("Filtered unsupported Hysteria2 links, normalized nullable latency props, and verified native Xray dispatch.")


# Dynamic Android version: every CI build must upgrade over an older installation.
gradle_path = Path("android-native/build.gradle.kts")
gradle_text = gradle_path.read_text(encoding="utf-8")
if "val violetBuildNumber" not in gradle_text:
    gradle_text = gradle_text.replace(
        "}\n\nandroid {",
        '}\n\nval violetBuildNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 3\n\nandroid {',
        1,
    )
gradle_text = re.sub(r"versionCode\s*=\s*\d+", "versionCode = 10000 + violetBuildNumber", gradle_text, count=1)
gradle_text = re.sub(r'versionName\s*=\s*"[^"]+"', 'versionName = "2.1.$violetBuildNumber"', gradle_text, count=1)
if "versionCode = 10000 + violetBuildNumber" not in gradle_text or 'versionName = "2.1.$violetBuildNumber"' not in gradle_text:
    raise RuntimeError("Could not set a unique Android versionCode/versionName")
gradle_path.write_text(gradle_text, encoding="utf-8")
print(f"Android package version set to 2.1.{__import__('os').environ.get('GITHUB_RUN_NUMBER', '3')} (versionCode 10000 + workflow run number).")

# Temporary source inspection: print the real WebView bridge so the updater can
# be attached to the existing activity without guessing its structure.
for candidate in sorted(Path("android-native/src/main").rglob("*.kt")):
    candidate_text = candidate.read_text(encoding="utf-8", errors="replace")
    if "VioletAndroidBridge" in candidate_text or "addJavascriptInterface" in candidate_text:
        print(f"=== ANDROID BRIDGE CANDIDATE: {candidate} ===")
        lines = candidate_text.splitlines()
        for line_number, line in enumerate(lines, start=1):
            if "VioletAndroidBridge" in line or "addJavascriptInterface" in line:
                low = max(1, line_number - 12)
                high = min(len(lines), line_number + 38)
                print(f"--- lines {low}-{high} ---")
                for idx in range(low, high + 1):
                    print(f"{idx}: {lines[idx - 1]}")


# Violet VPN in-app updater: query latest GitHub Release and hand APK to Android Package Installer.
from textwrap import dedent

android_root = Path("android-native/src/main")
package_dir = android_root / "java/com/violetvpn/android"
package_dir.mkdir(parents=True, exist_ok=True)

updater_source = r'''package com.violetvpn.android

import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.widget.Toast

/**
 * Small bridge used only for checking the installed version and handing an APK
 * downloaded from the official Violet VPN GitHub Release to Android's installer.
 */
class VioletAppUpdater(private val activity: Activity) {
    @Volatile private var activeDownloadId: Long? = null
    @Volatile private var downloadReceiver: BroadcastReceiver? = null

    @JavascriptInterface
    fun getInstalledVersionCode(): Int {
        val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else info.versionCode
    }

    @JavascriptInterface
    fun getInstalledVersionName(): String {
        return activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "unknown"
    }

    @JavascriptInterface
    fun installUpdate(downloadUrl: String, targetVersionCode: Int) {
        activity.runOnUiThread {
            try {
                val installed = getInstalledVersionCode()
                if (targetVersionCode <= installed) {
                    toast("Установлена актуальная версия")
                    return@runOnUiThread
                }

                val uri = Uri.parse(downloadUrl)
                val validUrl = uri.scheme == "https" &&
                    uri.host == "github.com" &&
                    uri.path.orEmpty().startsWith("/Pro2CI/-Vpn/releases/download/") &&
                    uri.path.orEmpty().endsWith(".apk")
                if (!validUrl) {
                    toast("Отклонена неизвестная ссылка обновления")
                    return@runOnUiThread
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                    !activity.packageManager.canRequestPackageInstalls()
                ) {
                    toast("Разрешите установку приложений из Violet VPN, затем нажмите «Обновить» ещё раз")
                    val settingsIntent = Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:${activity.packageName}")
                    )
                    activity.startActivity(settingsIntent)
                    return@runOnUiThread
                }

                startApkDownload(downloadUrl)
            } catch (error: Exception) {
                toast("Не удалось начать обновление: ${error.message ?: "ошибка"}")
            }
        }
    }

    private fun startApkDownload(downloadUrl: String) {
        val context = activity.applicationContext
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

        downloadReceiver?.let {
            try { context.unregisterReceiver(it) } catch (_: Exception) { }
        }
        activeDownloadId = null

        val request = DownloadManager.Request(Uri.parse(downloadUrl))
            .setTitle("Violet VPN — обновление")
            .setDescription("Загрузка новой версии приложения")
            .setMimeType(APK_MIME)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(
                context,
                Environment.DIRECTORY_DOWNLOADS,
                "Violet-VPN-update.apk"
            )

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context?, intent: Intent?) {
                if (intent?.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
                val completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
                val expectedId = activeDownloadId ?: return
                if (completedId != expectedId) return

                activeDownloadId = null
                downloadReceiver = null
                try { context.unregisterReceiver(this) } catch (_: Exception) { }

                val query = DownloadManager.Query().setFilterById(completedId)
                manager.query(query)?.use { cursor ->
                    if (!cursor.moveToFirst()) {
                        toast("Не удалось проверить загруженный APK")
                        return
                    }
                    val statusColumn = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                    val status = if (statusColumn >= 0) cursor.getInt(statusColumn) else -1
                    if (status != DownloadManager.STATUS_SUCCESSFUL) {
                        val reasonColumn = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
                        val reason = if (reasonColumn >= 0) cursor.getInt(reasonColumn) else status
                        toast("Загрузка обновления не завершилась (код $reason)")
                        return
                    }
                }

                val apkUri = manager.getUriForDownloadedFile(completedId)
                if (apkUri == null) {
                    toast("APK загружен, но Android не вернул ссылку на файл")
                    return
                }
                val installIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(apkUri, APK_MIME)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                try {
                    context.startActivity(installIntent)
                } catch (_: Exception) {
                    toast("Не удалось открыть системный установщик Android")
                }
            }
        }

        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            context.registerReceiver(receiver, filter)
        }
        downloadReceiver = receiver
        activeDownloadId = manager.enqueue(request)
        toast("Обновление загружается. Уведомление покажет завершение загрузки.")
    }

    private fun toast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_LONG).show()
        }
    }

    companion object {
        private const val APK_MIME = "application/vnd.android.package-archive"

        /**
         * Small, self-contained version notice. It is injected after the local
         * WebView page loads, so it is independent of the React render tree.
         */
        const val UPDATE_SCRIPT = """
            (function () {
              if (window.__violetUpdaterInstalled) return;
              window.__violetUpdaterInstalled = true;

              var css = document.createElement('style');
              css.textContent = ''
                + '#violet-app-update{position:fixed;z-index:2147483000;left:14px;right:14px;bottom:14px;'
                + 'padding:13px 14px;border:1px solid rgba(178,155,255,.34);border-radius:18px;'
                + 'background:rgba(20,17,34,.96);color:#f6f1ff;box-shadow:0 12px 36px rgba(0,0,0,.42);'
                + 'font:14px system-ui,-apple-system,sans-serif;display:flex;align-items:center;gap:12px;'
                + 'backdrop-filter:blur(18px);}'
                + '#violet-app-update .vau-copy{flex:1;min-width:0;}'
                + '#violet-app-update .vau-title{font-weight:700;font-size:14px;}'
                + '#violet-app-update .vau-sub{opacity:.74;font-size:12px;margin-top:3px;}'
                + '#violet-app-update button{border:0;border-radius:12px;padding:10px 13px;'
                + 'background:#8b70ff;color:white;font-weight:700;font-size:13px;}'
                + '#violet-app-update button:disabled{opacity:.6;}'
                + '#violet-app-update .vau-close{background:transparent;padding:5px 7px;color:#c7bddf;}'
                + '@media(prefers-reduced-motion:no-preference){#violet-app-update{animation:vau-in .25s ease-out}}'
                + '@keyframes vau-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}';
              document.head.appendChild(css);

              function show(title, subtitle, actionLabel, action, dismissible) {
                var old = document.getElementById('violet-app-update');
                if (old) old.remove();
                var box = document.createElement('div');
                box.id = 'violet-app-update';
                var copy = document.createElement('div');
                copy.className = 'vau-copy';
                var heading = document.createElement('div');
                heading.className = 'vau-title';
                heading.textContent = title;
                var detail = document.createElement('div');
                detail.className = 'vau-sub';
                detail.textContent = subtitle;
                copy.appendChild(heading);
                copy.appendChild(detail);
                box.appendChild(copy);
                var button = document.createElement('button');
                button.textContent = actionLabel;
                button.addEventListener('click', action);
                box.appendChild(button);
                if (dismissible) {
                  var close = document.createElement('button');
                  close.className = 'vau-close';
                  close.textContent = '×';
                  close.setAttribute('aria-label', 'Скрыть сообщение об обновлении');
                  close.addEventListener('click', function () { box.remove(); });
                  box.appendChild(close);
                }
                document.body.appendChild(box);
              }

              async function checkUpdates(manual) {
                try {
                  if (!window.VioletAppUpdater) throw new Error('Native updater is unavailable');
                  var installedCode = Number(window.VioletAppUpdater.getInstalledVersionCode());
                  var installedName = String(window.VioletAppUpdater.getInstalledVersionName());
                  var response = await fetch(
                    'https://api.github.com/repos/Pro2CI/-Vpn/releases/latest',
                    { headers: { 'Accept': 'application/vnd.github+json' }, cache: 'no-store' }
                  );
                  if (!response.ok) throw new Error('GitHub API HTTP ' + response.status);
                  var release = await response.json();
                  var tag = String(release.tag_name || '');
                  var match = tag.match(/^violet-build-(\d+)$/);
                  if (!match) throw new Error('В релизе не найден номер сборки');
                  var buildNumber = Number(match[1]);
                  var targetCode = 10000 + buildNumber;
                  var versionName = '2.1.' + buildNumber;
                  var apk = (release.assets || []).find(function (asset) {
                    return asset.name === 'Violet-VPN-latest.apk';
                  });
                  if (!apk || !apk.browser_download_url) throw new Error('В релизе нет APK');

                  if (targetCode > installedCode) {
                    show(
                      'Доступно обновление Violet VPN',
                      'Установлена ' + installedName + ' · новая версия ' + versionName,
                      'Обновить',
                      function () {
                        var button = document.querySelector('#violet-app-update button');
                        if (button) { button.disabled = true; button.textContent = 'Загрузка…'; }
                        window.VioletAppUpdater.installUpdate(apk.browser_download_url, targetCode);
                      },
                      true
                    );
                  } else if (manual) {
                    show('Обновления не найдены', 'Установлена последняя версия ' + installedName, 'Понятно', function () {
                      var box = document.getElementById('violet-app-update');
                      if (box) box.remove();
                    }, true);
                  }
                } catch (error) {
                  if (manual) {
                    show('Не удалось проверить обновления', String(error && error.message || error), 'Повторить', function () {
                      checkUpdates(true);
                    }, true);
                  }
                }
              }

              setTimeout(function () { checkUpdates(false); }, 1200);
            })();
        """
    }
}
'''
(package_dir / "VioletAppUpdater.kt").write_text(updater_source, encoding="utf-8")

activity_path = package_dir / "MainActivity.kt"
activity = activity_path.read_text(encoding="utf-8")

bridge_marker = '            addJavascriptInterface(VioletJsBridge(), "VioletAndroidBridge")'
bridge_addition = '            addJavascriptInterface(VioletAppUpdater(this@MainActivity), "VioletAppUpdater")\n' + bridge_marker
if 'addJavascriptInterface(VioletAppUpdater(this@MainActivity), "VioletAppUpdater")' not in activity:
    if bridge_marker not in activity:
        raise RuntimeError("Updater: cannot find VioletAndroidBridge registration in MainActivity.kt")
    activity = activity.replace(bridge_marker, bridge_addition, 1)

intercept_marker = """                    return assetLoader.shouldInterceptRequest(request.url)
                }
            }"""
intercept_replacement = """                    return assetLoader.shouldInterceptRequest(request.url)
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    view?.evaluateJavascript(VioletAppUpdater.UPDATE_SCRIPT, null)
                }
            }"""
if "VioletAppUpdater.UPDATE_SCRIPT" not in activity:
    if intercept_marker not in activity:
        raise RuntimeError("Updater: cannot find WebViewClient request interception block in MainActivity.kt")
    activity = activity.replace(intercept_marker, intercept_replacement, 1)
activity_path.write_text(activity, encoding="utf-8")

manifest_path = android_root / "AndroidManifest.xml"
manifest = manifest_path.read_text(encoding="utf-8")
if "android.permission.REQUEST_INSTALL_PACKAGES" not in manifest:
    match = re.search(r"<manifest\b[^>]*>", manifest)
    if not match:
        raise RuntimeError("Updater: cannot locate manifest root element")
    manifest = manifest[:match.end()] + '\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />' + manifest[match.end():]
manifest_path.write_text(manifest, encoding="utf-8")

print("Installed VioletAppUpdater bridge, checked latest public GitHub Release, and added the Android APK installer flow.")


# Stable release signing: Android only upgrades an installed app when the signer matches.
gradle_text = gradle_path.read_text(encoding="utf-8")
if "violetSigningAvailable" not in gradle_text:
    gradle_text = gradle_text.replace(
        'val violetBuildNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 3',
        'val violetBuildNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 3\nval violetSigningAvailable = !System.getenv("VIOLET_KEYSTORE_PATH").isNullOrBlank()',
        1,
    )
    gradle_text = gradle_text.replace(
        '    compileSdk = 35\n',
        '''    compileSdk = 35
    signingConfigs {
        if (violetSigningAvailable) {
            create("violetRelease") {
                storeFile = file(System.getenv("VIOLET_KEYSTORE_PATH")!!)
                storePassword = System.getenv("VIOLET_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("VIOLET_KEY_ALIAS")
                keyPassword = System.getenv("VIOLET_KEY_PASSWORD")
                storeType = "PKCS12"
            }
        }
    }
    buildTypes {
        getByName("debug") {
            if (violetSigningAvailable) {
                signingConfig = signingConfigs.getByName("violetRelease")
            }
        }
    }
''',
        1,
    )
    gradle_path.write_text(gradle_text, encoding="utf-8")
print("Configured stable Violet VPN signing when VIOLET_SIGNING_BUNDLE is supplied.")
