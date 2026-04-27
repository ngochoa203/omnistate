/**
 * main.m
 * OmniState iOS
 *
 * Standard React Native entry point.
 * The UIApplicationMain call boots UIKit, which calls AppDelegate.
 */

#import <UIKit/UIKit.h>

#import "AppDelegate.h"

int main(int argc, char *argv[])
{
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil, NSStringFromClass([AppDelegate class]));
  }
}
