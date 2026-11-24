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
print("Patched public feed catalog, Base64 decoder, URI extraction, and response size limits.")
