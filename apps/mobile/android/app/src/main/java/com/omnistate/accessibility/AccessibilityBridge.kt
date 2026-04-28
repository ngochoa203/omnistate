package com.omnistate.accessibility

import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AccessibilityBridge(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun getName() = "OmniAccessibility"

    @ReactMethod
    fun getScreenTree(promise: Promise) {
        val service = OmniAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_NOT_RUNNING", "Accessibility service is not running")
            return
        }
        try {
            val root = service.getRootNode()
            val tree = NodeSerializer.serializeTree(root)
            root?.recycle()
            promise.resolve(tree)
        } catch (e: Exception) {
            promise.reject("TREE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun tap(x: Double, y: Double, promise: Promise) {
        val service = OmniAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_NOT_RUNNING", "Accessibility service is not running")
            return
        }
        try {
            val gesture = GestureBuilder.buildTap(x.toFloat(), y.toFloat())
            service.performGesture(gesture) { success ->
                if (success) promise.resolve(true)
                else promise.reject("GESTURE_CANCELLED", "Tap gesture was cancelled")
            }
        } catch (e: Exception) {
            promise.reject("GESTURE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun swipe(
        fromX: Double, fromY: Double,
        toX: Double, toY: Double,
        duration: Int,
        promise: Promise
    ) {
        val service = OmniAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_NOT_RUNNING", "Accessibility service is not running")
            return
        }
        try {
            val gesture = GestureBuilder.buildSwipe(
                fromX.toFloat(), fromY.toFloat(),
                toX.toFloat(), toY.toFloat(),
                duration.toLong()
            )
            service.performGesture(gesture) { success ->
                if (success) promise.resolve(true)
                else promise.reject("GESTURE_CANCELLED", "Swipe gesture was cancelled")
            }
        } catch (e: Exception) {
            promise.reject("GESTURE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun typeText(text: String, promise: Promise) {
        val service = OmniAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_NOT_RUNNING", "Accessibility service is not running")
            return
        }
        try {
            val root = service.getRootNode()
            val focusedNode = root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            if (focusedNode == null) {
                root?.recycle()
                promise.reject("NO_FOCUSED_NODE", "No focused input field found")
                return
            }
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            val result = focusedNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            focusedNode.recycle()
            root.recycle()
            if (result) promise.resolve(true)
            else promise.reject("TYPE_FAILED", "Failed to set text on focused node")
        } catch (e: Exception) {
            promise.reject("TYPE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun performAction(action: String, promise: Promise) {
        val service = OmniAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_NOT_RUNNING", "Accessibility service is not running")
            return
        }
        val globalAction = when (action.lowercase()) {
            "back" -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK
            "home" -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME
            "recents" -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_RECENTS
            "notifications" -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
            "powerdialog" -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_POWER_DIALOG
            "quicksettings" -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS
            "lockscreen" -> android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN
            else -> {
                promise.reject("UNKNOWN_ACTION", "Unknown action: $action")
                return
            }
        }
        val result = service.doGlobalAction(globalAction)
        if (result) promise.resolve(true)
        else promise.reject("ACTION_FAILED", "Failed to perform action: $action")
    }

    @ReactMethod
    fun findElementByText(text: String, promise: Promise) {
        val service = OmniAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_NOT_RUNNING", "Accessibility service is not running")
            return
        }
        try {
            val root = service.getRootNode()
            val node = NodeSerializer.findNodeByText(root, text)
            if (node == null) {
                root?.recycle()
                promise.reject("NOT_FOUND", "Element with text '$text' not found")
                return
            }
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            val result = com.facebook.react.bridge.Arguments.createMap().apply {
                putInt("left", bounds.left)
                putInt("top", bounds.top)
                putInt("right", bounds.right)
                putInt("bottom", bounds.bottom)
                putInt("centerX", bounds.centerX())
                putInt("centerY", bounds.centerY())
            }
            node.recycle()
            root?.recycle()
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("FIND_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isServiceEnabled(promise: Promise) {
        promise.resolve(OmniAccessibilityService.isRunning())
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RCTEventEmitter — no-op
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RCTEventEmitter — no-op
    }
}
