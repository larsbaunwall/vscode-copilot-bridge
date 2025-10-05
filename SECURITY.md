# Security & Compliance

- Uses only the public **VS Code Language Model API** (`vscode.lm`).
- Does **not** call, impersonate, or reverse-engineer private GitHub Copilot endpoints.
- The HTTP server binds to **localhost** by default (non-configurable).
- Mandatory bearer-token auth via `bridge.token`.
- Rate and concurrency limits are available to preserve interactive editor usage.
- No telemetry or prompt/response data is collected or transmitted by the author.