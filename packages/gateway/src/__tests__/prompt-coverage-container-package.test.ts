import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"container-management","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["container-management","package-management","shell-command","app-control","system-query","update-management","app-launch","ask-clarification"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent O: Container & Package Management (50 prompts)", () => {
  ok("docker ps", "docker ps");
  ok("docker images", "docker images");
  ok("docker run -it", "docker run -it ubuntu bash");
  ok("docker exec -it", "docker exec -it container bash");
  ok("docker-compose up", "docker-compose up");
  ok("docker-compose down", "docker-compose down");
  ok("docker-compose build", "docker-compose build");
  ok("docker-compose logs", "docker-compose logs");
  ok("docker-compose ps", "docker-compose ps");
  ok("docker rm container", "docker rm container");
  ok("docker rmi image", "docker rmi image");
  ok("docker pull nginx", "docker pull nginx");
  ok("docker push image", "docker push image");
  ok("docker build -t", "docker build -t myapp .");
  ok("docker tag image", "docker tag image myapp:latest");
  ok("docker login", "docker login");
  ok("docker logout", "docker logout");
  ok("docker network ls", "docker network ls");
  ok("docker volume ls", "docker volume ls");
  ok("docker stats", "docker stats");
  ok("docker system df", "docker system df");
  ok("docker system prune", "docker system prune");
  ok("docker stop all", "docker stop all");
  ok("docker kill", "docker kill");
  ok("kubectl get pods", "kubectl get pods");
  ok("kubectl get nodes", "kubectl get nodes");
  ok("kubectl describe pod", "kubectl describe pod");
  ok("kubectl logs", "kubectl logs pod");
  ok("kubectl exec", "kubectl exec -it pod bash");
  ok("kubectl apply -f", "kubectl apply -f deployment.yml");
  ok("kubectl delete", "kubectl delete pod");
  ok("kubectl port-forward", "kubectl port-forward");
  ok("helm install", "helm install");
  ok("helm list", "helm list");
  ok("helm uninstall", "helm uninstall");
  ok("docker-compose stack", "docker-compose -f stack.yml up");
  ok("portainer start", "open portainer");
  ok("podman ps", "podman ps");
  ok("podman run", "podman run");
  ok("podman images", "podman images");
  ok("singularity exec", "singularity exec");
  ok("brew install wget", "brew install wget");
  ok("brew uninstall wget", "brew uninstall wget");
  ok("brew update", "brew update");
  ok("brew upgrade", "brew upgrade");
  ok("brew list", "brew list");
  ok("brew info", "brew info wget");
  ok("pip install flask", "pip install flask");
  ok("pip install requirements", "pip install -r requirements.txt");
  ok("pip uninstall flask", "pip uninstall flask");
  ok("pip list", "pip list");
  ok("pip freeze", "pip freeze");
  ok("conda install", "conda install numpy");
  ok("conda update", "conda update");
  ok("conda list", "conda list");
  ok("npx create-next-app", "npx create-next-app");
  ok("npm install dev", "npm install --save-dev typescript");
  ok("yarn add", "yarn add axios");
  ok("yarn remove", "yarn remove lodash");
  ok("pnpm install", "pnpm install");
  ok("composer require", "composer require");
  ok("gem install rails", "gem install rails");
  ok("cargo install ripgrep", "cargo install ripgrep");
  ok("go install", "go install");
  ok("apt install", "apt install nginx");
  ok("apt remove", "apt remove nginx");
  ok("apt-get update", "apt-get update");
  ok("snap install", "snap install");
  ok("flatpak install", "flatpak install");
  ok("choco install", "choco install");
  ok("winget install", "winget install");
  ok("docker-compose restart", "docker-compose restart");
  ok("docker restart container", "restart docker container");
  ok("docker pause", "docker pause");
  ok("docker unpause", "docker unpause");
  ok("docker inspect", "docker inspect container");
  ok("docker top", "docker top container");
  ok("docker logs tail", "docker logs --tail 100");
  ok("docker diff", "docker diff container");
  ok("docker commit", "docker commit container");
  ok("docker save", "docker save image");
  ok("docker load", "docker load");
  ok("docker import", "docker import");
  ok("docker export", "docker export");
  ok("docker cp", "docker cp file.txt container:/path");
  ok("kubectl scale", "kubectl scale deployment");
  ok("kubectl rollout", "kubectl rollout restart deployment");
  ok("kubectl top", "kubectl top pod");
  ok("helm repo update", "helm repo update");
  ok("helm search", "helm search");
  ok("kubectl config use-context", "kubectl config use-context");
  ok("kubectl get services", "kubectl get services");
  ok("kubectl get deployments", "kubectl get deployments");
  ok("kubectl get events", "kubectl get events");
  ok("kubectl get secret", "kubectl get secret");
  ok("kubectl get configmap", "kubectl get configmap");
  ok("kubectl label", "kubectl label");
  ok("kubectl annotate", "kubectl annotate");
});
