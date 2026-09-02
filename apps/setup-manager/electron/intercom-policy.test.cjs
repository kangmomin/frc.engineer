const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  expectedRendererURL,
  isMicrophoneCheck,
  isMicrophoneRequest,
  isTrustedMicrophoneCheck,
  isTrustedMicrophoneRequest,
  isTrustedRendererURL,
} = require('./intercom-policy.cjs');

const dev = { isDev: true, distIndex: '/unused/index.html' };
const prod = { isDev: false, distIndex: path.resolve('/tmp/driver-pack/dist/index.html') };

test('renderer URL matching is exact in dev and packaged modes', () => {
  assert.equal(isTrustedRendererURL('http://localhost:5173/', dev), true);
  assert.equal(isTrustedRendererURL('http://localhost:5173/evil', dev), false);
  assert.equal(isTrustedRendererURL('http://127.0.0.1:5173/', dev), false);
  assert.equal(isTrustedRendererURL(expectedRendererURL(prod), prod), true);
  assert.equal(isTrustedRendererURL(`${expectedRendererURL(prod)}#remote`, prod), false);
});

test('permission requests allow only the exact audio-only mediaTypes shape', () => {
  assert.equal(isMicrophoneRequest('media', { mediaTypes: ['audio'] }), true);
  assert.equal(isMicrophoneRequest('media', { mediaTypes: ['audio', 'video'] }), false);
  assert.equal(isMicrophoneRequest('media', { mediaTypes: ['video'] }), false);
  assert.equal(isMicrophoneRequest('media', { mediaTypes: ['unknown'] }), false);
  assert.equal(isMicrophoneRequest('media', {}), false);
  assert.equal(isMicrophoneRequest('camera', { mediaTypes: ['audio'] }), false);
  assert.equal(isMicrophoneRequest('display-capture', { mediaTypes: ['audio'] }), false);
});

test('permission checks allow only the exact audio mediaType shape', () => {
  assert.equal(isMicrophoneCheck('media', { mediaType: 'audio' }), true);
  assert.equal(isMicrophoneCheck('media', { mediaType: 'video' }), false);
  assert.equal(isMicrophoneCheck('media', { mediaType: 'unknown' }), false);
  assert.equal(isMicrophoneCheck('media', { mediaType: ['audio', 'video'] }), false);
  assert.equal(isMicrophoneCheck('media', {}), false);
  assert.equal(isMicrophoneCheck('media', { mediaTypes: ['audio'] }), false);
  assert.equal(isMicrophoneCheck('camera', { mediaType: 'audio' }), false);
});

test('permission also binds the exact renderer webContents', () => {
  assert.equal(isTrustedMicrophoneRequest({
    permission: 'media',
    details: { mediaTypes: ['audio'] },
    requestingURL: 'http://localhost:5173/',
    webContentsId: 7,
    trustedWebContentsId: 7,
    options: dev,
  }), true);
  assert.equal(isTrustedMicrophoneRequest({
    permission: 'media',
    details: { mediaTypes: ['audio'] },
    requestingURL: 'http://localhost:5173/',
    webContentsId: 8,
    trustedWebContentsId: 7,
    options: dev,
  }), false);
  assert.equal(isTrustedMicrophoneRequest({
    permission: 'media',
    details: { mediaTypes: ['audio'] },
    requestingURL: 'http://localhost:5173/evil',
    webContentsId: 7,
    trustedWebContentsId: 7,
    options: dev,
  }), false);
});

test('permission checks also bind the exact renderer and webContents', () => {
  const allowed = {
    permission: 'media',
    details: { mediaType: 'audio' },
    requestingURL: 'http://localhost:5173/',
    webContentsId: 7,
    trustedWebContentsId: 7,
    options: dev,
  };
  assert.equal(isTrustedMicrophoneCheck(allowed), true);
  assert.equal(isTrustedMicrophoneCheck({ ...allowed, webContentsId: 8 }), false);
  assert.equal(isTrustedMicrophoneCheck({ ...allowed, requestingURL: 'http://localhost:5173/evil' }), false);
});
