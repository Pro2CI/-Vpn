from pathlib import Path

data_path = Path("src/data/vpnData.ts")
data = data_path.read_text(encoding="utf-8")
marker = "export function parseAnyVpnConfigs(\n"
if "function parseXrayJsonConfig(" not in data:
    helper = r'''function parseXrayJsonConfig(raw: string, customName?: string): { profile?: WireGuardProfile; error?: string } {
  if (raw.length > 1_000_000) return { error: 'Xray JSON превышает лимит 1 МБ.' };
  try {
    const config = JSON.parse(raw) as { outbounds?: Array<Record<string, any>> };
    if (!config || !Array.isArray(config.outbounds)) return { error: 'Это не Xray JSON: отсутствует массив outbounds.' };
    const supported = new Set(['vless', 'vmess', 'trojan', 'shadowsocks']);
    const outbound = config.outbounds.find((item) => item && supported.has(String(item.protocol || '').toLowerCase()));
    if (!outbound) return { error: 'В Xray JSON нет поддерживаемого outbound (VLESS, VMess, Trojan или Shadowsocks).' };
    const protocol = String(outbound.protocol).toLowerCase() as ProfileProtocol;
    const settings = (outbound.settings && typeof outbound.settings === 'object' ? outbound.settings : {}) as Record<string, any>;
    const vnext = Array.isArray(settings.vnext) ? settings.vnext[0] : undefined;
    const server = Array.isArray(settings.servers) ? settings.servers[0] : undefined;
    const host = String(vnext?.address || server?.address || '').trim().replace(/^\[|\]$/g, '');
    const port = Number(vnext?.port || server?.port || 0);
    const user = Array.isArray(vnext?.users) ? vnext.users[0] : undefined;
    const credential = String(user?.id || user?.password || server?.password || '').trim();
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return { error: 'В Xray JSON не найден корректный адрес и порт сервера.' };
    if (!credential) return { error: 'В Xray JSON не найден UUID или пароль outbound.' };
    const stream = (outbound.streamSettings && typeof outbound.streamSettings === 'object' ? outbound.streamSettings : {}) as Record<string, any>;
    const security = String(stream.security || 'none').toLowerCase();
    const network = String(stream.network || 'tcp').toLowerCase();
    const tls = stream.tlsSettings || {};
    const reality = stream.realitySettings || {};
    const sni = String(reality.serverName || tls.serverName || '').trim() || undefined;
    const pbk = String(reality.publicKey || '').trim() || undefined;
    const tag = String(outbound.tag || '').trim();
    return {
      profile: {
        id: 'xray-json-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        name: customName?.trim() || tag || protocol.toUpperCase() + ' ' + host,
        protocol,
        isCustom: true,
        createdAt: new Date().toISOString().slice(0, 10),
        rawOriginalConfig: raw,
        vlessConfig: {
          uuid: credential, host, port, security, sni, pbk,
          flow: String(user?.flow || '').trim() || undefined,
          network, uri: raw,
        },
        interfaceConfig: {
          privateKey: '',
          address: protocol.toUpperCase() + ' · ' + security.toUpperCase() + ' · ' + network.toUpperCase(),
          dns: '1.1.1.1',
          mtu: 1500,
        },
        peerConfig: {
          publicKey: pbk || credential,
          endpoint: host + ':' + port,
          allowedIPs: '0.0.0.0/0, ::/0',
          persistentKeepalive: 0,
        },
      },
    };
  } catch {
    return { error: 'Не удалось разобрать Xray JSON. Проверьте синтаксис файла.' };
  }
}

'''
    if marker not in data: raise RuntimeError("parseAnyVpnConfigs marker not found")
    data = data.replace(marker, helper + marker, 1)

if "content.startsWith('{')" not in data:
    marker = "  if (\n    !content.includes('://') &&\n    !content.includes('[Interface]') &&"
    replacement = """  if (content.startsWith('{')) {
    const jsonResult = parseXrayJsonConfig(content, customName);
    return jsonResult.profile ? { profiles: [jsonResult.profile] } : { error: jsonResult.error };
  }

""" + marker
    if marker not in data: raise RuntimeError("Base64 parser marker not found")
    data = data.replace(marker, replacement, 1)

if "Xray JSON (VLESS" not in data:
    marker = "  if (!trimmed) return null;\n"
    replacement = marker + "  if (trimmed.startsWith('{') && /\\\"outbounds\\\"\\s*:/.test(trimmed)) return 'Xray JSON (VLESS / REALITY / TLS / XHTTP / TCP)';\n"
    if marker not in data: raise RuntimeError("detectVpnConfigFormat marker not found")
    data = data.replace(marker, replacement, 1)
data_path.write_text(data, encoding="utf-8")

ui_path = Path("src/components/ProfilesTab.tsx")
ui = ui_path.read_text(encoding="utf-8")
ui = ui.replace("file.name.replace(/\\.(conf|ovpn|txt|uri)$/i, '')", "file.name.replace(/\\.(conf|ovpn|txt|uri|json)$/i, '')")
ui = ui.replace('accept=".conf,.ovpn,.txt,.uri"', 'accept=".conf,.ovpn,.txt,.uri,.json"')
ui = ui.replace("Импортируйте .ovpn (OpenVPN)", "Импортируйте Xray JSON, .ovpn (OpenVPN)")
ui = ui.replace("Импорт OpenVPN, VLESS или WireGuard", "Импорт Xray JSON, OpenVPN, VLESS или WireGuard")
ui = ui.replace("Текст .ovpn, .conf, ссылка vless:// или Base64-подписка", "Xray JSON, текст .ovpn/.conf, ссылка vless:// или Base64-подписка")
ui_path.write_text(ui, encoding="utf-8")

service_path = Path("android-native/src/main/java/com/violetvpn/android/VioletWireGuardService.kt")
service = service_path.read_text(encoding="utf-8")
old = '''            val conversion = invokeMethod.invoke(
                null,
                JSONObject()
                    .put("apiVersion", 3)
                    .put("method", "convertShareLinksToXrayJson")
                    .put("payload", JSONObject().put("text", shareLink))
                    .toString()
            ) as? String ?: throw IllegalStateException("libXray не вернул результат разбора VLESS")
            val converted = JSONObject(conversion)
            if (!converted.optBoolean("success")) {
                throw IllegalArgumentException(converted.optString("error", "Не удалось разобрать ссылку Xray"))
            }
            val parsedData = converted.optJSONObject("data")
                ?: throw IllegalArgumentException("Xray не вернул outbound для этой ссылки")
'''
new = '''            val parsedData = if (shareLink.trimStart().startsWith("{")) {
                JSONObject(shareLink).also { json ->
                    if (json.optJSONArray("outbounds") == null) {
                        throw IllegalArgumentException("В Xray JSON отсутствует массив outbounds")
                    }
                }
            } else {
                val conversion = invokeMethod.invoke(
                    null,
                    JSONObject()
                        .put("apiVersion", 3)
                        .put("method", "convertShareLinksToXrayJson")
                        .put("payload", JSONObject().put("text", shareLink))
                        .toString()
                ) as? String ?: throw IllegalStateException("libXray не вернул результат разбора ссылки Xray")
                val converted = JSONObject(conversion)
                if (!converted.optBoolean("success")) {
                    throw IllegalArgumentException(converted.optString("error", "Не удалось разобрать ссылку Xray"))
                }
                converted.optJSONObject("data")
                    ?: throw IllegalArgumentException("Xray не вернул outbound для этой ссылки")
            }
'''
if old in service:
    service = service.replace(old, new, 1)
elif 'JSONObject(shareLink).also' not in service:
    raise RuntimeError("Xray conversion block not found")

old = '''            val outbounds = JSONArray()
            var proxyTag = parsedOutbounds.optJSONObject(0)?.optString("tag") ?: ""
            for (i in 0 until parsedOutbounds.length()) outbounds.put(parsedOutbounds.getJSONObject(i))
            if (proxyTag.isBlank()) {
                proxyTag = "proxy"
                parsedOutbounds.optJSONObject(0)?.put("tag", proxyTag)
            }
            outbounds.put(JSONObject().put("tag", "direct").put("protocol", "freedom").put("settings", JSONObject()))
            outbounds.put(JSONObject().put("tag", "block").put("protocol", "blackhole").put("settings", JSONObject()))
'''
new = '''            val outbounds = JSONArray()
            var proxyTag = ""
            for (i in 0 until parsedOutbounds.length()) {
                val outbound = parsedOutbounds.getJSONObject(i)
                val protocol = outbound.optString("protocol").lowercase()
                if (proxyTag.isBlank() && protocol in setOf("vless", "vmess", "trojan", "shadowsocks")) {
                    proxyTag = outbound.optString("tag").ifBlank { "violet-proxy" }
                    outbound.put("tag", proxyTag)
                }
                outbounds.put(outbound)
            }
            if (proxyTag.isBlank()) throw IllegalArgumentException("В Xray JSON нет поддерживаемого proxy outbound")
            if ((0 until outbounds.length()).none { outbounds.getJSONObject(it).optString("tag") == "direct" }) {
                outbounds.put(JSONObject().put("tag", "direct").put("protocol", "freedom").put("settings", JSONObject()))
            }
            if ((0 until outbounds.length()).none { outbounds.getJSONObject(it).optString("tag") == "block" }) {
                outbounds.put(JSONObject().put("tag", "block").put("protocol", "blackhole").put("settings", JSONObject()))
            }
'''
if old in service:
    service = service.replace(old, new, 1)
elif 'violet-proxy' not in service:
    raise RuntimeError("Xray outbound selection block not found")
service_path.write_text(service, encoding="utf-8")

assert "function parseXrayJsonConfig(" in data_path.read_text(encoding="utf-8")
assert 'accept=".conf,.ovpn,.txt,.uri,.json"' in ui_path.read_text(encoding="utf-8")
assert "JSONObject(shareLink).also" in service_path.read_text(encoding="utf-8")
assert "violet-proxy" in service_path.read_text(encoding="utf-8")
print("Xray JSON import and native execution patch applied.")
