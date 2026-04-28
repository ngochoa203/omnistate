package com.omnistate.capture

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Rect
import android.util.Base64
import java.io.ByteArrayOutputStream

object ImageProcessor {

    fun bitmapToBase64(bitmap: Bitmap, quality: Int = 85): String {
        val stream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(1, 100), stream)
        return Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
    }

    fun resizeBitmap(bitmap: Bitmap, maxWidth: Int, maxHeight: Int): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        if (width <= maxWidth && height <= maxHeight) return bitmap

        val widthRatio = maxWidth.toFloat() / width
        val heightRatio = maxHeight.toFloat() / height
        val scale = minOf(widthRatio, heightRatio)

        val matrix = Matrix().apply { postScale(scale, scale) }
        return Bitmap.createBitmap(bitmap, 0, 0, width, height, matrix, true)
    }

    fun cropBitmap(bitmap: Bitmap, rect: Rect): Bitmap {
        val safeLeft = rect.left.coerceAtLeast(0)
        val safeTop = rect.top.coerceAtLeast(0)
        val safeWidth = rect.width().coerceAtMost(bitmap.width - safeLeft)
        val safeHeight = rect.height().coerceAtMost(bitmap.height - safeTop)
        return Bitmap.createBitmap(bitmap, safeLeft, safeTop, safeWidth, safeHeight)
    }
}
