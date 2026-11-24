import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVpnConfigFormat, parseAnyVpnConfigs, serializeWireGuardConfig } from '../../src/data/vpnData.ts';

const sample = {
  log: { loglevel: 'warning' },
  outbounds: [
    {
      tag: 'proxy',
      protocol: 'vless',
      settings: {
        vnext: [{
          address: 'edge.example.net',
          port: 443,
          users: [{ id: '11111111-1111-4111-8111-111111111111', encryption: 'none', flow: 'xtls-rprx-vision' }],
        }],
      },
      streamSettings: {
        network: 'xhttp',
        security: 'reality',
        realitySettings: { serverName: 'www.example.com', publicKey: 'public-key', shortId: 'abcd', fingerprint: 'chrome' },
      },
    },
    { tag: 'direct', protocol: 'freedom', settings: {} },
  ],
};

test('imports Xray JSON with VLESS REALITY and XHTTP while preserving original config', () => {
  const raw = JSON.stringify(sample);
  assert.match(detectVpnConfigFormat(raw) || '', /Xray JSON/);
  const result = parseAnyVpnConfigs(raw, 'Reality XHTTP test');
  assert.equal(result.error, undefined);
  assert.equal(result.profiles?.length, 1);
  const profile = result.profiles?.[0];
  assert.ok(profile);
  assert.equal(profile.protocol, 'vless');
  assert.equal(profile.peerConfig.endpoint, 'edge.example.net:443');
  assert.equal(profile.vlessConfig?.security, 'reality');
  assert.equal(profile.vlessConfig?.network, 'xhttp');
  assert.equal(profile.vlessConfig?.flow, 'xtls-rprx-vision');
  assert.equal(profile.vlessConfig?.pbk, 'public-key');
  assert.equal(serializeWireGuardConfig(profile), raw);
});

test('rejects JSON without Xray outbounds', () => {
  const result = parseAnyVpnConfigs('{"inbounds":[]}');
  assert.match(result.error || '', /outbounds/);
});
