# OmniState Tool Layers — Complete Reference (v3)

## Overview

**50 tool layers with 600+ tools** organized across functional categories.

## Quick Start

```typescript
import * as layers from "./layers/index.js";

// System
await layers.darkModeToggle();
await layers.setVolumePercent(80);
await layers.lockScreen();

// Docker
await layers.listContainers();
await layers.runNginx(8080);

// Kubernetes
await layers.listPods("default");
await layers.getClusterInfo();

// CI/CD
await layers.listWorkflows();
await layers.runWorkflow("deploy.yml");

// Cloud
await layers.awsListS3Buckets();
await layers.gcpListComputeInstances();
await layers.azureListVMs();

// Auth
const token = layers.createJWT({ sub: "user123" }, "secret");
const verified = layers.verifyJWT(token, "secret");
```

## Tool Categories (50 Layers)

### Core System (6 layers)
- os-hardware-tools, app-management, browser, file, dev, chaining

### Productivity (6 layers)
- smart-home, workspace, notification, screenshot, text, calendar

### Media & System (6 layers)
- media-player, system-monitor, quick-actions, communication, window-display, security-privacy

### Development (6 layers)
- terminal, automation, backup-sync, database, git, api-web

### Specialized (6 layers)
- image-media, clipboard, finder-spotlight, process-performance, network-connectivity, datetime-scheduling

### System & AI (2 layers)
- system-preferences, ai-llm

### DevOps & Cloud (6 layers)
- docker-container, kubernetes, cicd-pipeline, cloud-provider, api-docs, testing-qa

### Infrastructure (6 layers)
- logging-monitoring, secrets-config, code-quality, deployment-server, notification-channels, virtualization-vm

### Security & Identity (2 layers)
- ssh-remote, auth-identity

## All Layer Files

| Layer | Tools | Description |
|-------|-------|-------------|
| os-hardware-tools | 12 | Dark mode, volume, WiFi, battery, DND, mic, lock, brightness |
| app-management | 12 | Open/close apps, minimize, Apple Notes, Spotify, Calendar, Mail |
| browser-tools | 12 | Safari/Chrome automation, Google, YouTube, Maps |
| file-tools | 12 | Create/delete/rename/copy files, find, zip, sort |
| dev-tools | 12 | ping, VS Code, npm build, Docker, IP address |
| chaining-workflows | 15 | Multi-step automation, scheduled tasks |
| smart-home | 12 | Light, thermostat, lock, speaker control |
| workspace | 12 | Pomodoro, notes, tasks, focus mode |
| notification | 12 | Reminders, countdown, alarm, Telegram, Bark |
| screenshot | 12 | Full/region capture, recording, OCR |
| text-tools | 20 | Clipboard, transform, language detection |
| calendar | 12 | Event CRUD, today events, quick event |
| media-player | 14 | Spotify, Apple Music, YouTube Music controls |
| system-monitor | 12 | CPU, memory, disk, network, battery |
| quick-actions | 20 | Focus mode, screenshot, restart, app launches |
| communication | 18 | Email, Slack, Discord, Telegram, Push |
| window-display | 15 | Window management, snap, multi-monitor |
| security-privacy | 15 | Encryption, VPN, firewall, secure delete |
| terminal | 15 | Prompt, aliases, Oh My Zsh, completion |
| automation | 15 | Shortcuts, workflow recording, Automator |
| backup-sync | 15 | Time Machine, iCloud, rsync, encrypted backup |
| database | 15 | SQLite, MongoDB, PostgreSQL, Redis |
| git-tools | 18 | Branch, commit, push, pull, stash, log |
| api-web | 12 | HTTP, API client, webhook, weather |
| image-media | 20 | Resize, convert, PDF, GIF, video thumbnail |
| clipboard | 20 | History, templates, file copy |
| finder-spotlight | 15 | Finder ops, Spotlight, file tags |
| process-performance | 12 | Process list, CPU, memory, battery health |
| network | 15 | WiFi, Bluetooth, DNS, ping, port scan |
| datetime | 15 | World clock, timer, scheduled tasks |
| system-preferences | 20 | Settings panes, theme, Dock, keyboard |
| ai-llm | 12 | OpenAI, Ollama, DALL-E, Whisper |
| docker-container | 20 | Container ops, compose, images |
| kubernetes | 18 | Pods, deployments, services, namespace |
| cicd-pipeline | 15 | GitHub Actions, GitLab, Jenkins, Azure |
| cloud-provider | 18 | AWS, GCP, Azure operations |
| api-docs | 10 | OpenAPI, Postman, Markdown generation |
| testing-qa | 15 | Jest, Vitest, Playwright, coverage |
| logging-monitoring | 15 | Log aggregation, Prometheus, Grafana |
| secrets-config | 15 | Env vars, secrets, config files |
| code-quality | 12 | ESLint, Prettier, TypeScript, complexity |
| deployment-server | 15 | Deploy, rollback, PM2, Nginx, SSL |
| notification-channels | 18 | Slack, Discord, Email, SMS, Teams |
| virtualization-vm | 20 | VirtualBox, VMware, Parallels, QEMU |
| ssh-remote | 15 | SSH, key management, tunneling, SCP |
| auth-identity | 20 | JWT, sessions, password, MFA, OAuth |

## Total: 50 layers, 600+ tools
