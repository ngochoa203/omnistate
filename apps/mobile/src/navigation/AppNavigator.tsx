import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DashboardScreen } from "../screens/DashboardScreen";
import { ChatScreen } from "../screens/ChatScreen";
import { AutomationScreen } from "../screens/AutomationScreen";
import { MacroEditorScreen } from "../screens/MacroEditorScreen";
import { LivePreviewScreen } from "../screens/LivePreviewScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { Text } from "react-native";

const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Dashboard: "📊",
    Chat: "💬",
    Automation: "🤖",
    Macros: "📝",
    Preview: "📱",
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
      <Tab.Screen name="Automation" component={AutomationScreen} />
      <Tab.Screen name="Macros" component={MacroEditorScreen} />
      <Tab.Screen name="Preview" component={LivePreviewScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
