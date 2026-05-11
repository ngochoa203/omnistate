/**
 * User Management Tools — Advanced Layer (API 76)
 * Implements: User CRUD, profiles, preferences, user analytics
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";


export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user" | "guest";
  status: "active" | "inactive" | "suspended";
  createdAt: Date;
  lastLogin?: Date;
  preferences?: Record<string, any>;
  profile?: Record<string, any>;
}

const users = new Map<string, User>();

export async function createUser(data: {
  email: string;
  name: string;
  role?: User["role"];
}): Promise<User> {
  const user: User = {
    id: `usr_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    email: data.email,
    name: data.name,
    role: data.role || "user",
    status: "active",
    createdAt: new Date()
  };
  
  users.set(user.id, user);
  
  const userPath = path.join(process.cwd(), ".omnistate", "users", `${user.id}.json`);
  await fs.mkdir(path.dirname(userPath), { recursive: true });
  await fs.writeFile(userPath, JSON.stringify(user));
  
  return user;
}

export async function getUser(userId: string): Promise<User | null> {
  return users.get(userId) || null;
}

export async function updateUser(
  userId: string,
  updates: Partial<Pick<User, "name" | "preferences" | "profile">>
): Promise<User | null> {
  const user = users.get(userId);
  if (!user) return null;
  
  Object.assign(user, updates);
  return user;
}

export async function deleteUser(userId: string): Promise<boolean> {
  return users.delete(userId);
}

export async function listUsers(
  filters?: { role?: User["role"]; status?: User["status"] }
): Promise<User[]> {
  let result = Array.from(users.values());
  if (filters?.role) result = result.filter(u => u.role === filters.role);
  if (filters?.status) result = result.filter(u => u.status === filters.status);
  return result;
}

export async function setUserPreferences(
  userId: string,
  preferences: Record<string, any>
): Promise<boolean> {
  const user = users.get(userId);
  if (!user) return false;
  user.preferences = { ...user.preferences, ...preferences };
  return true;
}

export async function getUserPreferences(userId: string): Promise<Record<string, any> | null> {
  return users.get(userId)?.preferences || null;
}

export async function recordUserLogin(userId: string): Promise<Date> {
  const user = users.get(userId);
  if (!user) throw new Error("User not found");
  user.lastLogin = new Date();
  return user.lastLogin;
}

export async function suspendUser(userId: string, reason?: string): Promise<boolean> {
  const user = users.get(userId);
  if (!user) return false;
  user.status = "suspended";
  return true;
}

export async function activateUser(userId: string): Promise<boolean> {
  const user = users.get(userId);
  if (!user) return false;
  user.status = "active";
  return true;
}

export class UserManagementLayer {
  create = createUser;
  get = getUser;
  update = updateUser;
  delete = deleteUser;
  list = listUsers;
  setPreferences = setUserPreferences;
  getPreferences = getUserPreferences;
  recordLogin = recordUserLogin;
  suspend = suspendUser;
  activate = activateUser;
}
