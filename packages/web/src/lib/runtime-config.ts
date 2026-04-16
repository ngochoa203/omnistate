type ViteEnv = {
  VITE_GATEWAY_WS_URL?: string;
  VITE_GATEWAY_URL?: string;
};

type OmniWindow = Window & {
  OMNISTATE_GATEWAY_URL?: string;
};

function trimConfiguredUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveGatewayWsUrl(): string {
  if (typeof window !== "undefined") {
    const injected = trimConfiguredUrl((window as OmniWindow).OMNISTATE_GATEWAY_URL);
    if (injected) return injected;
  }

  const env = (import.meta as unknown as { env?: ViteEnv }).env;
  const fromEnv = trimConfiguredUrl(env?.VITE_GATEWAY_WS_URL) ?? trimConfiguredUrl(env?.VITE_GATEWAY_URL);
  if (fromEnv) return fromEnv;

  if (typeof window !== "undefined") {
    const { protocol, host } = window.location;
    if (host) {
      const scheme = protocol === "https:" ? "wss" : "ws";
      return `${scheme}://${host}/ws`;
    }
  }

  throw new Error("Gateway URL is not configured. Set VITE_GATEWAY_WS_URL (or VITE_GATEWAY_URL).");
}

export function resolveGatewayHttpBaseUrl(): string {
  const wsUrl = resolveGatewayWsUrl();
  const httpUrl = wsUrl.replace(/^ws/i, "http");
  return httpUrl.replace(/\/ws\/?$/, "");
}
