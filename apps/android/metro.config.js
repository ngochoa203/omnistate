const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

// Metro serves both Android (apps/android/android/) and iOS (apps/android/ios/).
// The watchFolders and nodeModulesPaths config ensures that workspace packages
// (@omnistate/mobile-core, @omnistate/shared) are resolvable from both platforms.
const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(monorepoRoot, "node_modules"),
    ],
    // Let default resolver handle platform-specific extensions (.ios.ts, .android.ts)
    resolveRequest: (context, moduleName, platform) => {
      // Let default resolver handle it
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
