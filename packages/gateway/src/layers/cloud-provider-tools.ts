/**
 * Cloud Provider Tools — Group 40
 * Implements: AWS, GCP, Azure operations via CLI
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// AWS Operations
// ------------------------------------------------------------------

export async function awsGetIdentity(): Promise<{ account: string; user: string; arn: string } | null> {
  try {
    const { stdout } = await execAsync("aws sts get-caller-identity --query '{account:Account,user:Arn}' --output json 2>/dev/null || echo '{}'", { encoding: "utf-8" });
    return JSON.parse(stdout || "{}");
  } catch {
    return null;
  }
}

export async function awsListS3Buckets(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("aws s3 ls --output text 2>/dev/null || echo ''", { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(b => b.trim());
  } catch {
    return [];
  }
}

export async function awsS3Sync(source: string, dest: string, deleteFiles: boolean = false): Promise<boolean> {
  try {
    const flag = deleteFiles ? "--delete" : "";
    await execAsync(`aws s3 sync ${source} ${dest} ${flag}`);
    return true;
  } catch {
    return false;
  }
}

export async function awsListEC2(): Promise<{ instanceId: string; state: string; type: string; az: string }[]> {
  try {
    const { stdout } = await execAsync("aws ec2 describe-instances --query 'Reservations[].Instances[].[InstanceId,State.Name,InstanceType,Placement.AvailabilityZone]' --output text 2>/dev/null || echo ''", { encoding: "utf-8" });
    
    const lines = stdout.trim().split("\n");
    const instances: { instanceId: string; state: string; type: string; az: string }[] = [];
    for (let i = 0; i < lines.length; i += 4) {
      instances.push({
        instanceId: lines[i] || "",
        state: lines[i + 1] || "",
        type: lines[i + 2] || "",
        az: lines[i + 3] || ""
      });
    }
    return instances;
  } catch {
    return [];
  }
}

export async function awsListLambdaFunctions(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("aws lambda list-functions --query 'Functions[].FunctionName' --output text 2>/dev/null || echo ''", { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(f => f.trim());
  } catch {
    return [];
  }
}

export async function awsGetECRImages(repoName: string): Promise<{ tag: string; size: string; pushed: string }[]> {
  try {
    const { stdout } = await execAsync(`aws ecr describe-images --repository-name ${repoName} --query 'imageDetails[].{tag:join(\",\",imageTags),size:ImageSizeInBytes,pushed:PushedAt}' --output json 2>/dev/null || echo '[]'`, { encoding: "utf-8" });
    return JSON.parse(stdout || "[]");
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// GCP Operations
// ------------------------------------------------------------------

export async function gcpGetProject(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("gcloud config get-value project 2>/dev/null || echo ''", { encoding: "utf-8" });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function gcpListComputeInstances(): Promise<{ name: string; zone: string; status: string }[]> {
  try {
    const { stdout } = await execAsync("gcloud compute instances list --format='table(name,zone,status)' 2>/dev/null || echo ''", { encoding: "utf-8" });
    
    return stdout.trim().split("\n").slice(1).filter(l => l.trim()).map(line => {
      const parts = line.trim().split(/\s+/);
      return { name: parts[0] || "", zone: parts[1] || "", status: parts[2] || "" };
    });
  } catch {
    return [];
  }
}

export async function gcpListBuckets(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("gsutil ls 2>/dev/null || echo ''", { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(b => b.trim());
  } catch {
    return [];
  }
}

export async function gcpSyncBucket(source: string, dest: string): Promise<boolean> {
  try {
    await execAsync(`gsutil rsync -r ${source} ${dest}`);
    return true;
  } catch {
    return false;
  }
}

export async function gcpListCloudFunctions(): Promise<{ name: string; runtime: string; status: string }[]> {
  try {
    const { stdout } = await execAsync("gcloud functions list --format='table(name,runtime,status)' 2>/dev/null || echo ''", { encoding: "utf-8" });
    
    return stdout.trim().split("\n").slice(1).filter(l => l.trim()).map(line => {
      const parts = line.trim().split(/\s+/);
      return { name: parts[0] || "", runtime: parts[1] || "", status: parts[2] || "" };
    });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Azure Operations
// ------------------------------------------------------------------

export async function azureListVMs(): Promise<{ name: string; resourceGroup: string; status: string }[]> {
  try {
    const { stdout } = await execAsync("az vm list --query '[].{name:name,resourceGroup:resourceGroup,status:powerState}' --output table 2>/dev/null || echo ''", { encoding: "utf-8" });
    
    return stdout.trim().split("\n").slice(2).filter(l => l.trim()).map(line => {
      const parts = line.trim().split(/\s+/);
      return { name: parts[0] || "", resourceGroup: parts[1] || "", status: parts[2] || "" };
    });
  } catch {
    return [];
  }
}

export async function azureListStorageAccounts(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("az storage account list --query '[].name' --output tsv 2>/dev/null || echo ''", { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(a => a.trim());
  } catch {
    return [];
  }
}

export async function azureListWebApps(): Promise<{ name: string; resourceGroup: string; state: string }[]> {
  try {
    const { stdout } = await execAsync("az webapp list --query '[].{name:name,resourceGroup:resourceGroup,state:state}' --output json 2>/dev/null || echo '[]'", { encoding: "utf-8" });
    return JSON.parse(stdout || "[]");
  } catch {
    return [];
  }
}

export async function azureStartVM(name: string, resourceGroup?: string): Promise<boolean> {
  try {
    const rg = resourceGroup || "default";
    await execAsync(`az vm start --name ${name} --resource-group ${rg}`);
    return true;
  } catch {
    return false;
  }
}

export async function azureStopVM(name: string, resourceGroup?: string): Promise<boolean> {
  try {
    const rg = resourceGroup || "default";
    await execAsync(`az vm deallocate --name ${name} --resource-group ${rg}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Multi-Cloud Status
// ------------------------------------------------------------------

export async function getCloudStatus(): Promise<{ aws: boolean; gcp: boolean; azure: boolean }> {
  const [aws, gcp, azure] = await Promise.all([
    awsGetIdentity().then(r => r !== null),
    gcpGetProject().then(p => p !== null),
    execAsync("az account show 2>/dev/null").then(() => true).catch(() => false)
  ]);
  
  return { aws, gcp, azure };
}

export class CloudProviderLayer {
  // AWS
  awsIdentity = awsGetIdentity;
  awsS3Buckets = awsListS3Buckets;
  awsS3Sync = awsS3Sync;
  awsEC2 = awsListEC2;
  awsLambda = awsListLambdaFunctions;
  awsECR = awsGetECRImages;
  
  // GCP
  gcpProject = gcpGetProject;
  gcpCompute = gcpListComputeInstances;
  gcpBuckets = gcpListBuckets;
  gcpSync = gcpSyncBucket;
  gcpFunctions = gcpListCloudFunctions;
  
  // Azure
  azureVMs = azureListVMs;
  azureStorage = azureListStorageAccounts;
  azureWebApps = azureListWebApps;
  azureStartVM = azureStartVM;
  azureStopVM = azureStopVM;
  
  // Generic
  getCloudStatus = getCloudStatus;
}
