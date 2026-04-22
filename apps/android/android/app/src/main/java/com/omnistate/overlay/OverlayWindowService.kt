package com.omnistate.overlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.core.app.NotificationCompat

class OverlayWindowService : Service() {

    companion object {
        const val CHANNEL_ID = "omnistate_overlay"
        const val NOTIFICATION_ID = 42002
        const val ACTION_UPDATE_STATUS = "com.omnistate.overlay.UPDATE_STATUS"
        const val ACTION_SET_EXPANDED = "com.omnistate.overlay.SET_EXPANDED"
        const val EXTRA_STATUS = "status"
        const val EXTRA_EXPANDED = "expanded"

        @Volatile
        var instance: OverlayWindowService? = null
            private set
    }

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var statusText: TextView? = null
    private var isExpanded = false
    private var layoutParams: WindowManager.LayoutParams? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
        showOverlay()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE_STATUS -> {
                val status = intent.getStringExtra(EXTRA_STATUS) ?: return START_STICKY
                updateStatus(status)
            }
            ACTION_SET_EXPANDED -> {
                val expanded = intent.getBooleanExtra(EXTRA_EXPANDED, false)
                setExpanded(expanded)
            }
        }
        return START_STICKY
    }

    private fun showOverlay() {
        if (overlayView != null) return
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
        }

        layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 24
            y = 160
        }

        val view = buildCollapsedView()
        overlayView = view
        windowManager?.addView(view, layoutParams)
    }

    private fun buildCollapsedView(): View {
        val container = TextView(this).apply {
            text = "●"
            textSize = 22f
            setPadding(28, 16, 28, 16)
            setBackgroundColor(0xCC1E293B.toInt())
            setTextColor(0xFF60A5FA.toInt())
        }
        statusText = container
        attachDrag(container)
        container.setOnClickListener {
            setExpanded(!isExpanded)
        }
        return container
    }

    private fun attachDrag(view: View) {
        var initialX = 0
        var initialY = 0
        var touchX = 0f
        var touchY = 0f
        view.setOnTouchListener { _, ev ->
            val lp = layoutParams ?: return@setOnTouchListener false
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = lp.x
                    initialY = lp.y
                    touchX = ev.rawX
                    touchY = ev.rawY
                    false
                }
                MotionEvent.ACTION_MOVE -> {
                    lp.x = initialX + (ev.rawX - touchX).toInt()
                    lp.y = initialY + (ev.rawY - touchY).toInt()
                    windowManager?.updateViewLayout(overlayView, lp)
                    true
                }
                else -> false
            }
        }
    }

    fun updateStatus(status: String) {
        statusText?.post { statusText?.text = status }
    }

    fun setExpanded(expanded: Boolean) {
        isExpanded = expanded
        statusText?.post {
            statusText?.text = if (expanded) "● OmniState" else "●"
        }
    }

    override fun onDestroy() {
        try {
            overlayView?.let { windowManager?.removeView(it) }
        } catch (_: Exception) { /* ignore */ }
        overlayView = null
        instance = null
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("OmniState")
            .setContentText("Overlay active")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Overlay",
                NotificationManager.IMPORTANCE_LOW,
            )
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }
}
