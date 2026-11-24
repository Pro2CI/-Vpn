import React from 'react';
import { Moon, RotateCcw, Shield, Sun } from 'lucide-react';
import { AndroidAppEntry, SplitTunnelMode, VpnSettings } from '../types/vpn';
import { DNS_PRESETS } from '../data/vpnData';

interface SettingsTabProps {
  settings: VpnSettings;
  apps: AndroidAppEntry[];
  nativeBridgeAvailable: boolean;
  onUpdateSetting: <K extends keyof VpnSettings>(key: K, value: VpnSettings[K]) => void;
  onToggleAppBypass: (appId: string) => void;
  onResetDefaults: () => void;
}

const MTU_OPTIONS = [
  { value: 1280, label: '1280', hint: 'Мобильный LTE / WARP' },
  { value: 1380, label: '1380', hint: 'Сбалансированный' },
  { value: 1420, label: '1420', hint: 'Стандарт WireGuard' },
];

const WARP_PORT_OPTIONS = [854, 859, 500, 4500, 2408];

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  apps,
  nativeBridgeAvailable,
  onUpdateSetting,
  onToggleAppBypass,
  onResetDefaults,
}) => {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Настройки подключения
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Параметры автоподбора WARP/WireGuard, выбор DNS и тема интерфейса
          </p>
        </div>

        <button
          type="button"
          onClick={onResetDefaults}
          className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] bg-white dark:bg-[#11101C] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 self-start sm:self-auto transition-colors whitespace-nowrap cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Сбросить</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-6 rounded-2xl border border-[#E6E2F3] dark:border-[#231F38] bg-white dark:bg-[#11101C] p-5 flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Тема оформления
            </h3>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F2EFF9] dark:bg-[#0C0B15] border border-[#E6E2F3] dark:border-[#231F38]">
              <button
                type="button"
                onClick={() => onUpdateSetting('theme', 'light')}
                className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  settings.theme === 'light'
                    ? 'bg-white text-violet-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Светлая</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSetting('theme', 'dark')}
                className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  settings.theme === 'dark'
                    ? 'bg-violet-600/25 text-violet-200 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>Тёмная</span>
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
              Предпочитаемый UDP-порт Cloudflare WARP
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2.5">
              Используется при автоматической генерации профилей AmneziaWG / WARP
            </p>
            <div className="flex flex-wrap gap-2">
              {WARP_PORT_OPTIONS.map((port) => {
                const active = settings.preferredWarpPort === port;
                return (
                  <button
                    key={port}
                    type="button"
                    onClick={() => onUpdateSetting('preferredWarpPort', port)}
                    className={`min-h-[38px] px-3.5 py-1.5 rounded-xl border font-mono text-xs font-semibold tabular-nums transition-colors cursor-pointer ${
                      active
                        ? 'border-violet-500 bg-violet-50/80 dark:bg-violet-950/35 text-violet-700 dark:text-violet-200'
                        : 'border-[#E6E2F3] dark:border-[#231F38] text-slate-700 dark:text-slate-300 hover:bg-[#F8F6FC] dark:hover:bg-[#161425]'
                    }`}
                  >
                    :{port}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
              Размер пакета (MTU)
            </h3>
            <div className="grid grid-cols-3 gap-2.5">
              {MTU_OPTIONS.map((opt) => {
                const active = settings.mtu === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdateSetting('mtu', opt.value)}
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-violet-500 bg-violet-50/80 dark:bg-violet-950/35'
                        : 'border-[#E6E2F3] dark:border-[#231F38] hover:bg-[#F8F6FC] dark:hover:bg-[#161425]'
                    }`}
                  >
                    <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                      {opt.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="lg:col-span-6 rounded-2xl border border-[#E6E2F3] dark:border-[#231F38] bg-white dark:bg-[#11101C] p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              DNS-резолвер для новых профилей
            </h3>
          </div>

          <div className="flex flex-col divide-y divide-[#ECE8F6] dark:divide-[#1E1A2E] border border-[#E6E2F3] dark:border-[#231F38] rounded-xl overflow-hidden">
            {DNS_PRESETS.map((preset) => {
              const selected = settings.dnsPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onUpdateSetting('dnsPresetId', preset.id)}
                  className={`w-full px-4 py-3 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    selected
                      ? 'bg-violet-50/80 dark:bg-violet-950/35'
                      : 'hover:bg-[#F8F6FC] dark:hover:bg-[#161425]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {preset.label}{' '}
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        · {preset.address}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {preset.description}
                    </div>
                  </div>
                  <span
                    className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      selected
                        ? 'border-violet-600 dark:border-violet-400'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {selected && (
                      <span className="w-2 h-2 rounded-full bg-violet-600 dark:bg-violet-400" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {nativeBridgeAvailable && (
            <div className="pt-2 border-t border-[#ECE8F6] dark:border-[#1E1A2E] flex flex-col gap-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Раздельное туннелирование Android
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#F2EFF9] dark:bg-[#0C0B15] border border-[#E6E2F3] dark:border-[#231F38]">
                {(
                  [
                    { id: 'all', label: 'Все' },
                    { id: 'exclude', label: 'Исключить' },
                    { id: 'include', label: 'Только эти' },
                  ] as { id: SplitTunnelMode; label: string }[]
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => onUpdateSetting('splitTunnelMode', mode.id)}
                    className={`min-h-[36px] px-2 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                      settings.splitTunnelMode === mode.id
                        ? 'bg-white dark:bg-violet-600/25 text-violet-700 dark:text-violet-200 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              {settings.splitTunnelMode !== 'all' && (
                <div className="divide-y divide-[#ECE8F6] dark:divide-[#1E1A2E] max-h-48 overflow-y-auto">
                  {apps.map((app) => (
                    <div key={app.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-slate-800 dark:text-slate-200">{app.name}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={app.bypassVpn}
                        onClick={() => onToggleAppBypass(app.id)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                          app.bypassVpn ? 'bg-violet-600' : 'bg-slate-200 dark:bg-[#242038]'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            app.bypassVpn ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
