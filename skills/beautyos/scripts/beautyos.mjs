#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultOrigin = 'https://agents.ai-beauty.bot'
const clientId = 'beautyos-skill'
// Used only when an older server does not publish OAuth discovery metadata.
const fallbackScopes = ['profile.read', 'salons.read', 'salons.write', 'catalog.read', 'catalog.write', 'staff.read', 'staff.write', 'channels.read', 'channels.write', 'agent.read', 'agent.write'].map((scope) => `beautyos.${scope}`)
class SafeError extends Error {}
function fail(code) { throw new SafeError(code) }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function secureOrigin(value) {
  try { const url = new URL(value); if (url.protocol === 'https:' && url.origin === value && !url.username && !url.password) return value } catch {}
  fail('invalid_origin')
}
async function safeDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) fail('unsafe_credential_directory')
  await chmod(path, 0o700)
}
async function readPrivate(path) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 65536 || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) fail('unsafe_credential_file')
    return JSON.parse(await handle.readFile('utf8'))
  } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
  finally { await handle?.close() }
}
async function writePrivate(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await handle.writeFile(JSON.stringify(value)); await handle.sync(); await handle.close(); handle = undefined
    await rename(temp, path)
  } finally { await handle?.close(); await rm(temp, { force: true }) }
}
async function withLock(directory, action) {
  const path = join(directory, 'lock')
  try { await mkdir(path, { mode: 0o700 }) }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error
    // Fail closed rather than guessing whether a refresh-token rotation finished.
    fail('credentials_busy_or_interrupted')
  }
  try { return await action() } finally { await rm(path, { recursive: true, force: true }) }
}
async function readBounded(response, max = 4 * 1024 * 1024) {
  if (!response.body) return null
  const reader = response.body.getReader(); const chunks = []; let size = 0
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > max) fail('response_too_large'); chunks.push(part.value) }
    if (!size) return null
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
function tokenState(data, origin, now) {
  if (!record(data) || !/^bos_mcp_at_[A-Za-z0-9_-]{43}$/.test(data.access_token) || !/^bos_mcp_rt_[A-Za-z0-9_-]{43}$/.test(data.refresh_token)
    || data.token_type !== 'Bearer' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86400) fail('invalid_token_response')
  return { origin, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: now + data.expires_in * 1000 }
}
export async function runCommand(args, options = {}) {
  const origin = secureOrigin(options.origin ?? process.env.BEAUTYOS_ORIGIN ?? defaultOrigin)
  const resource = `${origin}/beauty-os/mcp`
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? Date.now
  const root = options.directory ?? process.env.BEAUTYOS_CONFIG_DIR ?? join(homedir(), '.config', 'beautyos')
  const directory = join(root, createHash('sha256').update(origin).digest('hex').slice(0, 24))
  const credentials = join(directory, 'credentials.json'); const pending = join(directory, 'pending.json')
  await safeDirectory(root); await safeDirectory(directory)
  async function request(path, init, allowMissing = false) {
    let response
    try { response = await fetcher(`${origin}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) }) }
    catch { fail('connection_failed_outcome_unknown') }
    if (allowMissing && response.status === 404) { await response.body?.cancel(); return { status: 404, ok: false, data: null } }
    let data
    try { data = await readBounded(response) } catch (error) { if (error instanceof SafeError) throw error; fail('invalid_server_response') }
    return { status: response.status, ok: response.ok, data }
  }
  async function oauth(path, values) {
    return request(`/beauty-os/oauth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, ...values }).toString() })
  }
  function oauthError(result) {
    const code = result.data?.error
    if (['invalid_grant', 'invalid_client', 'invalid_scope', 'invalid_request', 'access_denied', 'expired_token', 'temporarily_unavailable', 'slow_down', 'authorization_pending'].includes(code)) fail(code)
    fail('authorization_failed')
  }
  async function getCredentials() {
    let state = await readPrivate(credentials)
    if (!state || state.origin !== origin || typeof state.refreshToken !== 'string' || typeof state.accessToken !== 'string' || !Number.isFinite(state.expiresAt)) fail('login_required')
    if (state.refreshUnknown) fail('refresh_outcome_unknown_login_required')
    if (state.expiresAt - now() > 30_000) return state
    // Record ambiguity BEFORE dispatch; never replay a refresh token after a crash.
    await writePrivate(credentials, { ...state, refreshUnknown: true })
    const result = await oauth('token', { grant_type: 'refresh_token', refresh_token: state.refreshToken, resource })
    if (!result.ok) {
      if (['invalid_grant', 'access_denied'].includes(result.data?.error)) await rm(credentials, { force: true })
      oauthError(result)
    }
    state = tokenState(result.data, origin, now()); await writePrivate(credentials, state); return state
  }
  async function rpc(state, method, params, protocol, notification = false) {
    const id = randomUUID()
    const result = await request('/beauty-os/mcp', { method: 'POST', headers: { Authorization: `Bearer ${state.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', ...(!notification ? { id } : {}), method, params }) })
    if (result.status === 401) { await rm(credentials, { force: true }); fail('login_required') }
    if (notification) { if (!result.ok) fail('mcp_request_failed'); return }
    if (!result.ok || !record(result.data) || result.data.id !== id || result.data.jsonrpc !== '2.0' || result.data.error) fail('mcp_request_failed')
    return result.data.result
  }
  const [command, ...rest] = args
  if (command === 'help' || !command) return { ok: true, commands: ['login', 'login-status', 'status', 'tools', 'call <tool> <arguments.json>', 'logout'], origin }
  if (command === 'login') return withLock(directory, async () => {
    // BeautyOS grants one consent for every advertised capability; salon roles limit each operation.
    if (rest.length) fail('invalid_login_options')
    const metadata = await request('/.well-known/oauth-authorization-server/beauty-os/oauth', { method: 'GET' }, true)
    let scopes = fallbackScopes
    if (metadata.ok) {
      const data = metadata.data
      if (!record(data) || data.issuer !== `${origin}/beauty-os/oauth` || !Array.isArray(data.scopes_supported)
        || data.scopes_supported.length === 0 || data.scopes_supported.length > 64
        || data.scopes_supported.some((scope) => typeof scope !== 'string' || !/^beautyos\.[a-z][a-z0-9_-]{0,40}\.(read|write)$/.test(scope))
        || !data.scopes_supported.includes('beautyos.profile.read')) fail('invalid_authorization_metadata')
      scopes = [...new Set(data.scopes_supported)]
    } else if (metadata.status !== 404) fail('authorization_metadata_unavailable')
    const result = await oauth('device', { resource, scope: scopes.join(' ') })
    if (!result.ok) oauthError(result)
    const data = result.data
    if (!record(data) || !/^[A-Za-z0-9_-]{43}$/.test(data.device_code) || !/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(data.user_code)
      || data.verification_uri !== `${origin}/beauty-os/connect` || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 1800
      || !Number.isFinite(data.interval) || data.interval < 1 || data.interval > 60) fail('invalid_device_response')
    // The secret device code goes only into the private store.
    await writePrivate(pending, { origin, deviceCode: data.device_code, expiresAt: now() + data.expires_in * 1000, interval: data.interval, nextPollAt: now() + data.interval * 1000 })
    return { ok: true, status: 'waiting_user', verificationUrl: `${data.verification_uri}#code=${data.user_code}`, userCode: data.user_code, expiresIn: data.expires_in, nextPollSeconds: data.interval, scopes }
  })
  if (command === 'login-status') return withLock(directory, async () => {
    const state = await readPrivate(pending)
    if (!state || state.origin !== origin) fail('no_pending_login')
    if (state.outcomeUnknown) fail('login_outcome_unknown_start_again')
    if (state.expiresAt <= now()) { await rm(pending, { force: true }); fail('expired_token') }
    if (state.nextPollAt > now()) return { ok: true, status: 'waiting_user', nextPollSeconds: Math.ceil((state.nextPollAt - now()) / 1000) }
    await writePrivate(pending, { ...state, outcomeUnknown: true })
    const result = await oauth('token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: state.deviceCode, resource })
    if (['authorization_pending', 'slow_down'].includes(result.data?.error)) {
      const interval = state.interval + (result.data.error === 'slow_down' ? 5 : 0)
      await writePrivate(pending, { ...state, interval, nextPollAt: now() + interval * 1000 })
      return { ok: true, status: 'waiting_user', nextPollSeconds: interval }
    }
    if (!result.ok) { await rm(pending, { force: true }); oauthError(result) }
    await writePrivate(credentials, tokenState(result.data, origin, now())); await rm(pending, { force: true })
    return { ok: true, status: 'connected', manageConnectionsUrl: `${origin}/beauty-os/connections` }
  })
  if (command === 'logout') return withLock(directory, async () => {
    const state = await readPrivate(credentials)
    if (state?.origin === origin && state.refreshToken) {
      const result = await oauth('revoke', { token: state.refreshToken })
      if (!result.ok) oauthError(result)
    }
    await rm(credentials, { force: true }); await rm(pending, { force: true })
    return { ok: true, status: 'disconnected' }
  })
  if (!['status', 'tools', 'call'].includes(command)) fail('unknown_command')
  // Hold the lock across requests so other chats cannot rotate a token in flight.
  return withLock(directory, async () => {
    const state = await getCredentials()
    const initialized = await rpc(state, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'beautyos-skill', version: '1.0.0' } })
    if (typeof initialized?.protocolVersion !== 'string') fail('invalid_mcp_initialize')
    const protocol = initialized.protocolVersion
    await rpc(state, 'notifications/initialized', {}, protocol, true)
    if (command === 'status') {
      const profile = await rpc(state, 'tools/call', { name: 'beautyos_get_profile', arguments: {} }, protocol)
      return { ok: true, status: profile?.isError ? 'unavailable' : 'connected', result: modelResult(profile), manageConnectionsUrl: `${origin}/beauty-os/connections` }
    }
    const listed = await rpc(state, 'tools/list', {}, protocol)
    if (!Array.isArray(listed?.tools)) fail('invalid_tools_response')
    const allowed = listed.tools.filter((tool) => !tool._meta?.ui?.visibility || tool._meta.ui.visibility.includes('model'))
    if (command === 'tools') return { ok: true, tools: allowed.map(({ _meta, ...tool }) => tool) }
    const [toolName, inputPath] = rest
    if (!allowed.some((tool) => tool.name === toolName) || rest.length > 2) fail('tool_not_available_to_agent')
    let input = {}
    if (inputPath) { const file = await readFile(resolve(inputPath)); if (file.length > 3 * 1024 * 1024) fail('arguments_too_large'); input = JSON.parse(file.toString('utf8')) }
    if (!record(input)) fail('invalid_arguments_file')
    const result = await rpc(state, 'tools/call', { name: toolName, arguments: input }, protocol)
    return { ok: !result?.isError, result: modelResult(result) }
  })
}
function modelResult(result) {
  if (!record(result)) fail('invalid_tool_result')
  // In particular, never expose the MCP Apps private QR/OAuth presentation.
  return { ...(result.content ? { content: result.content } : {}), ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}), ...(result.isError ? { isError: true } : {}) }
}
export async function main(args, options) {
  try { return await runCommand(args, options) }
  catch (error) { return { ok: false, error: error instanceof SafeError ? error.message : 'local_operation_failed' } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await main(process.argv.slice(2)); process.stdout.write(`${JSON.stringify(result)}\n`); if (!result.ok) process.exitCode = 1
}
