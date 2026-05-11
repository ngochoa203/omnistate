/**
 * AWS Advanced Tools — Lambda, S3, CloudWatch, EC2, IAM.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const aws = (cmd: string) => execAsync(`aws ${cmd}`, { encoding: "utf-8" });

export async function listLambdas(): Promise<{ name: string; runtime: string; memory: number }[]> { try { const { stdout } = await aws("lambda list-functions --output json"); const data = JSON.parse(stdout); return data.Functions.map((f: any) => ({ name: f.FunctionName, runtime: f.Runtime, memory: f.MemorySize })); } catch { return []; } }
export async function invokeLambda(name: string, payload?: object): Promise<{ success: boolean; output?: string }> { try { const p = payload ? JSON.stringify(payload) : "{}"; const { stdout } = await aws(`lambda invoke --function-name ${name} --payload '${p}' /dev/stdout`); return { success: true, output: stdout }; } catch { return { success: false }; } }

export async function listS3Buckets(): Promise<{ name: string; creationDate: string }[]> { try { const { stdout } = await aws("s3api list-buckets --output json"); const data = JSON.parse(stdout); return data.Buckets.map((b: any) => ({ name: b.Name, creationDate: b.CreationDate })); } catch { return []; } }
export async function syncS3Folders(source: string, dest: string, deleteRemoved = false): Promise<boolean> { try { await aws(`s3 sync "${source}" "${dest}" ${deleteRemoved ? "--delete" : ""}`); return true; } catch { return false; } }
export async function enableS3Versioning(bucket: string): Promise<boolean> { try { await aws(`s3api put-bucket-versioning --bucket ${bucket} --versioning-configuration Status=Enabled`); return true; } catch { return false; } }
export async function getS3ObjectUrl(bucket: string, key: string, expiresSeconds = 3600): Promise<string> { try { const { stdout } = await aws(`s3 presign "s3://${bucket}/${key}" --expires-in ${expiresSeconds}`); return stdout.trim(); } catch { return ""; } }

export async function listCWAlarms(): Promise<{ name: string; state: string; metric: string }[]> { try { const { stdout } = await aws("cloudwatch describe-alarms --output json"); const data = JSON.parse(stdout); return data.MetricAlarms.map((a: any) => ({ name: a.AlarmName, state: a.StateValue, metric: a.MetricName })); } catch { return []; } }
export async function createCWAlarm(name: string, metric: string, threshold: number): Promise<boolean> { try { await aws(`cloudwatch put-metric-alarm --alarm-name ${name} --metric-name ${metric} --threshold ${threshold} --period 60 --evaluation-periods 1 --statistic Average`); return true; } catch { return false; } }

export async function listEC2Instances(filters?: { state?: string }): Promise<{ id: string; type: string; state: string; publicIp?: string }[]> { try { const { stdout } = await aws("ec2 describe-instances --output json"); const data = JSON.parse(stdout); return data.Reservations.flatMap((r: any) => r.Instances.map((i: any) => ({ id: i.InstanceId, type: i.InstanceType, state: i.State.Name, publicIp: i.PublicIpAddress }))); } catch { return []; } }
export async function startEC2Instance(instanceId: string): Promise<boolean> { try { await aws(`ec2 start-instances --instance-ids ${instanceId}`); return true; } catch { return false; } }
export async function stopEC2Instance(instanceId: string): Promise<boolean> { try { await aws(`ec2 stop-instances --instance-ids ${instanceId}`); return true; } catch { return false; } }

export async function listIAMUsers(): Promise<{ name: string; created: string }[]> { try { const { stdout } = await aws("iam list-users --output json"); const data = JSON.parse(stdout); return data.Users.map((u: any) => ({ name: u.UserName, created: u.CreateDate })); } catch { return []; } }
export async function createIAMRole(name: string, policyDocument: object): Promise<boolean> { try { await aws(`iam create-role --role-name ${name} --assume-role-policy-document '${JSON.stringify(policyDocument)}'`); return true; } catch { return false; } }
export async function attachIAMPolicy(roleName: string, policyArn: string): Promise<boolean> { try { await aws(`iam attach-role-policy --role-name ${roleName} --policy-arn ${policyArn}`); return true; } catch { return false; } }

export class AWSAdvancedLayer { listLambdas = listLambdas; invokeLambda = invokeLambda; listS3Buckets = listS3Buckets; syncS3Folders = syncS3Folders; enableS3Versioning = enableS3Versioning; getS3ObjectUrl = getS3ObjectUrl; listCWAlarms = listCWAlarms; createCWAlarm = createCWAlarm; listEC2Instances = listEC2Instances; startEC2Instance = startEC2Instance; stopEC2Instance = stopEC2Instance; listIAMUsers = listIAMUsers; createIAMRole = createIAMRole; attachIAMPolicy = attachIAMPolicy; }
