const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(monorepoRoot, "node_modules"),
    ],
    // Don't try to resolve native-only packages in shared code
    resolveRequest: (context, moduleName, platform) => {
      // Let default resolver handle it
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
