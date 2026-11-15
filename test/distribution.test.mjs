import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'))

test('marketplace resolves its plugin and bundled skill entirely within this repository', async () => {
  const marketplace = await readJson('.claude-plugin/marketplace.json')
  assert.equal(marketplace.name, 'ai-beauty-bot')
  assert.equal(marketplace.plugins.length, 1)
  const entry = marketplace.plugins[0]
  const pluginRoot = resolve(root, entry.source)
  assert.equal(pluginRoot, resolve(root))
  const plugin = JSON.parse(await readFile(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(entry.name, plugin.name)
  assert.equal(plugin.name, 'beautyos')
  assert.equal(plugin.author.email, marketplace.owner.email)
  assert.ok((await stat(resolve(pluginRoot, plugin.icon))).isFile())
  const skillPath = resolve(pluginRoot, 'skills/beautyos/SKILL.md')
  const skill = await readFile(skillPath, 'utf8')
  assert.match(skill, /^---\r?\nname: beautyos\r?\n/)
  for (const [, path] of skill.matchAll(/\]\(([^)]+\.md)\)/g)) {
    assert.ok((await stat(resolve(dirname(skillPath), path))).isFile(), path)
  }
})

test('distribution manifests share the release version and public agent endpoint', async () => {
  const [pkg, plugin, gemini, registry] = await Promise.all([
    readJson('package.json'), readJson('.claude-plugin/plugin.json'), readJson('gemini-extension.json'), readJson('server.json'),
  ])
  assert.equal(pkg.version, '1.0.0')
  for (const manifest of [plugin, gemini, registry]) assert.equal(manifest.version, pkg.version)
  assert.equal(gemini.name, plugin.name)
  const endpoint = plugin.mcpServers.beautyos.url
  assert.equal(endpoint, 'https://agents.ai-beauty.bot/beauty-os/mcp')
  assert.equal(plugin.mcpServers.beautyos.type, 'http')
  assert.equal(gemini.mcpServers.beautyos.httpUrl, endpoint)
  assert.equal(gemini.mcpServers.beautyos.oauth.enabled, true)
  assert.deepEqual(registry.remotes, [{ type: 'streamable-http', url: endpoint }])
  assert.equal(registry.name, 'bot.ai-beauty/beautyos')
  assert.equal(registry.title, plugin.displayName)
  assert.equal(registry.websiteUrl, plugin.homepage)
  assert.equal(registry.repository.url, plugin.repository)
  assert.ok(registry.description.length <= 100)
  // Distribution never embeds credentials or bypasses the user's OAuth consent.
  for (const config of [plugin.mcpServers.beautyos, gemini.mcpServers.beautyos]) {
    assert.equal(config.headers, undefined)
    assert.equal(config.trust, undefined)
    assert.equal(config.oauth?.clientSecret, undefined)
  }
})

test('bundled logo is a 512px PNG matching the Registry icon declaration', async () => {
  const image = await readFile(resolve(root, 'assets/logo.png'))
  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  assert.equal(image.readUInt32BE(16), 512)
  assert.equal(image.readUInt32BE(20), 512)
  const registry = await readJson('server.json')
  assert.deepEqual(registry.icons[0].sizes, ['512x512'])
  assert.equal(registry.icons[0].mimeType, 'image/png')
})
