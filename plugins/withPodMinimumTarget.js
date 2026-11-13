// Build fixes for current Xcode.
// Some pods still declare iOS 13 for their resource bundles, which current Xcode
// refuses to build. This raises every pod target to the app's own minimum.
const { withPodfile } = require('expo/config-plugins');

const MARKER = '# islicer: raise pod deployment targets';
const SNIPPET = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        current = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f
        build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1' if current < 15.1
        # fmt's consteval checks fail under newer Xcode in C++20 mode; C++17 avoids them.
        build_configuration.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17' if target.name == 'fmt'
      end
    end
`;

module.exports = function withPodMinimumTarget(config) {
  return withPodfile(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      // After React Native's own post-install step, which would otherwise reset these.
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /(react_native_post_install\([\s\S]*?\n    \)\n)/,
        (match) => match + SNIPPET,
      );
    }
    return cfg;
  });
};
