/**
 * GCP & Azure Advanced Tools — Cloud Functions, Azure VMs, Storage.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// GCP
const gcloud = (cmd: string) => execAsync(`gcloud ${cmd}`, { encoding: "utf-8" });

export async function gcpListFunctions(project: string): Promise<{ name: string; runtime: string; status: string }[]> { try { const { stdout } = await gcloud(`functions list --project ${project} --format json`); const data = JSON.parse(stdout); return data.map((f: any) => ({ name: f.name.split("/").pop(), runtime: f.runtime, status: f.status })); } catch { return []; } }
export async function gcpDeployFunction(name: string, runtime: string, trigger: string, project: string): Promise<boolean> { try { await gcloud(`functions deploy ${name} --runtime ${runtime} --trigger-${trigger} --project ${project}`); return true; } catch { return false; } }
export async function gcpListBuckets(project: string): Promise<{ name: string; location: string }[]> { try { const { stdout } = await gcloud(`storage buckets list --project ${project} --format json`); const data = JSON.parse(stdout); return data.map((b: any) => ({ name: b.name, location: b.location })); } catch { return []; } }
export async function gcpUploadFile(bucket: string, source: string, dest: string): Promise<boolean> { try { await gcloud(`storage cp "${source}" gs://${bucket}/${dest}`); return true; } catch { return false; } }
export async function gcpListDatasets(project: string): Promise<string[]> { try { const { stdout } = await gcloud(`bigquery datasets list --project ${project} --format json`); const data = JSON.parse(stdout); return data.map((d: any) => d.datasetReference.datasetId); } catch { return []; } }

// Azure
const az = (cmd: string) => execAsync(`az ${cmd}`, { encoding: "utf-8" });

export async function azureListVMs(resourceGroup: string): Promise<{ name: string; size: string; state: string }[]> { try { const { stdout } = await az(`vm list --resource-group ${resourceGroup} --output json`); const data = JSON.parse(stdout); return data.map((v: any) => ({ name: v.name, size: v.hardwareProfile.vmSize, state: v.instanceView?.statuses?.[0]?.displayStatus || "Unknown" })); } catch { return []; } }
export async function azureStartVM(name: string, resourceGroup: string): Promise<boolean> { try { await az(`vm start --name ${name} --resource-group ${resourceGroup}`); return true; } catch { return false; } }
export async function azureStopVM(name: string, resourceGroup: string): Promise<boolean> { try { await az(`vm stop --name ${name} --resource-group ${resourceGroup}`); return true; } catch { return false; } }
export async function azureListStorageAccounts(subscription: string): Promise<string[]> { try { const { stdout } = await az(`storage account list --subscription ${subscription} --output json`); const data = JSON.parse(stdout); return data.map((a: any) => a.name); } catch { return []; } }
export async function azureListFunctions(resourceGroup: string, app: string): Promise<string[]> { try { const { stdout } = await az(`functionapp function list --resource-group ${resourceGroup} --name ${app} --output json`); const data = JSON.parse(stdout); return data.map((f: any) => f.name); } catch { return []; } }
export async function azureInvokeFunction(resourceGroup: string, app: string, functionName: string): Promise<boolean> { try { await az(`functionapp function invoke --resource-group ${resourceGroup} --name ${app} --function-name ${functionName}`); return true; } catch { return false; } }

export class GCPAzureAdvancedLayer { gcpListFunctions = gcpListFunctions; gcpDeployFunction = gcpDeployFunction; gcpListBuckets = gcpListBuckets; gcpUploadFile = gcpUploadFile; gcpListDatasets = gcpListDatasets; azureListVMs = azureListVMs; azureStartVM = azureStartVM; azureStopVM = azureStopVM; azureListStorageAccounts = azureListStorageAccounts; azureListFunctions = azureListFunctions; azureInvokeFunction = azureInvokeFunction; }
