package com.omnistate.overlay

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class OverlayBridge(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "OmniOverlay"

    @ReactMethod
    fun showOverlay(promise: Promise) {
        if (!hasPermission()) {
            promise.reject("NO_PERMISSION", "Overlay permission not granted")
            return
        }
        try {
            val intent = Intent(reactApplicationContext, OverlayWindowService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SHOW_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun hideOverlay(promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, OverlayWindowService::class.java)
            reactApplicationContext.stopService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("HIDE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun updateStatus(text: String, promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, OverlayWindowService::class.java).apply {
                action = OverlayWindowService.ACTION_UPDATE_STATUS
                putExtra(OverlayWindowService.EXTRA_STATUS, text)
            }
            reactApplicationContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("UPDATE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setExpanded(expanded: Boolean, promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, OverlayWindowService::class.java).apply {
                action = OverlayWindowService.ACTION_SET_EXPANDED
                putExtra(OverlayWindowService.EXTRA_EXPANDED, expanded)
            }
            reactApplicationContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("EXPAND_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun hasOverlayPermission(promise: Promise) {
        promise.resolve(hasPermission())
    }

    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        try {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${reactApplicationContext.packageName}"),
            ).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PERMISSION_ERROR", e.message, e)
        }
    }

    private fun hasPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(reactApplicationContext)
        } else true
    }
}
