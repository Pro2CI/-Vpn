import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  CheckCircle2,
  Copy,
  Globe,
  Info,
  Link2,
  Plus,
  Power,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  ActiveVpnSession,
  AutoDiscoveredVpnConfig,
  AutoSearchMode,
  AutoSearchResponse,
  ConnectionStatus,
  EndpointVerificationResult,
  SavedSubscriptionFeed,
  WireGuardProfile,
} from '../types/vpn';
import {
  getProfileProtocol,
  getProfileProtocolLabel,
  isProxyUriFamily,
  serializeWireGuardConfig,
} from '../data/vpnData';

interface AutoConnectTabProps {
  status: ConnectionStatus;
  handshakeStep: string;
  activeProfile: WireGuardProfile;
  activeSession: ActiveVpnSession | null;
  nativeBridgeAvailable: boolean;
  currentPublicIp: string | null;
  isCheckingIp: boolean;
  endpointCheck: EndpointVerificationResult | null;
  searchMode: AutoSearchMode;
  isSearching: boolean;
  searchResult: AutoSearchResponse | null;
  searchError: string | null;
  savedFeeds: SavedSubscriptionFeed[];
  isImportingFeed: boolean;
  feedNotice: string | null;
  onChangeSearchMode: (mode: AutoSearchMode) => void;
  onAddSubscriptionFeed: (url: string) => void;
  onToggleSubscriptionFeed: (id: string) => void;
  onDeleteSubscriptionFeed: (id: string) => void;
  onRunAutoConnect: (mode?: AutoSearchMode) => void;
  onSelectDiscoveredNode: (item: AutoDiscoveredVpnConfig) => void;
  onConnectActiveProfile: () => void;
  onDisconnect: () => void;
  onCheckActiveNode: () => void;
  onRefreshPublicIp: () => void;
  onOpenProfiles: () => void;
}

const MODE_TABS: { id: AutoSearchMode; label: string }[] = [
  { id: 'all', label: 'Все протоколы' },
  { id: 'vless', label: 'VLESS / Trojan / Hy2' },
  { id: 'wireguard', label: 'WireGuard / WARP' },
  { id: 'openvpn', label: 'OpenVPN' },
];

function formatDuration(secondsTotal: number): string {
  const s = Math.max(0, Math.floor(secondsTotal));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export const AutoConnectTab: React.FC<AutoConnectTabProps> = ({
  status,
  handshakeStep,
  activeProfile,
  activeSession,
  nativeBridgeAvailable,
  currentPublicIp,
  isCheckingIp,
  endpointCheck,
  searchMode,
  isSearching,
  searchResult,
  searchError,
  savedFeeds,
  isImportingFeed,
  feedNotice,
  onChangeSearchMode,
  onAddSubscriptionFeed,
  onToggleSubscriptionFeed,
  onDeleteSubscriptionFeed,
  onRunAutoConnect,
  onSelectDiscoveredNode,
  onConnectActiveProfile,
  onDisconnect,
  onCheckActiveNode,
  onRefreshPublicIp,
  onOpenProfiles,
}) => {
  const [filterText, setFilterText] = useState('');
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const activeProtocol = getProfileProtocol(activeProfile);
  const activeProtoLabel = getProfileProtocolLabel(activeProtocol);
  const activeRawText = useMemo(() => serializeWireGuardConfig(activeProfile), [activeProfile]);
  const isConnected = status === 'connected';
  const isBusy = status === 'connecting' || status === 'disconnecting' || isSearching;

  useEffect(() => {
    if (!isConnected || !activeSession) {
      setElapsedSec(0);
      return;
    }
    const tick = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - activeSession.connectedAtMs) / 1000)));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isConnected, activeSession]);

  const filteredConfigs = useMemo(() => {
    const list = searchResult?.configs || [];
    const q = filterText.trim().toLowerCase();
    return list.filter((item) => {
      if (searchMode === 'wireguard' && item.protocol !== 'wireguard' && item.protocol !== 'amneziawg') {
        return false;
      }
      if (searchMode === 'vless' && !isProxyUriFamily(item.protocol)) {
        return false;
      }
      if (searchMode === 'openvpn' && item.protocol !== 'openvpn') {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.endpoint.toLowerCase().includes(q) ||
        item.protocol.toLowerCase().includes(q) ||
        item.source.toLowerCase().includes(q)
      );
    });
  }, [searchResult, searchMode, filterText]);

  const handleCopyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleFeedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFeedUrl.trim();
    if (!trimmed) return;
    onAddSubscriptionFeed(trimmed);
    setNewFeedUrl('');
  };

  const displayLatency =
    (isConnected && activeSession?.latencyMs !== undefined && activeSession.latencyMs !== null
      ? activeSession.latencyMs
      : endpointCheck?.latencyMs ?? activeProfile.latencyMs) ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* Primary Self-Contained Auto-Connect & Active Tunnel Workspace */}
      <section className="rounded-3xl border border-[#E6E2F3] dark:border-[#231F38] bg-white dark:bg-[#11101C] p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left: Primary Goal & Single Dominant CTA */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              {isConnected ? (
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
              )}
              <span>
                {isConnected
                  ? nativeBridgeAvailable
                    ? 'Системный Android VpnService активен (ключик в шторке)'
                    : `Активен узел ${activeSession?.endpoint || activeProfile.peerConfig.endpoint}`
                  : nativeBridgeAvailable
                    ? 'Android VpnService готов к подключению в один клик'
                    : 'Прямое подключение к открытым серверам и подпискам'}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight [text-wrap:balance]">
              Автоматическое подключение к бесплатному VPN
            </h1>

            <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
              Violet VPN сам находит живые серверы VLESS, Trojan, Hysteria2, VMess, Shadowsocks, OpenVPN и WARP из открытых подписок, проверяет отклик и подключает рабочий узел прямо здесь в один клик.
            </p>

            {/* Segmented Protocol Selector */}
            <div
              className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#F2EFF9] dark:bg-[#0C0B15] border border-[#E6E2F3] dark:border-[#231F38] self-start"
              role="tablist"
              aria-label="Фильтр протокола для автопоиска"
            >
              {MODE_TABS.map((tab) => {
                const active = searchMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onChangeSearchMode(tab.id)}
                    className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-white dark:bg-violet-600/25 text-violet-700 dark:text-violet-200 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Primary CTA Row */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {isConnected ? (
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="min-h-[48px] px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold inline-flex items-center gap-2.5 shadow-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Power className="w-4 h-4" />
                  <span>Отключить VPN</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onRunAutoConnect(searchMode)}
                  disabled={isBusy}
                  className="min-h-[48px] px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold inline-flex items-center gap-2.5 shadow-sm shadow-violet-600/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  <Zap className={`w-4 h-4 ${isSearching ? 'animate-pulse' : ''}`} />
                  <span>{isSearching ? 'Поиск и подключение...' : 'Найти и подключить лучший'}</span>
                </button>
              )}

              {isConnected && (
                <button
                  type="button"
                  onClick={() => onRunAutoConnect(searchMode)}
                  disabled={isBusy}
                  className="min-h-[48px] px-4 py-3 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  <Zap className="w-4 h-4 text-violet-500" />
                  <span>Переключить на более быстрый</span>
                </button>
              )}

              <button
                type="button"
                onClick={onOpenProfiles}
                className="min-h-[48px] px-4 py-3 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Свой .ovpn / vless:// / .conf
              </button>
            </div>
          </div>

          {/* Right: Active Selected Node & Direct Connect Toggle */}
          <div className="lg:col-span-5 border-t lg:border-t-0 lg:border-l border-[#ECE8F6] dark:border-[#211D35] pt-5 lg:pt-0 lg:pl-6 flex flex-col gap-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {isConnected ? 'Активное подключение' : 'Выбранный сервер'}
              </div>
              <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                <Globe className="w-3.5 h-3.5 text-violet-500" />
                <span>IP: {currentPublicIp || '—'}</span>
                <button
                  type="button"
                  onClick={onRefreshPublicIp}
                  disabled={isCheckingIp}
                  aria-label="Обновить внешний IP"
                  className="p-1 text-violet-600 dark:text-violet-400 hover:opacity-75 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCheckingIp ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                {activeProfile.name}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span>{activeProtoLabel}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[220px]">{activeProfile.peerConfig.endpoint}</span>
                {displayLatency !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      {displayLatency} мс
                    </span>
                  </>
                )}
                {isConnected && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">
                      {formatDuration(elapsedSec)}
                    </span>
                  </>
                )}
              </div>
            </div>

            {handshakeStep ? (
              <p
                className={`text-xs leading-relaxed ${
                  isConnected
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {handshakeStep}
              </p>
            ) : endpointCheck ? (
              <p
                className={`text-xs leading-relaxed ${
                  endpointCheck.reachable
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {endpointCheck.note}
              </p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Нажмите «Подключить узел» для прямого запуска выбранного сервера в Violet VPN.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={isConnected ? onDisconnect : onConnectActiveProfile}
                disabled={status === 'connecting' || status === 'disconnecting'}
                className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60 ${
                  isConnected
                    ? 'bg-emerald-600/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-violet-600 hover:bg-violet-500 text-white'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                <span>
                  {status === 'connecting'
                    ? 'Подключение...'
                    : isConnected
                      ? 'Отключить узел'
                      : 'Подключить узел'}
                </span>
              </button>

              <button
                type="button"
                onClick={onCheckActiveNode}
                disabled={status === 'connecting'}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-violet-500" />
                <span>Проверить пинг</span>
              </button>

              <button
                type="button"
                onClick={() => void handleCopyText(activeRawText, 'active-node')}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                {copiedId === 'active-node' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedId === 'active-node' ? 'Скопировано' : 'Конфиг'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Honest Android Status Bar Key ("ключик") Runtime Explanation */}
        {!nativeBridgeAvailable && (
          <div className="mt-5 pt-4 border-t border-[#ECE8F6] dark:border-[#1E1A2E] flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            <Info className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
            <p>
              <strong className="text-slate-800 dark:text-slate-100">Почему в шторке телефона нет значка ключика:</strong>{' '}
              сейчас Violet VPN открыт в веб-браузере, а Android разрешает включать системный <code className="font-mono text-[11px]">VpnService</code> (и показывать значок ключа в статус-баре) только установленному Android-приложению из папки <code className="font-mono text-[11px]">android-native/</code>. В браузере работают автопоиск серверов, загрузка подписок и проверка узлов; для системного ключа установите собранный APK с исправленным <code className="font-mono text-[11px]">VioletWireGuardService</code>.
            </p>
          </div>
        )}
      </section>

      {/* In-App Open Subscriptions Manager (No External Apps) */}
      <section className="rounded-2xl border border-[#E6E2F3] dark:border-[#231F38] bg-white dark:bg-[#11101C] p-5 flex flex-col gap-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Открытые подписки внутри Violet VPN
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Добавьте любую публичную HTTPS-подписку или ссылку на конфиг — приложение само загрузит узлы и подключится в один клик.
            </p>
          </div>

          <form onSubmit={handleFeedSubmit} className="flex items-center gap-2 w-full lg:w-auto">
            <div className="relative flex-1 lg:w-80">
              <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="url"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                placeholder="https://... ссылка на открытую подписку"
                aria-label="HTTPS-ссылка на открытую подписку"
                className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-xl border border-[#E6E2F3] dark:border-[#231F38] bg-[#F7F6FB] dark:bg-[#0C0B15] text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <button
              type="submit"
              disabled={isImportingFeed || !newFeedUrl.trim()}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isImportingFeed ? 'Загрузка...' : 'Добавить и загрузить'}</span>
            </button>
          </form>
        </div>

        {feedNotice && (
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-3.5 py-2 text-xs text-violet-800 dark:text-violet-200">
            {feedNotice}
          </div>
        )}

        {savedFeeds.length > 0 && (
          <div className="divide-y divide-[#ECE8F6] dark:divide-[#1E1A2E] border border-[#E6E2F3] dark:border-[#231F38] rounded-xl overflow-hidden">
            {savedFeeds.map((feed) => (
              <div
                key={feed.id}
                className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs bg-[#FAF9FD] dark:bg-[#0D0B16]"
              >
                <label className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={feed.enabled}
                    onChange={() => onToggleSubscriptionFeed(feed.id)}
                    className="h-4 w-4 rounded accent-violet-600 cursor-pointer"
                  />
                  <span className="font-semibold text-slate-800 dark:text-slate-200 shrink-0">
                    {feed.name}
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400 truncate">
                    {feed.url}
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => onDeleteSubscriptionFeed(feed.id)}
                  aria-label={`Удалить подписку ${feed.name}`}
                  className="p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Live Discovered Servers Pool */}
      <section className="rounded-2xl border border-[#E6E2F3] dark:border-[#231F38] bg-white dark:bg-[#11101C] overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[#ECE8F6] dark:border-[#1E1A2E] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Рабочие серверы из открытых источников
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              {searchResult
                ? `Проверено кандидатов: ${searchResult.scannedCandidates} · Онлайн: ${searchResult.workingCount} · Показано: ${filteredConfigs.length}`
                : 'Нажмите «Найти и подключить лучший», чтобы просканировать открытые сети.'}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="relative flex-1 sm:flex-initial">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Фильтр по протоколу или IP..."
                aria-label="Фильтр найденных серверов"
                className="w-full sm:w-56 min-h-[40px] pl-9 pr-3 py-1.5 rounded-xl border border-[#E6E2F3] dark:border-[#231F38] bg-[#F7F6FB] dark:bg-[#0C0B15] text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            <button
              type="button"
              onClick={() => onRunAutoConnect(searchMode)}
              disabled={isSearching}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <Radar className={`w-3.5 h-3.5 text-violet-500 ${isSearching ? 'animate-spin' : ''}`} />
              <span>Обновить список</span>
            </button>
          </div>
        </div>

        {searchResult && searchResult.sourcesChecked.length > 0 && (
          <div className="px-5 py-2.5 bg-[#FAF9FD] dark:bg-[#0D0B16] border-b border-[#ECE8F6] dark:border-[#1E1A2E] flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            {searchResult.sourcesChecked.map((src) => (
              <span key={src.name} className="inline-flex items-center gap-1.5">
                <span
                  className={
                    src.status === 'ok'
                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                      : src.status === 'partial'
                        ? 'text-amber-600 dark:text-amber-400 font-semibold'
                        : 'text-slate-400'
                  }
                >
                  {src.name}:
                </span>
                <span className="font-mono tabular-nums">{src.found}</span>
              </span>
            ))}
          </div>
        )}

        {searchError && (
          <div className="m-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
            {searchError}
          </div>
        )}

        {isSearching && !searchResult ? (
          <div className="divide-y divide-[#ECE8F6] dark:divide-[#1E1A2E]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center justify-between gap-4 animate-pulse">
                <div className="flex flex-col gap-2 w-2/3">
                  <div className="h-4 w-48 rounded bg-slate-200 dark:bg-[#1E1A2E]" />
                  <div className="h-3 w-72 rounded bg-slate-100 dark:bg-[#171426]" />
                </div>
                <div className="h-9 w-28 rounded-xl bg-slate-200 dark:bg-[#1E1A2E]" />
              </div>
            ))}
          </div>
        ) : filteredConfigs.length === 0 ? (
          <div className="py-12 px-5 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {searchResult
                ? 'По выбранному фильтру серверов не найдено'
                : 'Список ещё не загружен'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Переключите вкладку на «Все протоколы» или нажмите «Найти и подключить лучший».
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#ECE8F6] dark:divide-[#1E1A2E]">
            {filteredConfigs.map((item) => {
              const isSelectedNode = activeProfile.peerConfig.endpoint === item.endpoint;
              const isNodeConnected = isConnected && isSelectedNode;
              const latencyTone =
                item.latencyMs !== null && item.latencyMs <= 60
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : item.latencyMs !== null && item.latencyMs <= 140
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-500 dark:text-slate-400';

              return (
                <div
                  key={item.id}
                  className={`px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                    isNodeConnected
                      ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                      : isSelectedNode
                        ? 'bg-violet-50/70 dark:bg-violet-950/25'
                        : 'hover:bg-[#FAF9FD] dark:hover:bg-[#151323]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <CheckCircle2
                        className={`w-4 h-4 shrink-0 ${
                          isNodeConnected ? 'text-emerald-500' : 'text-violet-500'
                        }`}
                      />
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {item.name}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono uppercase text-slate-700 dark:text-slate-300">
                        {getProfileProtocolLabel(item.protocol)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{item.endpoint}</span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-mono font-semibold tabular-nums ${latencyTone}`}>
                        {item.latencyMs === null ? 'Не проверен' : `${item.latencyMs} мс`}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{item.source}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => (isNodeConnected ? onDisconnect() : onSelectDiscoveredNode(item))}
                      className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        isNodeConnected
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : 'bg-violet-600 hover:bg-violet-500 text-white'
                      }`}
                    >
                      {isNodeConnected ? 'Отключить' : 'Подключить'}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleCopyText(item.configText, item.id)}
                      aria-label={`Скопировать конфиг ${item.name}`}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedId === item.id ? 'Скопировано' : 'Копировать'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
