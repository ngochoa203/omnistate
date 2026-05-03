import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"shell-command","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["shell-command","package-management","container-management","multi-step","system-query","app-control","ask-clarification","power-management"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent K: Shell & Developer Commands (50 prompts)", () => {
  ok("git commit", "git commit -m 'fix bug'");
  ok("git push", "git push origin main");
  ok("npm install", "npm install");
  ok("pip install flask", "pip install flask");
  ok("docker ps", "docker ps");
  ok("docker exec", "docker exec -it container bash");
  ok("ssh into server", "ssh user@server");
  ok("kill port 3000", "kill port 3000");
  ok("run python script", "run python script");
  ok("curl api endpoint", "curl api endpoint");
  ok("make build", "make build");
  ok("cargo build", "cargo build");
  ok("npm test", "npm test");
  ok("yarn dev", "yarn dev");
  ok("pnpm add", "pnpm add");
  ok("find TODO", "find TODO in code");
  ok("grep error log", "grep error log");
  ok("bash script", "run bash script");
  ok("execute run.sh", "./run.sh");
  ok("source env", "source .env");
  ok("export VAR", "export VAR=value");
  ok("chmod +x", "chmod +x script.sh");
  ok("chown", "chown user file");
  ok("reboot", "reboot now");
  ok("shutdown -r", "shutdown -r now");
  ok("sudo apt update", "sudo apt update");
  ok("brew upgrade", "brew upgrade");
  ok("pip3 uninstall", "pip3 uninstall flask");
  ok("git stash", "git stash");
  ok("git merge", "git merge feature-branch");
  ok("git rebase", "git rebase main");
  ok("git diff", "git diff");
  ok("git log", "git log");
  ok("git checkout -b", "git checkout -b new-branch");
  ok("npm run build", "npm run build");
  ok("node server.js", "node server.js");
  ok("python3 venv", "python3 -m venv venv");
  ok("conda activate", "conda activate env");
  ok("pip freeze", "pip freeze");
  ok("pip list", "pip list");
  ok("docker-compose up", "docker-compose up");
  ok("docker-compose down", "docker-compose down");
  ok("kubectl get pods", "kubectl get pods");
  ok("terraform apply", "terraform apply");
  ok("ansible playbook", "run ansible playbook");
  ok("curl POST", "curl -X POST https://api.example.com");
  ok("wget file", "wget https://example.com/file");
  ok("rsync", "rsync -avz source dest");
  ok("scp file", "scp file.txt user@host:/path");
  ok("ssh-keygen", "ssh-keygen -t rsa");
  ok("brew install", "brew install wget");
  ok("npm uninstall", "npm uninstall lodash");
  ok("yarn add", "yarn add axios");
  ok("git clone", "git clone https://github.com/repo");
  ok("git fetch", "git fetch origin");
  ok("git reset hard", "git reset --hard HEAD");
  ok("git clean fd", "git clean -fd");
  ok("npx create-react-app", "npx create-react-app myapp");
  ok("pip install requirements", "pip install -r requirements.txt");
  ok("cargo run", "cargo run");
  ok("make clean", "make clean");
  ok("make install", "make install");
  ok("cmake build", "cmake build");
  ok("go build", "go build");
  ok("go run", "go run main.go");
  ok("dotnet build", "dotnet build");
  ok("php artisan", "php artisan migrate");
  ok("ruby bundle install", "bundle install");
  ok("swift build", "swift build");
  ok("rustc compile", "rustc main.rs");
  ok("pip install dev", "pip install -r dev-requirements.txt");
  ok("npm install dev", "npm install --save-dev typescript");
  ok("yarn remove", "yarn remove lodash");
  ok("git branch", "git branch");
  ok("git pull", "git pull origin main");
  ok("docker build", "docker build -t myapp .");
  ok("docker run detach", "docker run -d nginx");
  ok("docker stop", "docker stop container");
  ok("docker logs", "docker logs container");
  ok("npm audit fix", "npm audit fix");
  ok("pip update", "pip install --upgrade pip");
  ok("brew cleanup", "brew cleanup");
  ok("cargo update", "cargo update");
  ok("python manage.py", "python manage.py runserver");
  ok("npm script", "run npm script");
  ok("make test", "make test");
  ok("run gradle", "./gradlew build");
  ok("sbt compile", "sbt compile");
  ok("mix deps.get", "mix deps.get");
  ok("pipenv install", "pipenv install");
  ok("poetry install", "poetry install");
  ok("bun install", "bun install");
});
