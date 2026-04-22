import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import { ScreenCaptureModule } from "../native/ScreenCaptureModule";

export function LivePreviewScreen() {
  const [capturing, setCapturing] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameCount = useRef(0);
  const lastFpsTime = useRef(Date.now());

  const loop = useCallback(async () => {
    try {
      const b64 = await ScreenCaptureModule.captureScreenshot(60);
      if (b64) setFrame(b64);
      frameCount.current += 1;
      const now = Date.now();
      if (now - lastFpsTime.current >= 1000) {
        setFps(frameCount.current);
        frameCount.current = 0;
        lastFpsTime.current = now;
      }
    } catch { /* ignore frame errors */ }
  }, []);

  const onStart = useCallback(async () => {
    try {
      await ScreenCaptureModule.requestPermission();
      setCapturing(true);
      timerRef.current = setInterval(loop, 200);
    } catch { setCapturing(false); }
  }, [loop]);

  const onStop = useCallback(async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setCapturing(false);
    setFrame(null);
    await ScreenCaptureModule.stopCapture().catch(() => {});
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Preview</Text>
        <Text style={styles.fps}>{capturing ? `${fps} fps` : "off"}</Text>
      </View>
      <View style={styles.preview}>
        {frame ? (
          <Image source={{ uri: `data:image/jpeg;base64,${frame}` }} style={styles.image} resizeMode="contain" />
        ) : (
          <Text style={styles.placeholder}>
            {capturing ? "Waiting for frames…" : "Screen capture not active"}
          </Text>
        )}
      </View>
      <View style={styles.controls}>
        {!capturing ? (
          <TouchableOpacity style={styles.startBtn} onPress={onStart}>
            <Text style={styles.btnText}>▶ Start</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopBtn} onPress={onStop}>
            <Text style={styles.btnText}>⏹ Stop</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#0f172a", flex: 1, padding: 16 },
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  title: { color: "#f1f5f9", fontSize: 24, fontWeight: "700" },
  fps: { color: "#60a5fa", fontSize: 14 },
  preview: {
    flex: 1,
    backgroundColor: "#000",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 16,
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  placeholder: { color: "#475569" },
  controls: { alignItems: "center" },
  startBtn: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  stopBtn: {
    backgroundColor: "#dc2626",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
