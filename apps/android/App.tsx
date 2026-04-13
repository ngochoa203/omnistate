import React, { useEffect, useState } from "react";
import { StatusBar, View, StyleSheet } from "react-native";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { ConnectScreen } from "./src/screens/ConnectScreen";
import { useConnectionStore } from "./src/stores/connection-store";

const omnistateTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: "#60a5fa",
    background: "#0f172a",
    card: "#1e293b",
    text: "#f1f5f9",
    border: "#334155",
    notification: "#f59e0b",
  },
};

export function App(): React.JSX.Element {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const gatewayUrl = useConnectionStore((s) => s.gatewayUrl);

  return (
    <NavigationContainer theme={omnistateTheme}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      {gatewayUrl && isConnected ? (
        <AppNavigator />
      ) : (
        <ConnectScreen />
      )}
    </NavigationContainer>
  );
}
