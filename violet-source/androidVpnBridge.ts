import { ConnectionStatus, ProfileProtocol, SplitTunnelMode } from '../types/vpn';

export interface NativeAndroidBridge {
  connect: (configText: string, splitMode: SplitTunnelMode, packagesJson: string) => void;
  connectAny?: (
    protocol: string,
    configText: string,
    splitMode: SplitTunnelMode,
    packagesJson: string
  ) => void;
  hasNativeCore?: (protocol: string) => boolean;
  disconnect: () => void;
  getState: () => string;
}

declare global {
  interface Window {
    VioletAndroidBridge?: NativeAndroidBridge;
    onVioletVpnState?: (state: string, errorMessage?: string) => void;
  }
}

export function isNativeAndroidBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.VioletAndroidBridge !== 'undefined';
}

export function connectNativeAnyProtocol(
  protocol: ProfileProtocol,
  configText: string,
  splitMode: SplitTunnelMode,
  packageNames: string[]
): boolean {
  if (!isNativeAndroidBridgeAvailable() || !window.VioletAndroidBridge) {
    return false;
  }
  const packagesJson = JSON.stringify(packageNames);
  if (typeof window.VioletAndroidBridge.connectAny === 'function') {
    window.VioletAndroidBridge.connectAny(protocol, configText, splitMode, packagesJson);
    return true;
  }
  if (protocol === 'wireguard' || protocol === 'amneziawg') {
    window.VioletAndroidBridge.connect(configText, splitMode, packagesJson);
    return true;
  }
  return false;
}

export function connectNativeWireGuard(
  configText: string,
  splitMode: SplitTunnelMode,
  packageNames: string[]
): boolean {
  return connectNativeAnyProtocol('wireguard', configText, splitMode, packageNames);
}

export function disconnectNativeWireGuard(): boolean {
  if (!isNativeAndroidBridgeAvailable() || !window.VioletAndroidBridge) {
    return false;
  }
  window.VioletAndroidBridge.disconnect();
  return true;
}

export function subscribeNativeVpnEvents(
  onStateChange: (status: ConnectionStatus, error?: string) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  window.onVioletVpnState = (state: string, errorMessage?: string) => {
    if (
      state === 'connected' ||
      state === 'connecting' ||
      state === 'disconnected' ||
      state === 'disconnecting'
    ) {
      onStateChange(state, errorMessage || undefined);
    }
  };
  return () => {
    delete window.onVioletVpnState;
  };
}
