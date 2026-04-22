package com.omnistate

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.omnistate.accessibility.AccessibilityBridge
import com.omnistate.capture.ScreenCaptureBridge
import com.omnistate.overlay.OverlayBridge

class OmniPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(
        AccessibilityBridge(reactContext),
        ScreenCaptureBridge(reactContext),
        OverlayBridge(reactContext),
    )

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
