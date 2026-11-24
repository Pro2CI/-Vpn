import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  CloudLightning,
  Copy,
  FileText,
  Power,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { EndpointVerificationResult, WireGuardProfile } from '../types/vpn';
import {
  detectVpnConfigFormat,
  getProfileProtocol,
  getProfileProtocolLabel,
  isWireGuardFamily,
  parseAnyVpnConfigs,
  serializeWireGuardConfig,
} from '../data/vpnData';
import { verifyEndpointReachability } from '../services/autoSearchClient';

interface ProfilesTabProps {
  profiles: WireGuardProfile[];
  activeProfileId: string;
  isConnected: boolean;
  onSelectProfile: (profileId: string) => void;
  onActivateProfile: (profileId: string) => void;
  onDisconnect: () => void;
  onAddProfiles: (profiles: WireGuardProfile[]) => void;
  onDeleteProfile: (profileId: string) => void;
  onRegisterWarp: () => void;
  isRegisteringWarp: boolean;
}

export const ProfilesTab: React.FC<ProfilesTabProps> = ({
  profiles,
  activeProfileId,
  isConnected,
  onSelectProfile,
  onActivateProfile,
  onDisconnect,
  onAddProfiles,
  onDeleteProfile,
  onRegisterWarp,
  isRegisteringWarp,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<EndpointVerificationResult | null>(null);

  const currentProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) || profiles[0],
    [profiles, activeProfileId]
  );

  const currentProtocol = getProfileProtocol(currentProfile);
  const currentProtoLabel = getProfileProtocolLabel(currentProtocol);
  const rawText = useMemo(
    () => (currentProfile ? serializeWireGuardConfig(currentProfile) : ''),
    [currentProfile]
  );
  const detectedPasteFormat = useMemo(() => detectVpnConfigFormat(pasteText), [pasteText]);
  const isCurrentConnected = isConnected && currentProfile?.id === activeProfileId;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      const baseName = file.name.replace(/\.(conf|ovpn|txt|uri)$/i, '');
      const res = parseAnyVpnConfigs(content, baseName);
      if (res.error || !res.profiles?.length) {
        setImportError(res.error || 'Не удалось распознать файл.');
        setImportSuccess(null);
      } else {
        onAddProfiles(res.profiles);
        setImportError(null);
        setCheckResult(null);
        setImportSuccess(`Загружено профилей в Violet VPN: ${res.profiles.length}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handlePasteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = parseAnyVpnConfigs(pasteText, pasteName);
    if (res.error || !res.profiles?.length) {
      setImportError(res.error || 'Не удалось распознать конфигурацию.');
      setImportSuccess(null);
      return;
    }
    onAddProfiles(res.profiles);
    setImportError(null);
    setCheckResult(null);
    setImportSuccess(`Загружено профилей в Violet VPN: ${res.profiles.length}`);
    setPasteName('');
    setPasteText('');
    setPasteOpen(false);
  };

  const handleCheckServer = async () => {
    if (!currentProfile) return;
    setIsChecking(true);
    try {
      const result = await verifyEndpointReachability(
        currentProfile.peerConfig.endpoint,
        currentProtocol
      );
      setCheckResult(result);
    } finally {
      setIsChecking(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header & In-App Import Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Профили и загрузка конфигов
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Импортируйте .ovpn (OpenVPN), .conf (WireGuard / AmneziaWG) или ссылки vless:// / trojan:// / hy2:// / vmess:// / ss:// для подключения внутри Violet VPN
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".conf,.ovpn,.txt,.uri"
            onChange={handleFileUpload}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Загрузить файл</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setImportError(null);
              setPasteOpen(true);
            }}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] bg-white dark:bg-[#11101C] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>Вставить текст / URI</span>
          </button>

          <button
            type="button"
            onClick={onRegisterWarp}
            disabled={isRegisteringWarp}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] bg-white dark:bg-[#11101C] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            <CloudLightning className="w-4 h-4 text-violet-500" />
            <span>{isRegisteringWarp ? 'Генерация WARP...' : 'Новый профиль WARP'}</span>
          </button>
        </div>
      </div>

      {importError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError(null)} aria-label="Закрыть ошибку" className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {importSuccess && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-3">
          <span>{importSuccess}</span>
          <button type="button" onClick={() => setImportSuccess(null)} aria-label="Закрыть уведомление" className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Saved Profiles List */}
        <aside className="lg:col-span-4 rounded-2xl border border-[#E6E2F3] dark:border-[#231F38] bg-white dark:bg-[#11101C] divide-y divide-[#ECE8F6] dark:divide-[#1E1A2E] overflow-hidden">
          <div className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Сохранённые профили ({profiles.length})
          </div>
          {profiles.map((p) => {
            const selected = currentProfile?.id === p.id;
            const proto = getProfileProtocol(p);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setCheckResult(null);
                  onSelectProfile(p.id);
                }}
                className={`w-full px-4 py-3.5 text-left flex items-start justify-between gap-3 transition-colors cursor-pointer ${
                  selected
                    ? 'bg-violet-50/80 dark:bg-violet-950/35'
                    : 'hover:bg-[#F8F6FC] dark:hover:bg-[#161425]'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {p.name}
                  </div>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
                    {getProfileProtocolLabel(proto)} · {p.peerConfig.endpoint}
                  </div>
                </div>
                {selected && <Check className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />}
              </button>
            );
          })}
        </aside>

        {/* Profile Inspector & Direct Connect */}
        {currentProfile && (
          <section className="lg:col-span-8 rounded-2xl border border-[#E6E2F3] dark:border-[#231F38] bg-white dark:bg-[#11101C] p-5 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#ECE8F6] dark:border-[#1E1A2E]">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {currentProfile.name}
                </h3>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                  {currentProtoLabel} · {currentProfile.peerConfig.endpoint}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  isCurrentConnected ? onDisconnect() : onActivateProfile(currentProfile.id)
                }
                className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap self-start cursor-pointer ${
                  isCurrentConnected
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-violet-600 hover:bg-violet-500 text-white'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                <span>{isCurrentConnected ? 'Отключить' : 'Подключить'}</span>
              </button>
            </div>

            {checkResult && (
              <div
                className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                  checkResult.reachable
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                    : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                }`}
              >
                {checkResult.note}
              </div>
            )}

            {/* Key Protocol Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl border border-[#E6E2F3] dark:border-[#231F38] bg-[#F7F6FB] dark:bg-[#0C0B15]">
                <div className="text-slate-500 dark:text-slate-400 mb-1">Адрес сервера</div>
                <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {currentProfile.peerConfig.endpoint}
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-[#E6E2F3] dark:border-[#231F38] bg-[#F7F6FB] dark:bg-[#0C0B15]">
                <div className="text-slate-500 dark:text-slate-400 mb-1">Транспорт / Параметры</div>
                <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {currentProfile.openvpnConfig
                    ? `${currentProfile.openvpnConfig.proto.toUpperCase()} · ${currentProfile.openvpnConfig.cipher || 'AES'}`
                    : currentProfile.vlessConfig
                      ? `${currentProfile.vlessConfig.security.toUpperCase()} · ${currentProfile.vlessConfig.network.toUpperCase()}`
                      : isWireGuardFamily(currentProtocol)
                        ? `${currentProtoLabel} · MTU ${currentProfile.interfaceConfig.mtu}`
                        : currentProtoLabel}
                </div>
              </div>
            </div>

            <pre className="w-full max-h-[260px] overflow-auto rounded-xl border border-[#E6E2F3] dark:border-[#231F38] bg-[#F7F6FB] dark:bg-[#0C0B15] p-4 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-all">
              {rawText}
            </pre>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#ECE8F6] dark:border-[#1E1A2E]">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCheckServer()}
                  disabled={isChecking}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Activity className={`w-4 h-4 text-violet-500 ${isChecking ? 'animate-spin' : ''}`} />
                  <span>{isChecking ? 'Проверка...' : 'Проверить сервер'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Скопировано' : 'Копировать конфиг'}</span>
                </button>
              </div>

              {profiles.length > 1 && (
                <button
                  type="button"
                  onClick={() => onDeleteProfile(currentProfile.id)}
                  className="min-h-[40px] px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900/50 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold text-rose-600 dark:text-rose-400 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Удалить</span>
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Paste Config Modal */}
      {pasteOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Импорт конфигурации"
        >
          <form
            onSubmit={handlePasteSubmit}
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#11101C] border border-[#E6E2F3] dark:border-[#231F38] p-6 flex flex-col gap-4"
          >
            <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto sm:hidden" />
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Импорт OpenVPN, VLESS или WireGuard
              </h3>
              <button
                type="button"
                onClick={() => setPasteOpen(false)}
                aria-label="Закрыть"
                className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-[#F2EFFA] dark:hover:bg-[#1B182C] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {importError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
                {importError}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Название профиля (необязательно)
              </label>
              <input
                type="text"
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
                placeholder="Например: Мой сервер OpenVPN или VLESS"
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#E6E2F3] dark:border-[#231F38] bg-[#F7F6FB] dark:bg-[#0C0B15] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Текст .ovpn, .conf, ссылка vless:// или Base64-подписка
                </label>
                {detectedPasteFormat && (
                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    {detectedPasteFormat}
                  </span>
                )}
              </div>
              <textarea
                rows={7}
                required
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={`OpenVPN: client / dev tun / remote host 1194 ...\nVLESS: vless://uuid@host:443?security=reality...\nWireGuard: [Interface] ... [Peer] ...`}
                className="w-full p-3 rounded-xl border border-[#E6E2F3] dark:border-[#231F38] bg-[#F7F6FB] dark:bg-[#0C0B15] font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setPasteOpen(false)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                className="min-h-[42px] px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
              >
                Загрузить в приложение
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
