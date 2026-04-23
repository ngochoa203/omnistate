package com.omnistate.accessibility

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

object NodeSerializer {

    private const val MAX_DEPTH = 15

    fun serializeTree(root: AccessibilityNodeInfo?): WritableArray {
        val result = Arguments.createArray()
        root ?: return result
        result.pushMap(serializeNode(root, 0))
        return result
    }

    private fun serializeNode(node: AccessibilityNodeInfo, depth: Int): WritableMap {
        val map = Arguments.createMap()

        map.putString("text", node.text?.toString())
        map.putString("contentDescription", node.contentDescription?.toString())
        map.putString("className", node.className?.toString())
        map.putString("packageName", node.packageName?.toString())
        map.putString("viewIdResourceName", node.viewIdResourceName)
        map.putBoolean("clickable", node.isClickable)
        map.putBoolean("enabled", node.isEnabled)
        map.putBoolean("focusable", node.isFocusable)
        map.putBoolean("focused", node.isFocused)
        map.putBoolean("scrollable", node.isScrollable)
        map.putBoolean("checkable", node.isCheckable)
        map.putBoolean("checked", node.isChecked)
        map.putBoolean("selected", node.isSelected)
        map.putBoolean("longClickable", node.isLongClickable)
        map.putBoolean("password", node.isPassword)
        map.putInt("depth", depth)

        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        val boundsMap = Arguments.createMap().apply {
            putInt("left", bounds.left)
            putInt("top", bounds.top)
            putInt("right", bounds.right)
            putInt("bottom", bounds.bottom)
            putInt("width", bounds.width())
            putInt("height", bounds.height())
        }
        map.putMap("bounds", boundsMap)

        val children = Arguments.createArray()
        if (depth < MAX_DEPTH) {
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                children.pushMap(serializeNode(child, depth + 1))
                child.recycle()
            }
        }
        map.putArray("children", children)

        return map
    }

    fun findNodeByText(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        root ?: return null
        if (root.text?.toString()?.contains(text, ignoreCase = true) == true ||
            root.contentDescription?.toString()?.contains(text, ignoreCase = true) == true
        ) {
            return root
        }
        for (i in 0 until root.childCount) {
            val child = root.getChild(i) ?: continue
            val found = findNodeByText(child, text)
            if (found != null) return found
            child.recycle()
        }
        return null
    }
}
