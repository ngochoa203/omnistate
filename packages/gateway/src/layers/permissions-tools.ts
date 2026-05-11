/**
 * Permissions & Access Control Tools — Advanced Layer (API 77)
 * Implements: RBAC, permissions, access control lists, role management
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface Role {
  id: string;
  name: string;
  permissions: string[];
  description?: string;
}

export interface Permission {
  resource: string;
  actions: ("create" | "read" | "update" | "delete" | "*")[];
}

export interface ACL {
  userId: string;
  resource: string;
  permissions: Permission["actions"];
}

const roles = new Map<string, Role>();
const acls = new Map<string, ACL[]>();

export async function createRole(name: string, permissions: string[]): Promise<Role> {
  const role: Role = {
    id: `role_${Date.now()}`,
    name,
    permissions
  };
  roles.set(role.id, role);
  return role;
}

export async function assignRole(userId: string, roleId: string): Promise<boolean> {
  const role = roles.get(roleId);
  if (!role) return false;
  
  const userRoles = await getUserRoles(userId);
  if (!userRoles.find(r => r.id === roleId)) {
    userRoles.push(role);
  }
  
  const aclPath = path.join(process.cwd(), ".omnistate", "roles", `${userId}.json`);
  await fs.mkdir(path.dirname(aclPath), { recursive: true });
  await fs.writeFile(aclPath, JSON.stringify(userRoles.map(r => r.id)));
  
  return true;
}

export async function getUserRoles(userId: string): Promise<Role[]> {
  const aclPath = path.join(process.cwd(), ".omnistate", "roles", `${userId}.json`);
  try {
    const roleIds: string[] = JSON.parse(await fs.readFile(aclPath, "utf-8"));
    return roleIds.map(id => roles.get(id)).filter((r): r is Role => !!r);
  } catch {
    return [];
  }
}

export async function hasPermission(
  userId: string,
  resource: string,
  action: Permission["actions"][number]
): Promise<boolean> {
  const userRoles = await getUserRoles(userId);
  for (const role of userRoles) {
    for (const perm of role.permissions) {
      if (perm === "*" || perm === action) return true;
      if (perm.endsWith(`:${resource}`) && (perm.startsWith(action) || perm.startsWith("*"))) return true;
    }
  }
  return false;
}

export async function grantAccess(
  userId: string,
  resource: string,
  permissions: Permission["actions"]
): Promise<boolean> {
  if (!acls.has(userId)) acls.set(userId, []);
  acls.get(userId)!.push({ userId, resource, permissions });
  return true;
}

export async function revokeAccess(userId: string, resource: string): Promise<boolean> {
  const userAcls = acls.get(userId);
  if (!userAcls) return false;
  
  const idx = userAcls.findIndex(a => a.resource === resource);
  if (idx >= 0) {
    userAcls.splice(idx, 1);
    return true;
  }
  return false;
}

export async function listPermissions(userId: string): Promise<ACL[]> {
  return acls.get(userId) || [];
}

export class PermissionsLayer {
  createRole = createRole;
  assignRole = assignRole;
  getUserRoles = getUserRoles;
  hasPermission = hasPermission;
  grant = grantAccess;
  revoke = revokeAccess;
  list = listPermissions;
}
