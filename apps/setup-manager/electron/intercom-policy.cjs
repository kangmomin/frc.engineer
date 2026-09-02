const { pathToFileURL } = require('url');

function expectedRendererURL({ isDev, distIndex }) {
  return isDev ? 'http://localhost:5173/' : pathToFileURL(distIndex).href;
}

function isTrustedRendererURL(value, options) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).href === expectedRendererURL(options);
  } catch {
    return false;
  }
}

function isMicrophoneRequest(permission, details) {
  return permission === 'media'
    && Array.isArray(details?.mediaTypes)
    && details.mediaTypes.length === 1
    && details.mediaTypes[0] === 'audio';
}

function isMicrophoneCheck(permission, details) {
  return permission === 'media' && details?.mediaType === 'audio';
}

function isTrustedMicrophoneRequest({ permission, details, requestingURL, webContentsId, trustedWebContentsId, options }) {
  return webContentsId === trustedWebContentsId
    && isTrustedRendererURL(requestingURL, options)
    && isMicrophoneRequest(permission, details);
}

function isTrustedMicrophoneCheck({ permission, details, requestingURL, webContentsId, trustedWebContentsId, options }) {
  return webContentsId === trustedWebContentsId
    && isTrustedRendererURL(requestingURL, options)
    && isMicrophoneCheck(permission, details);
}

module.exports = {
  expectedRendererURL,
  isMicrophoneCheck,
  isMicrophoneRequest,
  isTrustedMicrophoneCheck,
  isTrustedMicrophoneRequest,
  isTrustedRendererURL,
};
