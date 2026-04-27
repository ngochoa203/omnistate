package com.omnistate.capture

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ScreenCaptureBridge(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val REQ_MEDIA_PROJECTION = 10001
    }

    private var permissionPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName() = "OmniScreenCapture"

    @ReactMethod
    fun requestPermission(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No current activity")
            return
        }
        permissionPromise = promise
        val manager = activity.getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE)
            as MediaProjectionManager
        val intent = manager.createScreenCaptureIntent()
        activity.startActivityForResult(intent, REQ_MEDIA_PROJECTION)
    }

    @ReactMethod
    fun captureScreenshot(quality: Int, promise: Promise) {
        val service = ScreenCaptureService.instance
        if (service == null || !service.isActive()) {
            promise.reject("NOT_ACTIVE", "Screen capture service is not active")
            return
        }
        try {
            val base64 = service.captureFrame(quality)
            if (base64 != null) promise.resolve(base64)
            else promise.reject("NO_FRAME", "No frame available")
        } catch (e: Exception) {
            promise.reject("CAPTURE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopCapture(promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, ScreenCaptureService::class.java)
            reactApplicationContext.stopService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isCapturing(promise: Promise) {
        promise.resolve(ScreenCaptureService.instance?.isActive() == true)
    }

    override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
    ) {
        if (requestCode != REQ_MEDIA_PROJECTION) return
        val promise = permissionPromise ?: return
        permissionPromise = null

        if (resultCode != Activity.RESULT_OK || data == null) {
            promise.reject("PERMISSION_DENIED", "User denied screen capture permission")
            return
        }

        try {
            val intent = Intent(reactApplicationContext, ScreenCaptureService::class.java).apply {
                putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
                putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("START_ERROR", e.message, e)
        }
    }

    override fun onNewIntent(intent: Intent?) { /* no-op */ }
}
