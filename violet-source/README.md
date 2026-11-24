# Violet VPN (Android)

Violet VPN — Android VPN client with VLESS URI/subscription import and a native Xray-core integration path. The native VLESS runtime uses the official XTLS/libXray Android AAR, generated in CI from the upstream source.

## Build APK in GitHub Actions

1. Push the complete repository to GitHub.
2. Open **Actions → Build Violet VPN APK → Run workflow**.
3. Wait for the `build-apk` job to complete.
4. Download the `Violet-VPN-Android-APK` artifact. The debug APK is unsigned for Play distribution but can be installed directly on a test device after allowing installs from the browser/files app.

The workflow builds the React UI, builds `libXray.aar` using the upstream `python3 build/main.py android` script, then runs `:app:assembleDebug`.

## Native VLESS path

The Android `VpnService` creates the TUN descriptor, registers libXray's Android socket-protection callback, converts the supplied VLESS URI using Invoke API v3, passes `xray.tun.fd` in the Xray config, starts `runXray`, and verifies `getXrayState` before reporting connected. It stops Xray and resets the process DNS hook on disconnect.

The non-VLESS proxy protocols are deliberately rejected by the native service until their own supported runtime is integrated. The legacy WireGuard path remains separate.

## Important verification note

This repository contains source code and a CI build workflow. An installable APK is not included in the source archive. The native integration must still pass a GitHub Actions build and a real-device connection test before this build can be described as release-ready. A successful `runXray`/state response confirms the core started; it does not by itself prove that a specific public node is reachable or that all device traffic is routed correctly.
