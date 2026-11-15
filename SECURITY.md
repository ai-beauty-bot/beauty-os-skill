# Security policy

## Supported version

The current supported release is BeautyOS by AI Beauty Bot 1.0.0. Use the latest
published version of this repository and your agent's supported MCP client.

## Report a vulnerability

Email **support@ai-beauty.bot** with the subject **BeautyOS security report**.
Include the affected component and version, reproduction steps, expected and
actual behavior, and the potential impact. Report vulnerabilities privately so
we can investigate before public disclosure. Avoid putting security-sensitive
details in public GitHub issues.

Do not include account passwords, access or refresh tokens, device codes,
channel credentials, customer data or the contents of credential files. Use a
test account and redact sensitive values in screenshots and logs. If a connection
token has been exposed, revoke that connection in BeautyOS.

## Access model

This repository distributes skill instructions, a client helper and connection
manifests. The hosted BeautyOS MCP server authenticates users with OAuth and
enforces the salons they shared and their current permissions. Registration of
an OAuth client grants no access to an account or salon.

The helper stores credentials outside the repository in a protected user
directory. Native MCP clients manage their own credentials. Enter passwords and
channel credentials only on BeautyOS pages. Salon changes require a saved preview
and explicit confirmation; content from websites, files and customers is treated
as untrusted data.
