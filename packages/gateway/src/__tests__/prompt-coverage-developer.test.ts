import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";
vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"shell-command","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));
const VALID = ["shell-command","git.status","docker.ps","git.push","git.pull","git.commit","container.list","dev.runCommand","dev.gitStatus","app-launch","app-control","multi-step","dev.openTerminal","ask-clarification","package-management","package.install","package.upgrade"];
function ok(t: string, p: string) { return it(t, async () => { const intent = await classifyIntent(p); expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type); }); }
describe("Agent I: Developer Tools (50 prompts)", () => {
  ok("git status","git status"); ok("git commit -m 'fix'","git commit -m 'fix'"); ok("git push","git push"); ok("git pull","git pull");
  ok("git branch","git branch"); ok("checkout main","checkout main"); ok("create branch feature-x","create branch feature-x"); ok("merge branch","merge branch");
  ok("docker ps","docker ps"); ok("docker start nginx","docker start nginx"); ok("docker stop app","docker stop app"); ok("docker logs","docker logs");
  ok("docker-compose up","docker-compose up"); ok("docker-compose down","docker-compose down"); ok("docker images","docker images"); ok("container list","container list");
  ok("npm install","npm install"); ok("npm run dev","npm run dev"); ok("npm test","npm test"); ok("yarn install","yarn install"); ok("pnpm install","pnpm install");
  ok("pip install flask","pip install flask"); ok("pip freeze","pip freeze"); ok("brew install wget","brew install wget"); ok("chạy script build.sh","chạy script build.sh");
  ok("run build script","run build script"); ok("compile typescript","compile typescript"); ok("tsc --build","tsc --build"); ok("cargo build","cargo build");
  ok("cargo run","cargo run"); ok("kubectl get pods","kubectl get pods"); ok("kubectl apply -f config.yaml","kubectl apply -f config.yaml"); ok("terraform plan","terraform plan"),
  ok("terraform apply","terraform apply"); ok("open in VSCode","open in VSCode"); ok("mở project trong VSCode","mở project trong VSCode"); ok("search in project","search in project");
  ok("tìm trong project","tìm trong project"); ok("get project structure","get project structure"); ok("open terminal","open terminal"); ok("chạy lệnh ls","chạy lệnh ls");
  ok("run command ls -la","run command ls -la"); ok("execute shell script","execute shell script"); ok("tạo project mới với vite","tạo project mới với vite");
  ok("npm outdated","npm outdated"); ok("npm update","npm update"); ok("git stash","git stash"); ok("git log --oneline","git log --oneline"); ok("git diff main","git diff main");
  ok("docker restart container","docker restart container"); ok("docker-compose build","docker-compose build");
});
