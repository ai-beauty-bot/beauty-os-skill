import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../skills/beautyos/scripts/beautyos.mjs'

const origin = 'https://agents.ai-beauty.bot'
const deviceCode = 'd'.repeat(43)
const accessToken = 'bos_mcp_at_' + 'a'.repeat(43)
const refreshToken = 'bos_mcp_rt_' + 'r'.repeat(43)
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'beautyos-helper-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let time = 1000000
  const requests = []
  let tokenCalls = 0
  let failRefresh = false
  const options = { directory, origin, now: () => time, fetcher: async (url, init) => {
    requests.push({ url, init })
    if (url.includes('/.well-known/oauth-authorization-server/')) return json({ issuer: origin + '/beauty-os/oauth', scopes_supported: ['beautyos.profile.read', 'beautyos.salons.read', 'beautyos.knowledge.read', 'beautyos.booking.write', 'beautyos.insights.read', 'beautyos.insights.write'] })
    if (url.endsWith('/device')) return json({ device_code: deviceCode, user_code: 'ABCD-EFGH', verification_uri: origin + '/beauty-os/connect', interval: 5, expires_in: 600 })
    if (url.endsWith('/token')) {
      tokenCalls++
      const params = new URLSearchParams(init.body)
      if (params.get('grant_type') === 'refresh_token' && failRefresh) throw new Error('secret exception ' + refreshToken)
      return json({ access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 300 })
    }
    if (url.endsWith('/revoke')) return new Response(null, { status: 200 })
    const rpc = JSON.parse(init.body)
    if (rpc.method === 'notifications/initialized') { assert.equal(rpc.id, undefined); return new Response(null, { status: 202 }) }
    if (rpc.method === 'initialize') return json({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-03-26', capabilities: {} } })
    if (rpc.method === 'tools/list') return json({ jsonrpc: '2.0', id: rpc.id, result: { tools: [
      { name: 'beautyos_get_onboarding', _meta: { ui: { visibility: ['model', 'app'] } } },
      { name: 'beautyos_channel_presentation', _meta: { ui: { visibility: ['app'] } } },
    ] } })
    return json({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { ready: false }, _meta: { 'beautyOs/private': { qr: 'PRIVATE' } } } })
  } }
  const run = (...args) => main(args, options)
  const connect = async () => { assert.equal((await run('login')).status, 'waiting_user'); time += 5000; assert.equal((await run('login-status')).status, 'connected') }
  return { directory, options, run, connect, requests, advance: (ms) => { time += ms }, tokenCalls: () => tokenCalls, failRefresh: () => { failRefresh = true } }
}
test('login hides all tokens/device secrets, respects poll interval and protects storage', async (t) => {
  const f = await fixture(t)
  const login = await f.run('login')
  assert.equal(login.userCode, 'ABCD-EFGH')
  assert.ok(!JSON.stringify(login).includes(deviceCode))
  assert.equal((await f.run('login-status')).status, 'waiting_user')
  assert.equal(f.tokenCalls(), 0)
  f.advance(5000)
  const result = await f.run('login-status')
  assert.equal(result.status, 'connected')
  assert.ok(!JSON.stringify(result).includes(accessToken))
  const [subdirectory] = await readdir(f.directory)
  const credentialPath = join(f.directory, subdirectory, 'credentials.json')
  assert.equal((await stat(credentialPath)).mode & 0o777, 0o600)
  assert.equal(JSON.parse(await readFile(credentialPath)).refreshToken, refreshToken)
})
test('lists only model tools, strips private payloads, and refuses UI-only calls', async (t) => {
  const f = await fixture(t); await f.connect()
  assert.deepEqual((await f.run('tools')).tools.map((tool) => tool.name), ['beautyos_get_onboarding'])
  assert.equal((await f.run('call', 'beautyos_channel_presentation')).error, 'tool_not_available_to_agent')
  const result = await f.run('call', 'beautyos_get_onboarding')
  assert.equal(result.ok, true)
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
  assert.ok(!JSON.stringify(result).includes(accessToken))
  assert.ok(f.requests.every(({ init }) => init.redirect === 'error'))
  assert.ok(f.requests.some(({ init }) => typeof init.body === 'string' && init.body.includes('notifications/initialized')))
})
test('renews access automatically, and logs out through server revocation', async (t) => {
  const f = await fixture(t); await f.connect(); f.advance(300000)
  assert.equal((await f.run('status')).status, 'connected')
  assert.equal(f.tokenCalls(), 2)
  const refresh = f.requests.find(({ url, init }) => url.endsWith('/token') && new URLSearchParams(init.body).get('grant_type') === 'refresh_token')
  assert.equal(new URLSearchParams(refresh.init.body).has('scope'), false)
  assert.equal((await f.run('logout')).status, 'disconnected')
  assert.ok(f.requests.some(({ url }) => url.endsWith('/revoke')))
  assert.equal((await f.run('status')).error, 'login_required')
})
test('does not replay an ambiguously consumed refresh token or print transport exceptions', async (t) => {
  const f = await fixture(t); await f.connect(); f.advance(300000); f.failRefresh()
  const failed = await f.run('status')
  assert.equal(failed.error, 'connection_failed_outcome_unknown')
  assert.ok(!JSON.stringify(failed).includes(refreshToken))
  assert.equal((await f.run('status')).error, 'refresh_outcome_unknown_login_required')
  assert.equal(f.tokenCalls(), 2)
})
test('isolates credentials by origin and rejects non-HTTPS origins', async (t) => {
  const f = await fixture(t); await f.connect()
  assert.equal((await main(['status'], { ...f.options, origin: 'https://other.example' })).error, 'login_required')
  assert.equal((await main(['status'], { ...f.options, origin: 'http://agents.ai-beauty.bot' })).error, 'invalid_origin')
})
test('reads arguments from a file and sends only the selected JSON object', async (t) => {
  const f = await fixture(t); await f.connect()
  const input = join(f.directory, 'arguments.json'); await writeFile(input, JSON.stringify({ salonId: 'salon' }))
  assert.equal((await f.run('call', 'beautyos_get_onboarding', input)).ok, true)
  const last = f.requests.at(-1)
  assert.deepEqual(JSON.parse(last.init.body).params.arguments, { salonId: 'salon' })
})

test('login requests every capability the server advertises', async (t) => {
  const f = await fixture(t)
  const result = await f.run('login')
  assert.equal(result.status, 'waiting_user')
  assert.deepEqual(result.scopes, ['beautyos.profile.read', 'beautyos.salons.read', 'beautyos.knowledge.read', 'beautyos.booking.write', 'beautyos.insights.read', 'beautyos.insights.write'])
  const device = f.requests.find(({ url }) => url.endsWith('/device'))
  assert.equal(new URLSearchParams(device.init.body).get('scope'), result.scopes.join(' '))
  assert.ok(f.requests.some(({ url }) => url.includes('/.well-known/oauth-authorization-server/')))
})
test('login rejects foreign issuers or unsafe scope metadata before starting device authorization', async (t) => {
  const f = await fixture(t)
  for (const data of [
    { issuer: 'https://other.example/oauth', scopes_supported: ['beautyos.profile.read'] },
    { issuer: origin + '/beauty-os/oauth', scopes_supported: ['beautyos.profile.read', 'users:admin'] },
  ]) {
    const result = await main(['login'], { ...f.options, fetcher: async () => json(data) })
    assert.equal(result.error, 'invalid_authorization_metadata')
  }
})
test('login falls back to the setup capabilities on a server without discovery metadata', async (t) => {
  const f = await fixture(t)
  const original = f.options.fetcher
  const requests = []
  const setup = ['profile.read', 'salons.read', 'salons.write', 'catalog.read', 'catalog.write', 'staff.read', 'staff.write', 'channels.read', 'channels.write', 'agent.read', 'agent.write'].map((scope) => `beautyos.${scope}`)
  const result = await main(['login'], { ...f.options, fetcher: async (url, init) => {
    requests.push(url)
    if (url.includes('/.well-known/')) return new Response('404 Not Found', { status: 404 })
    assert.equal(new URLSearchParams(init.body).get('scope'), setup.join(' '))
    return original(url, init)
  } })
  assert.equal(result.status, 'waiting_user')
  assert.deepEqual(result.scopes, setup)
  assert.equal(requests.length, 2)
})

test('removed scope options are rejected before contacting the server', async (t) => {
  const f = await fixture(t)
  for (const args of [['--profile', 'setup'], ['--scopes', 'beautyos.knowledge.read'], ['extra']]) {
    assert.equal((await f.run('login', ...args)).error, 'invalid_login_options')
  }
  assert.equal(f.requests.length, 0)
})
