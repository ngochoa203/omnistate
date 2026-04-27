/**
 * AppDelegate.mm
 * OmniState iOS
 *
 * React Native 0.77 uses the Objective-C++ AppDelegate with the new
 * RCTAppDelegate base class, which wires up the Bridgeless (JSI) renderer
 * and Hermes automatically.
 *
 * DO NOT rename this file — the .mm extension is required so that the
 * compiler treats it as Objective-C++ (needed by RCTAppDelegate internals).
 */

#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"OmniState";

  // Initial props passed to the React root component (App.tsx).
  // Add any launch-time props here if needed.
  self.initialProps = @{};

  return [super application:application
      didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings]
      jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main"
                                 withExtension:@"jsbundle"];
#endif
}

/**
 * Return YES to run the app in Concurrent (React 19) root.
 * Required for the new architecture / Bridgeless mode.
 */
- (BOOL)concurrentRootEnabled
{
  return YES;
}

@end
