package com.omnistate.accessibility

import android.accessibilityservice.GestureDescription
import android.graphics.Path

object GestureBuilder {

    fun buildTap(x: Float, y: Float): GestureDescription {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 50)
        return GestureDescription.Builder().addStroke(stroke).build()
    }

    fun buildLongPress(x: Float, y: Float, duration: Long = 800): GestureDescription {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, duration)
        return GestureDescription.Builder().addStroke(stroke).build()
    }

    fun buildSwipe(
        fromX: Float, fromY: Float,
        toX: Float, toY: Float,
        duration: Long = 300
    ): GestureDescription {
        val path = Path().apply {
            moveTo(fromX, fromY)
            lineTo(toX, toY)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, duration)
        return GestureDescription.Builder().addStroke(stroke).build()
    }

    fun buildMultiSwipe(
        points: List<Pair<Float, Float>>,
        duration: Long = 500
    ): GestureDescription {
        require(points.size >= 2) { "At least 2 points required" }
        val path = Path().apply {
            moveTo(points[0].first, points[0].second)
            for (i in 1 until points.size) {
                lineTo(points[i].first, points[i].second)
            }
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, duration)
        return GestureDescription.Builder().addStroke(stroke).build()
    }

    fun buildPinch(
        centerX: Float, centerY: Float,
        startDistance: Float, endDistance: Float,
        duration: Long = 400
    ): GestureDescription {
        val startRadius = startDistance / 2f
        val endRadius = endDistance / 2f

        val path1 = Path().apply {
            moveTo(centerX - startRadius, centerY)
            lineTo(centerX - endRadius, centerY)
        }
        val path2 = Path().apply {
            moveTo(centerX + startRadius, centerY)
            lineTo(centerX + endRadius, centerY)
        }
        val stroke1 = GestureDescription.StrokeDescription(path1, 0, duration)
        val stroke2 = GestureDescription.StrokeDescription(path2, 0, duration)

        return GestureDescription.Builder()
            .addStroke(stroke1)
            .addStroke(stroke2)
            .build()
    }
}
