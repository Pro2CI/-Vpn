import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Radar, SlidersHorizontal, Zap } from 'lucide-react';
import {
  ActiveVpnSession,
  AndroidAppEntry,
  AutoDiscoveredVpnConfig,
  AutoSearchMode,
  AutoSearchResponse,
  ConnectionStatus,
  EndpointVerificationResult,
  SavedSubscriptionFeed,
  TabId,
  VpnSettings,
  WireGuardProfile,
} from './types/vpn';
import {
  DEFAULT_SETTINGS,
  DNS_PRESETS,
  INITIAL_ANDROID_APPS,
  INITIAL_PROFILES,
  createWarpDefaultProfile,
  getProfileProtocol,
  parseAnyVpnConfigs,
  serializeWireGuardConfig,
} from './data/vpnData';
import { AutoConnectTab } from './components/AutoConnectTab';
import { ProfilesTab } from './components/ProfilesTab';
import { SettingsTab } from './components/SettingsTab';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallControl';
import {
  connectNativeAnyProtocol,
  disconnectNativeWireGuard,
  isNativeAndroidBridgeAvailable,
  subscribeNativeVpnEvents,
} from './services/androidVpnBridge';
import {
  connectInAppSession,
  disconnectInAppSession,
  fetchCurrentPublicIp,
  importSubscriptionFeed,
  performAutoSearch,
  pollInAppSessionHeartbeat,
  registerWarpProfileOnServer,
  verifyEndpointReachability,
} from './services/autoSearchClient';

const STORAGE_KEYS = {
  settings: 'violet_vpn_settings_v2',
  profiles: 'violet_vpn_profiles_v2',
  apps: 'violet_vpn_apps_v1',
  activeProfile: 'violet_vpn_active_profile_v2',
  feeds: 'violet_vpn_feeds_v1',
};

const NAV_ITEMS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'auto', label: 'Автоподбор', icon: Radar },
  { id: 'profiles', label: 'Профили', icon: KeyRound },
  { id: 'settings', label: 'Настройки', icon: SlidersHorizontal },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('auto');
  const nativeBridgeAvailable = isNativeAndroidBridgeAvailable();

  const [settings, setSettings] = useState<VpnSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.settings);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [profiles, setProfiles] = useState<WireGuardProfile[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.profiles);
      const parsed = saved ? (JSON.parse(saved) as WireGuardProfile[]) : null;
      if (Array.isArray(parsed)) {
        const realOnly = parsed.filter((p) => !p.peerConfig?.endpoint?.includes('violetvpn.net'));
        if (realOnly.length > 0) return realOnly;
      }
      return INITIAL_PROFILES;
    } catch {
      return INITIAL_PROFILES;
    }
  });

  const [activeProfileId, setActiveProfileId] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.activeProfile) || INITIAL_PROFILES[0].id;
  });

  const [apps, setApps] = useState<AndroidAppEntry[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.apps);
      return saved ? JSON.parse(saved) : INITIAL_ANDROID_APPS;
    } catch {
      return INITIAL_ANDROID_APPS;
    }
  });

  const [savedFeeds, setSavedFeeds] = useState<SavedSubscriptionFeed[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.feeds);
      return saved ? (JSON.parse(saved) as SavedSubscriptionFeed[]) : [];
    } catch {
      return [];
    }
  });

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [handshakeStep, setHandshakeStep] = useState('');
  const [activeSession, setActiveSession] = useState<ActiveVpnSession | null>(null);
  const [currentPublicIp, setCurrentPublicIp] = useState<string | null>(null);
  const [isCheckingIp, setIsCheckingIp] = useState(false);
  const [endpointCheck, setEndpointCheck] = useState<EndpointVerificationResult | null>(null);

  const [searchMode, setSearchMode] = useState<AutoSearchMode>('all');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<AutoSearchResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isRegisteringWarp, setIsRegisteringWarp] = useState(false);
  const [isImportingFeed, setIsImportingFeed] = useState(false);
  const [feedNotice, setFeedNotice] = useState<string | null>(null);

  const initialAutoScanStartedRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    try {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
    } catch {
      // Ignore storage error
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(profiles));
      localStorage.setItem(STORAGE_KEYS.apps, JSON.stringify(apps));
      localStorage.setItem(STORAGE_KEYS.activeProfile, activeProfileId);
      localStorage.setItem(STORAGE_KEYS.feeds, JSON.stringify(savedFeeds));
    } catch {
      // Ignore storage error
    }
  }, [profiles, apps, activeProfileId, savedFeeds]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) || profiles[0],
    [profiles, activeProfileId]
  );

  const handleRefreshPublicIp = useCallback(async () => {
    setIsCheckingIp(true);
    try {
      const ip = await fetchCurrentPublicIp();
      if (ip) setCurrentPublicIp(ip);
    } finally {
      setIsCheckingIp(false);
    }
  }, []);

  useEffect(() => {
    void handleRefreshPublicIp();
  }, [handleRefreshPublicIp]);

  useEffect(() => {
    return subscribeNativeVpnEvents((nextState, errMsg) => {
      setStatus(nextState);
      setHandshakeStep(errMsg || '');
      if (nextState === 'connected' && activeProfile) {
        setActiveSession((prev) =>
          prev || {
            sessionId: `android-${Date.now()}`,
            name: activeProfile.name,
            protocol: getProfileProtocol(activeProfile),
            endpoint: activeProfile.peerConfig.endpoint,
            connectedAtMs: Date.now(),
            latencyMs: activeProfile.latencyMs ?? null,
            checksCount: 1,
            mode: 'native-android',
            detail: errMsg || 'Системный Android VpnService активен',
          }
        );
      } else if (nextState === 'disconnected') {
        setActiveSession(null);
      }
    });
  }, [activeProfile]);

  // Live heartbeat monitor for in-app sessions (Web/Desktop/PWA)
  useEffect(() => {
    if (status !== 'connected' || nativeBridgeAvailable || !activeSession) {
      return;
    }
    const timer = window.setInterval(() => {
      void pollInAppSessionHeartbeat().then((res) => {
        if (res && res.connected) {
          setActiveSession((prev) =>
            prev
              ? {
                  ...prev,
                  latencyMs: res.latencyMs ?? prev.latencyMs,
                  checksCount: res.checksCount ?? prev.checksCount + 1,
                }
              : prev
          );
        }
      });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [status, nativeBridgeAvailable, activeSession]);

  const connectProfileDirect = useCallback(
    async (profile: WireGuardProfile): Promise<boolean> => {
      setActiveProfileId(profile.id);
      const protocol = getProfileProtocol(profile);
      const rawConfig = serializeWireGuardConfig(profile);

      if (isNativeAndroidBridgeAvailable()) {
        const bypassPackages = apps.filter((a) => a.bypassVpn).map((a) => a.packageName);
        setStatus('connecting');
        setHandshakeStep(`Запуск Android VpnService для ${profile.peerConfig.endpoint}...`);
        const launched = connectNativeAnyProtocol(
          protocol,
          rawConfig,
          settings.splitTunnelMode,
          bypassPackages
        );
        if (launched) {
          return true;
        }
      }

      setStatus('connecting');
      setHandshakeStep(`Подключение к ${profile.peerConfig.endpoint} (${protocol.toUpperCase()})...`);
      const result = await connectInAppSession({
        endpoint: profile.peerConfig.endpoint,
        protocol,
        name: profile.name,
      });

      const ip = await fetchCurrentPublicIp();
      if (ip) setCurrentPublicIp(ip);

      if (result.connected) {
        setStatus('connected');
        setHandshakeStep(result.detail);
        setEndpointCheck({
          reachable: true,
          latencyMs: result.latencyMs ?? null,
          host: profile.peerConfig.endpoint.split(':')[0] || '',
          port: Number(profile.peerConfig.endpoint.split(':')[1] || 443),
          protocol,
          checkedAt: new Date().toISOString(),
          note: result.detail,
        });
        setActiveSession({
          sessionId: result.sessionId || `sess-${Date.now()}`,
          name: profile.name,
          protocol,
          endpoint: profile.peerConfig.endpoint,
          resolvedIp: result.resolvedIp,
          connectedAtMs: result.connectedAtMs || Date.now(),
          latencyMs: result.latencyMs ?? null,
          checksCount: result.checksCount || 1,
          mode: 'app-relay',
          detail: result.detail,
        });
        return true;
      }

      setStatus('disconnected');
      setActiveSession(null);
      setHandshakeStep(result.detail);
      setEndpointCheck({
        reachable: false,
        latencyMs: null,
        host: profile.peerConfig.endpoint.split(':')[0] || '',
        port: Number(profile.peerConfig.endpoint.split(':')[1] || 443),
        protocol,
        checkedAt: new Date().toISOString(),
        note: result.detail,
      });
      return false;
    },
    [apps, settings.splitTunnelMode]
  );

  const handleDisconnect = useCallback(() => {
    setStatus('disconnecting');
    setHandshakeStep('Отключение туннеля...');
    if (isNativeAndroidBridgeAvailable()) {
      disconnectNativeWireGuard();
    }
    void disconnectInAppSession().finally(() => {
      setStatus('disconnected');
      setActiveSession(null);
      setHandshakeStep('');
    });
  }, []);

  const handleCheckActiveNode = useCallback(async () => {
    if (!activeProfile) return;
    const protocol = getProfileProtocol(activeProfile);
    setHandshakeStep(`Проверка отклика ${activeProfile.peerConfig.endpoint}...`);
    const [check, ip] = await Promise.all([
      verifyEndpointReachability(activeProfile.peerConfig.endpoint, protocol),
      fetchCurrentPublicIp(),
    ]);
    if (ip) setCurrentPublicIp(ip);
    setEndpointCheck(check);
    setHandshakeStep('');
  }, [activeProfile]);

  const convertDiscoveredToProfile = useCallback(
    (item: AutoDiscoveredVpnConfig): WireGuardProfile => {
      if (item.wireguardProfile) {
        return {
          ...item.wireguardProfile,
          id: `auto-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          source: item.source,
          latencyMs: item.latencyMs,
          backupEndpoints: item.backupEndpoints,
        };
      }
      const parsed = parseAnyVpnConfigs(item.configText, item.name);
      if (parsed.profiles && parsed.profiles.length > 0) {
        return {
          ...parsed.profiles[0],
          source: item.source,
          latencyMs: item.latencyMs,
        };
      }
      return createWarpDefaultProfile(settings.preferredWarpPort);
    },
    [settings.preferredWarpPort]
  );

  const handleSelectDiscoveredNode = useCallback(
    (item: AutoDiscoveredVpnConfig) => {
      const profile = convertDiscoveredToProfile(item);
      setProfiles((prev) => {
        const deduped = prev.filter((p) => p.peerConfig.endpoint !== profile.peerConfig.endpoint);
        return [profile, ...deduped].slice(0, 30);
      });
      void connectProfileDirect(profile);
    },
    [convertDiscoveredToProfile, connectProfileDirect]
  );

  const handleRunAutoConnect = useCallback(
    async (overrideMode?: AutoSearchMode, autoConnectFastest = true) => {
      const modeToRun = overrideMode || searchMode;
      setActiveTab('auto');
      setIsSearching(true);
      setSearchError(null);
      try {
        const enabledFeedUrls = savedFeeds.filter((f) => f.enabled).map((f) => f.url);
        const result = await performAutoSearch({
          mode: modeToRun,
          portPreference: settings.preferredWarpPort,
          customFeedUrls: enabledFeedUrls,
        });
        setSearchResult(result);

        if (autoConnectFastest && result.configs.length > 0) {
          const matching = result.configs.filter((c) => {
            if (modeToRun === 'wireguard') return c.protocol === 'wireguard' || c.protocol === 'amneziawg';
            if (modeToRun === 'openvpn') return c.protocol === 'openvpn';
            if (modeToRun === 'vless') {
              return (
                c.protocol === 'vless' ||
                c.protocol === 'hysteria2' ||
                c.protocol === 'trojan' ||
                c.protocol === 'vmess' ||
                c.protocol === 'shadowsocks'
              );
            }
            return true;
          });

          const pool = matching.length > 0 ? matching : result.configs;
          // Auto-failover through top 3 candidates until one connects cleanly
          for (const candidate of pool.slice(0, 3)) {
            const prof = convertDiscoveredToProfile(candidate);
            setProfiles((prev) => {
              const deduped = prev.filter((p) => p.peerConfig.endpoint !== prof.peerConfig.endpoint);
              return [prof, ...deduped].slice(0, 30);
            });
            const ok = await connectProfileDirect(prof);
            if (ok) break;
          }
        }
      } catch {
        setSearchError('Не удалось выполнить поиск серверов. Проверьте подключение к интернету.');
      } finally {
        setIsSearching(false);
      }
    },
    [
      searchMode,
      savedFeeds,
      settings.preferredWarpPort,
      convertDiscoveredToProfile,
      connectProfileDirect,
    ]
  );

  useEffect(() => {
    if (initialAutoScanStartedRef.current) return;
    initialAutoScanStartedRef.current = true;
    void handleRunAutoConnect('all', false);
  }, [handleRunAutoConnect]);

  const handleAddSubscriptionFeed = useCallback(
    async (rawUrl: string) => {
      const cleanUrl = rawUrl.trim();
      if (!cleanUrl) return;
      setIsImportingFeed(true);
      setFeedNotice(null);

      try {
        const res = await importSubscriptionFeed(cleanUrl);
        if (!res.ok) {
          setFeedNotice(res.error || 'Не удалось загрузить подписку.');
          return;
        }

        let feedName = 'Открытая подписка';
        try {
          feedName = new URL(cleanUrl).hostname;
        } catch {
          // Keep default name
        }

        setSavedFeeds((prev) => {
          if (prev.some((f) => f.url === cleanUrl)) return prev;
          return [{ id: `feed-${Date.now()}`, name: feedName, url: cleanUrl, enabled: true }, ...prev];
        });

        setSearchResult((prev) => {
          const existing = prev?.configs || [];
          const seenEp = new Set(res.configs.map((c) => c.endpoint));
          const merged = [...res.configs, ...existing.filter((c) => !seenEp.has(c.endpoint))];
          return {
            searchedAt: new Date().toISOString(),
            scannedCandidates: (prev?.scannedCandidates || 0) + res.configs.length,
            workingCount: merged.length,
            sourcesChecked: prev?.sourcesChecked || [],
            configs: merged,
          };
        });

        setFeedNotice(`Загружено узлов из подписки ${feedName}: ${res.configs.length}`);
        if (res.configs.length > 0 && status === 'disconnected') {
          handleSelectDiscoveredNode(res.configs[0]);
        }
      } finally {
        setIsImportingFeed(false);
      }
    },
    [status, handleSelectDiscoveredNode]
  );

  const handleToggleSubscriptionFeed = useCallback((id: string) => {
    setSavedFeeds((prev) => prev.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)));
  }, []);

  const handleDeleteSubscriptionFeed = useCallback((id: string) => {
    setSavedFeeds((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleRegisterWarp = useCallback(async () => {
    setIsRegisteringWarp(true);
    try {
      const dnsPreset = DNS_PRESETS.find((d) => d.id === settings.dnsPresetId);
      const serverProfile = await registerWarpProfileOnServer(settings.preferredWarpPort);
      const profile =
        serverProfile ||
        createWarpDefaultProfile(
          settings.preferredWarpPort,
          dnsPreset?.address || '1.1.1.1, 1.0.0.1',
          settings.mtu
        );
      setProfiles((prev) => [profile, ...prev].slice(0, 30));
      setActiveProfileId(profile.id);
    } finally {
      setIsRegisteringWarp(false);
    }
  }, [settings.dnsPresetId, settings.mtu, settings.preferredWarpPort]);

  const handleUpdateSetting = useCallback(
    <K extends keyof VpnSettings>(key: K, value: VpnSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleToggleAppBypass = useCallback((appId: string) => {
    setApps((prev) =>
      prev.map((app) => (app.id === appId ? { ...app, bypassVpn: !app.bypassVpn } : app))
    );
  }, []);

  const handleResetDefaults = useCallback(() => {
    const freshWarp = createWarpDefaultProfile(DEFAULT_SETTINGS.preferredWarpPort);
    setSettings(DEFAULT_SETTINGS);
    setApps(INITIAL_ANDROID_APPS);
    setProfiles([freshWarp]);
    setActiveProfileId(freshWarp.id);
    setSavedFeeds([]);
  }, []);

  const handleAddProfiles = useCallback((added: WireGuardProfile[]) => {
    if (added.length === 0) return;
    setProfiles((prev) => [...added, ...prev].slice(0, 30));
    setActiveProfileId(added[0].id);
  }, []);

  const handleDeleteProfile = useCallback(
    (profileId: string) => {
      setProfiles((prev) => {
        const next = prev.filter((p) => p.id !== profileId);
        if (activeProfileId === profileId && next.length > 0) {
          setActiveProfileId(next[0].id);
        }
        return next;
      });
    },
    [activeProfileId]
  );

  const handleActivateProfile = useCallback(
    (profileId: string) => {
      const target = profiles.find((p) => p.id === profileId);
      if (!target) return;
      setActiveTab('auto');
      void connectProfileDirect(target);
    },
    [profiles, connectProfileDirect]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F6FB] dark:bg-[#09080F] text-slate-900 dark:text-slate-100 transition-colors duration-200">
      {/* Three-Zone Top Bar */}
      <header className="lg:sticky lg:top-0 z-30 border-b border-[#E6E2F3] dark:border-[#211D35] bg-white/90 dark:bg-[#0D0B16]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#auto"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('auto');
            }}
            className="inline-flex items-center gap-2.5 font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="shrink-0">
              <rect width="32" height="32" rx="9" className="fill-violet-600 dark:fill-violet-500/20" />
              <path
                d="M16 5.5 L24.5 9 V16 C24.5 21.4 20.8 25.6 16 27 C11.2 25.6 7.5 21.4 7.5 16 V9 L16 5.5 Z"
                className="stroke-white dark:stroke-violet-400"
                strokeWidth="1.9"
                strokeLinejoin="round"
              />
              <path
                d="M12.2 13.4 L16 20.2 L19.8 13.4"
                className="stroke-white dark:stroke-slate-100"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Violet VPN</span>
          </a>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav className="hidden lg:flex items-center gap-6" aria-label="Основная навигация">
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-violet-600 dark:border-violet-400 text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() =>
                status === 'connected'
                  ? handleDisconnect()
                  : void handleRunAutoConnect(searchMode, true)
              }
              disabled={isSearching || status === 'connecting' || status === 'disconnecting'}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 ${
                status === 'connected'
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-violet-600 hover:bg-violet-500'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>
                {isSearching
                  ? 'Поиск...'
                  : status === 'connected'
                    ? 'Отключить'
                    : 'Подключить'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-24 lg:pb-12">
        <div className="mb-4 flex items-center justify-end empty:hidden">
          <PWAInstallButton />
        </div>

        {activeTab === 'auto' && (
          <AutoConnectTab
            status={status}
            handshakeStep={handshakeStep}
            activeProfile={activeProfile}
            activeSession={activeSession}
            nativeBridgeAvailable={nativeBridgeAvailable}
            currentPublicIp={currentPublicIp}
            isCheckingIp={isCheckingIp}
            endpointCheck={endpointCheck}
            searchMode={searchMode}
            isSearching={isSearching}
            searchResult={searchResult}
            searchError={searchError}
            savedFeeds={savedFeeds}
            isImportingFeed={isImportingFeed}
            feedNotice={feedNotice}
            onChangeSearchMode={setSearchMode}
            onAddSubscriptionFeed={(url) => void handleAddSubscriptionFeed(url)}
            onToggleSubscriptionFeed={handleToggleSubscriptionFeed}
            onDeleteSubscriptionFeed={handleDeleteSubscriptionFeed}
            onRunAutoConnect={(mode) => void handleRunAutoConnect(mode, true)}
            onSelectDiscoveredNode={handleSelectDiscoveredNode}
            onConnectActiveProfile={() => void connectProfileDirect(activeProfile)}
            onDisconnect={handleDisconnect}
            onCheckActiveNode={() => void handleCheckActiveNode()}
            onRefreshPublicIp={() => void handleRefreshPublicIp()}
            onOpenProfiles={() => setActiveTab('profiles')}
          />
        )}

        {activeTab === 'profiles' && (
          <ProfilesTab
            profiles={profiles}
            activeProfileId={activeProfile.id}
            isConnected={status === 'connected'}
            onSelectProfile={(id) => {
              setEndpointCheck(null);
              setActiveProfileId(id);
            }}
            onActivateProfile={handleActivateProfile}
            onDisconnect={handleDisconnect}
            onAddProfiles={handleAddProfiles}
            onDeleteProfile={handleDeleteProfile}
            onRegisterWarp={() => void handleRegisterWarp()}
            isRegisteringWarp={isRegisteringWarp}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            settings={settings}
            apps={apps}
            nativeBridgeAvailable={nativeBridgeAvailable}
            onUpdateSetting={handleUpdateSetting}
            onToggleAppBypass={handleToggleAppBypass}
            onResetDefaults={handleResetDefaults}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Мобильная навигация"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#0D0B16]/95 backdrop-blur-md border-t border-[#E6E2F3] dark:border-[#211D35] pb-safe"
      >
        <div className="grid grid-cols-3 h-[60px]">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center gap-1 min-h-[44px] transition-colors cursor-pointer ${
                  active
                    ? 'text-violet-600 dark:text-violet-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] font-medium tracking-tight whitespace-nowrap">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
}
