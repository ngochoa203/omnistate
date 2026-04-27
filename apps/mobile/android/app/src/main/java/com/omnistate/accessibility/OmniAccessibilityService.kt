package com.omnistate.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule

class OmniAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "OmniAccessibility"
        var instance: OmniAccessibilityService? = null
            private set

        fun isRunning() = instance != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "AccessibilityService connected")
        emitEvent("onServiceConnected", null)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val params = Arguments.createMap().apply {
            putInt("eventType", event.eventType)
            putString("packageName", event.packageName?.toString())
            putString("className", event.className?.toString())
            putString("text", event.text?.joinToString(" "))
            putLong("eventTime", event.eventTime)
        }
        emitEvent("onAccessibilityEvent", params)
    }

    override fun onInterrupt() {
        Log.d(TAG, "AccessibilityService interrupted")
        emitEvent("onServiceInterrupted", null)
    }

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        Log.d(TAG, "AccessibilityService unbound")
        return super.onUnbind(intent)
    }

    fun getRootNode(): AccessibilityNodeInfo? = rootInActiveWindow

    fun performGesture(
        gesture: GestureDescription,
        onComplete: (Boolean) -> Unit
    ) {
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) {
                onComplete(true)
            }
            override fun onCancelled(gestureDescription: GestureDescription) {
                onComplete(false)
            }
        }, null)
    }

    fun doGlobalAction(action: Int): Boolean = performGlobalAction(action)

    private fun emitEvent(name: String, params: com.facebook.react.bridge.WritableMap?) {
        try {
            val reactApp = application as? ReactApplication ?: return
            reactApp.reactNativeHost.reactInstanceManager
                .currentReactContext
                ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(name, params)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to emit event $name: ${e.message}")
        }
    }
}
