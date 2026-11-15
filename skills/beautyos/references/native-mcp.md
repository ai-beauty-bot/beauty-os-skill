# Native MCP connection

Read this only when the user wants BeautyOS added to their agent's own MCP settings, for example because the bundled helper cannot run there. Ask before changing any agent configuration, and let the user run commands that open a browser if you cannot.

## What any MCP client needs

- Server URL: `https://agents.ai-beauty.bot/beauty-os/mcp` (Streamable HTTP transport).
- OAuth 2.1 public client: authorization code with PKCE S256 and the `resource` parameter. No client secret or API key exists; never ask the user for one.
- Client registration: Client ID Metadata Documents (preferred) or Dynamic Client Registration. The client discovers both from the server.
- Redirects: HTTPS callbacks, or `http://127.0.0.1`, `http://localhost` and `http://[::1]` loopback callbacks. Custom URL schemes are not supported.

If the client supports remote MCP servers with OAuth, adding the URL and signing in is usually enough. Scopes need no configuration: one approval covers everything, and salon roles limit each call.

## Examples

These commands come from each agent's documentation and can change between versions. If one fails, check that agent's current MCP documentation instead of guessing other flags.

The Claude Code plugin and Gemini CLI extension already configure this server.
If either is installed, use that connection instead of adding a second one.

Claude web:

Add a custom connector with the server URL above and OAuth enabled. Select
Claude's published identity or automatic client registration, then sign in to
BeautyOS and approve the salons to share. The callback is
`https://claude.ai/api/mcp/auth_callback`; registration binds that exact address
to the Claude client. The user does not enter a client secret or API key.

Claude Code:

```sh
claude mcp add --transport http beautyos https://agents.ai-beauty.bot/beauty-os/mcp
```

Then authenticate from `/mcp` inside Claude Code (or `claude mcp login beautyos` where available).

Codex:

```sh
codex mcp add beautyos --url https://agents.ai-beauty.bot/beauty-os/mcp
codex mcp login beautyos
```

Gemini CLI (without the extension):

```sh
gemini mcp add --transport http beautyos https://agents.ai-beauty.bot/beauty-os/mcp
```

Then use `/mcp auth beautyos` inside Gemini CLI to sign in.

Hermes Agent (`~/.hermes/config.yaml`):

```yaml
mcp_servers:
  beautyos:
    url: "https://agents.ai-beauty.bot/beauty-os/mcp"
    auth: oauth
```

Then run `hermes mcp login beautyos` in a terminal, or reload MCP servers in the session.

Other agents: add a remote (HTTP) MCP server with the URL above and enable OAuth in that agent's MCP settings. Graphical shells that drive another agent (for example T3 Code driving Codex or Claude Code) use the underlying agent's MCP settings.

## After connecting

The BeautyOS tools appear after the agent reloads its MCP servers; some agents need a restart or a new conversation. Then follow Path A in the skill. If the agent runs on a remote or headless host, a loopback callback may not reach the user's browser; use the bundled helper instead, which signs in with a code.
