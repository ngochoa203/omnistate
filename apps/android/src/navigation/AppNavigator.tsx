import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DashboardScreen } from "../screens/DashboardScreen";
import { ChatScreen } from "../screens/ChatScreen";
import { VoiceScreen } from "../screens/VoiceScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { TriggersScreen } from "../screens/TriggersScreen";
import { Text } from "react-native";

const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Dashboard: "📊",
    Chat: "💬",
    Voice: "🎤",
    Triggers: "⚡",
    Settings: "⚙️",
  };
  return (
    <Text style={{ fontSize: focused ? 24 : 20, opacity: focused ? 1 : 0.5 }}>
      {icons[name] ?? "•"}
    </Text>
  );
}

export function AppNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#1e293b",
          borderTopColor: "#334155",
          paddingBottom: 4,
          height: 60,
        },
        tabBarActiveTintColor: "#60a5fa",
        tabBarInactiveTintColor: "#64748b",
        tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Chat" component={ChatScreen} />
      <Tab.Screen name="Voice" component={VoiceScreen} />
      <Tab.Screen name="Triggers" component={TriggersScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
