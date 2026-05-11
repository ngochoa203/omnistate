/**
 * API & Web Services Tools — Group 15
 * Implements: HTTP requests, API client, webhooks, REST endpoints
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as https from "node:https";
import * as http from "node:http";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// HTTP Request Types
// ------------------------------------------------------------------

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

export async function httpGet(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
  const start = Date.now();
  
  return new Promise((resolve) => {
    const protocol = url.startsWith("https") ? https : http;
    
    const options = {
      headers: headers || {}
    };
    
    const req = protocol.get(url, options, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers as Record<string, string>,
          body,
          duration: Date.now() - start
        });
      });
    });
    
    req.on("error", () => {
      resolve({ status: 0, headers: {}, body: "", duration: Date.now() - start });
    });
    
    req.setTimeout(30000, () => {
      req.destroy();
      resolve({ status: 0, headers: {}, body: "timeout", duration: Date.now() - start });
    });
  });
}

export async function httpPost(url: string, data: string | object, headers?: Record<string, string>): Promise<HttpResponse> {
  const start = Date.now();
  const body = typeof data === "string" ? data : JSON.stringify(data);
  
  return new Promise((resolve) => {
    const protocol = url.startsWith("https") ? https : http;
    const urlObj = new URL(url);
    
    const options = {
      method: "POST",
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers
      }
    };
    
    const req = protocol.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => responseBody += chunk);
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers as Record<string, string>,
          body: responseBody,
          duration: Date.now() - start
        });
      });
    });
    
    req.on("error", () => {
      resolve({ status: 0, headers: {}, body: "", duration: Date.now() - start });
    });
    
    req.write(body);
    req.end();
  });
}

export async function httpPut(url: string, data: string | object, headers?: Record<string, string>): Promise<HttpResponse> {
  const start = Date.now();
  const body = typeof data === "string" ? data : JSON.stringify(data);
  
  return new Promise((resolve) => {
    const protocol = url.startsWith("https") ? https : http;
    const urlObj = new URL(url);
    
    const options = {
      method: "PUT",
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers
      }
    };
    
    const req = protocol.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => responseBody += chunk);
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers as Record<string, string>,
          body: responseBody,
          duration: Date.now() - start
        });
      });
    });
    
    req.on("error", () => {
      resolve({ status: 0, headers: {}, body: "", duration: Date.now() - start });
    });
    
    req.write(body);
    req.end();
  });
}

export async function httpDelete(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
  const start = Date.now();
  
  return new Promise((resolve) => {
    const protocol = url.startsWith("https") ? https : http;
    const urlObj = new URL(url);
    
    const options = {
      method: "DELETE",
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      headers: headers || {}
    };
    
    const req = protocol.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers as Record<string, string>,
          body,
          duration: Date.now() - start
        });
      });
    });
    
    req.on("error", () => {
      resolve({ status: 0, headers: {}, body: "", duration: Date.now() - start });
    });
    
    req.end();
  });
}

// ------------------------------------------------------------------
// API Client
// ------------------------------------------------------------------

export class ApiClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  
  constructor(baseUrl: string, defaultHeaders?: Record<string, string>) {
    this.baseUrl = baseUrl;
    this.headers = defaultHeaders || {};
  }
  
  setHeader(key: string, value: string): void {
    this.headers[key] = value;
  }
  
  setAuth(token: string, type: "Bearer" | "Basic" | "ApiKey" = "Bearer", headerName: string = "Authorization"): void {
    if (type === "Bearer") {
      this.headers[headerName] = `Bearer ${token}`;
    } else if (type === "Basic") {
      this.headers[headerName] = `Basic ${token}`;
    } else {
      this.headers[headerName] = token;
    }
  }
  
  async get(endpoint: string): Promise<HttpResponse> {
    return httpGet(`${this.baseUrl}${endpoint}`, this.headers);
  }
  
  async post(endpoint: string, data: object): Promise<HttpResponse> {
    return httpPost(`${this.baseUrl}${endpoint}`, data, this.headers);
  }
  
  async put(endpoint: string, data: object): Promise<HttpResponse> {
    return httpPut(`${this.baseUrl}${endpoint}`, data, this.headers);
  }
  
  async delete(endpoint: string): Promise<HttpResponse> {
    return httpDelete(`${this.baseUrl}${endpoint}`, this.headers);
  }
}

// ------------------------------------------------------------------
// Webhook Handler
// ------------------------------------------------------------------

export interface WebhookConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  secret?: string;
}

export async function sendWebhook(config: WebhookConfig, payload?: object): Promise<boolean> {
  try {
    const body = payload ? JSON.stringify(payload) : "";
    
    if (config.method === "GET") {
      const res = await httpGet(config.url, config.headers);
      return res.status >= 200 && res.status < 300;
    } else if (config.method === "POST" || config.method === "PUT" || config.method === "PATCH") {
      const res = await httpPost(config.url, body, {
        "Content-Type": "application/json",
        ...config.headers
      });
      return res.status >= 200 && res.status < 300;
    }
    
    return false;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// curl Wrapper
// ------------------------------------------------------------------

export async function curlRequest(
  url: string,
  method: string = "GET",
  headers?: Record<string, string>,
  data?: string
): Promise<{ status: number; body: string }> {
  try {
    let cmd = `curl -s -w "\\n%{http_code}" -X ${method} "${url}"`;
    
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        cmd += ` -H "${key}: ${value}"`;
      }
    }
    
    if (data) {
      cmd += ` -d '${data.replace(/'/g, "'\\''")}'`;
    }
    
    const { stdout } = await execAsync(cmd, { encoding: "utf-8" });
    const lines = stdout.trim().split("\n");
    const status = parseInt(lines.pop() || "0", 10);
    const body = lines.join("\n");
    
    return { status, body };
  } catch {
    return { status: 0, body: "" };
  }
}

// ------------------------------------------------------------------
// Weather API
// ------------------------------------------------------------------

export async function getWeather(location: string): Promise<any> {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      return { error: "API key not configured" };
    }
    
    const encoded = encodeURIComponent(location);
    const res = await httpGet(
      `https://api.openweathermap.org/data/2.5/weather?q=${encoded}&appid=${apiKey}&units=metric`
    );
    
    return JSON.parse(res.body);
  } catch {
    return { error: "Failed to fetch weather" };
  }
}

// ------------------------------------------------------------------
// Currency Exchange
// ------------------------------------------------------------------

export async function getExchangeRate(from: string, to: string): Promise<number> {
  try {
    const res = await httpGet(`https://api.exchangerate-api.com/v4/latest/${from}`);
    const data = JSON.parse(res.body);
    return data.rates?.[to] || 0;
  } catch {
    return 0;
  }
}

export class ApiWebLayer {
  get = httpGet;
  post = httpPost;
  put = httpPut;
  delete = httpDelete;
  ApiClient = ApiClient;
  webhook = sendWebhook;
  curl = curlRequest;
  weather = getWeather;
  exchangeRate = getExchangeRate;
}
