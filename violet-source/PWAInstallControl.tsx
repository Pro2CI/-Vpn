import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    if (variant === 'card') {
      return (
        <div className="text-xs font-medium text-violet-600 dark:text-violet-400">
          Установлено на устройство (Standalone)
        </div>
      );
    }
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="min-h-[42px] px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Установить на Android</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[42px] px-4 py-2 rounded-xl border border-[#E6E2F3] dark:border-[#27223E] hover:bg-[#F5F2FC] dark:hover:bg-[#181529] text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>Установить на экран</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Установка на iOS"
          >
            <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#11101C] border border-[#E6E2F3] dark:border-[#231F38] p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Установка Violet VPN
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Закрыть"
                  className="min-h-[38px] min-w-[38px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-[#F2EFFA] dark:hover:bg-[#1B182C] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300 list-decimal list-inside">
                <li>Нажмите кнопку «Поделиться» на панели Safari.</li>
                <li>Выберите пункт «На экран «Домой».</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[42px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
              >
                Понятно
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 lg:bottom-5 left-4 z-50 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-[#1E1910] px-3.5 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
      <span>Офлайн-режим · Локальные профили доступны</span>
    </div>
  );
};
