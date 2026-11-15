// Metro precisa enxergar o núcleo compartilhado (packages/core), que fica fora do app.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const coreDir = path.resolve(__dirname, '../../packages/core');
config.watchFolders = [...(config.watchFolders || []), coreDir];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

// expo-sqlite na versão web: arquivos .wasm e cabeçalhos que liberam SharedArrayBuffer
config.resolver.assetExts.push('wasm');
config.server.enhanceMiddleware = middleware => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  middleware(req, res, next);
};

module.exports = config;
