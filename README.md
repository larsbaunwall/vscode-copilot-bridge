<img src="images/icon.png" width="100" />

# Copilot Bridge (VS Code Extension)

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/thinkability.copilot-bridge)](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/d/thinkability.copilot-bridge?label=installs)](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge)

> **A local interface for GitHub Copilot built on the official VS Code Language Models API.**

Copilot Bridge lets you access your personal Copilot session locally through an OpenAI-compatible interface — **without calling any private GitHub endpoints**. It’s designed for developers experimenting with AI agents, CLI tools, and custom integrations inside their own editor environment.

---

## ✨ Key Features

- Local HTTP server locked to `127.0.0.1`
- OpenAI-style `/v1/chat/completions`, `/v1/models`, and `/health` endpoints
- SSE streaming for incremental responses
- Real-time model discovery via VS Code Language Model API
- Concurrency and rate limits to keep VS Code responsive
- Mandatory bearer token authentication with `HTTP 401 Unauthorized` protection
- Lightweight Polka-based server integrated directly with the VS Code runtime

---

## ⚖️ Compliance & Usage Notice

- Uses **only** the public VS Code Language Models API.
- Does **not** contact or emulate private GitHub Copilot endpoints.
- Requires an active GitHub Copilot subscription.
- Subject to [GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) and the [Github Acceptable Use Policy](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies).
- Intended for **personal, local experimentation** only.
- No affiliation with GitHub or Microsoft.

> ❗ The author provides this project as a technical demonstration. Use responsibly and ensure your own compliance with applicable terms.

---

## 🚧 Scope and Limitations

| ✅ Supported | 🚫 Not Supported |
|--------------|------------------|
| Local, single-user loopback use | Multi-user or shared deployments |
| Testing local agents or CLI integrations | Continuous automation or CI/CD use |
| Educational / experimental use | Public or commercial API hosting |

---

## 🧠 Motivation

Copilot Bridge was built to demonstrate how VS Code’s **Language Model API** can power local-first AI tooling.  
It enables developers to reuse OpenAI-compatible SDKs and workflows while keeping all traffic on-device.

This is **not** a Copilot proxy, wrapper, or reverse-engineered client — it’s a bridge built entirely on the editor’s public extension surface.

---

## ⚠️ Disclaimer

This software is provided *as is* for research and educational purposes.  
Use at your own risk.  
You are solely responsible for ensuring compliance with your Copilot license and applicable terms.  
The author collects no data and has no access to user prompts or completions.

---

## 🚀 Quick Start

### Requirements
- Visual Studio Code Desktop with GitHub Copilot signed in  
- (Optional) Node.js 18+ and npm for local builds

### Installation

1. Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge) or load the `.vsix`.
2. Set **Copilot Bridge › Token** to a secret value (Settings UI or JSON). Requests without this token receive `401 Unauthorized`.
3. Open the **Command Palette** → “Copilot Bridge: Enable” to start the bridge.
4. Check status anytime with “Copilot Bridge: Status” or by hovering the status bar item (it links directly to the token setting when missing).
5. Keep VS Code open — the bridge runs only while the editor is active.

---

## 📡 Using the Bridge

Replace `PORT` with the one shown in “Copilot Bridge: Status”. Use the same token value you configured in VS Code:

```bash
export PORT=12345                 # Replace with the port from the status command
export BRIDGE_TOKEN="<your-copilot-bridge-token>"
```

List models:

```bash
curl -H "Authorization: Bearer $BRIDGE_TOKEN" \
  http://127.0.0.1:$PORT/v1/models
```

Stream a completion:

```bash
curl -N \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-copilot","messages":[{"role":"user","content":"hello"}]}' \
  http://127.0.0.1:$PORT/v1/chat/completions
```

Use with OpenAI SDK:

```ts
import OpenAI from "openai";

if (!process.env.BRIDGE_TOKEN) {
  throw new Error("Set BRIDGE_TOKEN to the same token configured in VS Code settings (bridge.token).");
}

const client = new OpenAI({
  baseURL: `http://127.0.0.1:${process.env.PORT}/v1`,
  apiKey: process.env.BRIDGE_TOKEN,
});

const rsp = await client.chat.completions.create({
  model: "gpt-4o-copilot",
  messages: [{ role: "user", content: "hello" }],
});

console.log(rsp.choices[0].message?.content);
```

---

## 🧩 Architecture

The extension uses VS Code’s built-in Language Model API to select available Copilot chat models.  
Requests are normalized and sent through VS Code itself, never directly to GitHub Copilot servers.  
Responses stream back via SSE with concurrency controls for editor stability.

---

## 🔧 Configuration

| Setting | Default | Description |
|----------|----------|-------------|
| `bridge.enabled` | false | Start automatically with VS Code |
| `bridge.port` | 0 | Ephemeral port |
| `bridge.token` | "" | Bearer token required for every request (leave empty to block API access) |
| `bridge.historyWindow` | 3 | Retained conversation turns |
| `bridge.maxConcurrent` | 1 | Max concurrent requests |
| `bridge.verbose` | false | Enable verbose logging |

> ℹ️ The bridge always binds to `127.0.0.1` and cannot be exposed to other interfaces.

> 💡 Hover the status bar item to confirm the token status; missing tokens show a warning link that opens the relevant setting.

---

## 🪶 Logging & Diagnostics

1. Enable `bridge.verbose`.
2. Open **View → Output → “Copilot Bridge”**.
3. Observe connection events, health checks, and streaming traces.

---

## 🔒 Security

> ⚠️ This extension is intended for **localhost use only**.  
> Never expose the endpoint to external networks.

- Loopback-only binding (non-configurable)  
- Mandatory bearer token gating (requests rejected without the correct header)  
- No persistent storage or telemetry  

---

## 🧾 Changelog

- **v1.2.0** – Authentication token now mandatory; status bar hover warns when missing  
- **v1.1.1** – Locked the HTTP server to localhost for improved safety  
- **v1.1.0** – Performance improvements (~30%)  
- **v1.0.0** – Modular core, OpenAI typings, tool-calling support  
- **v0.2.2** – Polka integration, improved model family selection  
- **v0.1.0–0.1.5** – Initial releases and bug fixes

---

## 🤝 Contributing

Pull requests and discussions are welcome.  
Please open an [issue](https://github.com/larsbaunwall/vscode-copilot-bridge/issues) to report bugs or suggest features.

---

## 📄 License

Apache 2.0 © 2025 [Lars Baunwall]  
Independent project — not affiliated with GitHub or Microsoft.  
For compliance or takedown inquiries, please open a GitHub issue.

---
