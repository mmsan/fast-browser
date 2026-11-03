import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = process.env.FAST_BROWSER_STORE_CONFIG

/** Check that a credentials path is outside the checkout. */
function outsideRoot(candidate) {
  const relative = path.relative(root, candidate)
  return path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)
}

/** Send a request and reject unsuccessful API responses. */
async function request(url, options) {
  const response = await fetch(url, options)
  const result = await response.json()
  if (!response.ok) throw new Error(`Store request failed (${response.status}): ${result.error?.message || 'unknown error'}`)
  return result
}

try {
  if (!configPath) throw new Error('Set FAST_BROWSER_STORE_CONFIG to the absolute path of your private store credentials JSON. See README.')
  if (!path.isAbsolute(configPath) || !outsideRoot(configPath)) {
    throw new Error('Store credentials must be in an absolute path outside this repository.')
  }
  if (!outsideRoot(fs.realpathSync(configPath))) {
    throw new Error('Store credentials must resolve outside this repository.')
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const {publisherId, itemId, clientId, clientSecret, refreshToken} = config
  if (![publisherId, itemId, clientId, clientSecret, refreshToken].every(value => typeof value === 'string' && value.trim())) {
    throw new Error('Store credentials JSON is missing a required field. See README.')
  }
  if (!/^[a-z0-9_-]+$/i.test(publisherId) || !/^[a-p]{32}$/.test(itemId)) throw new Error('Invalid publisher or item ID.')

  const release = path.join(root, 'release')
  const before = new Set(fs.existsSync(release) ? fs.readdirSync(release) : [])
  const build = spawnSync('npm.cmd', ['run', 'production'], {cwd: root, stdio: 'inherit', shell: true})
  if (build.status !== 0) throw new Error('Production build failed.')
  const archives = fs.readdirSync(release).filter(name => name.endsWith('.zip') && !before.has(name))
  if (archives.length !== 1) throw new Error('Expected exactly one new release ZIP; no upload was attempted.')

  const token = await request('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token'}),
  })
  if (!token.access_token) throw new Error('Token response did not contain an access token.')
  const name = `publishers/${publisherId}/items/${itemId}`
  const headers = {Authorization: `Bearer ${token.access_token}`}
  const upload = await request(`https://chromewebstore.googleapis.com/upload/v2/${name}:upload`, {
    method: 'POST', headers: {...headers, 'Content-Type': 'application/zip'}, body: fs.readFileSync(path.join(release, archives[0])),
  })
  if (upload.itemId !== itemId) throw new Error('Upload response did not confirm the intended item; check the dashboard.')
  let state = upload.uploadState
  for (let i = 0; (state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS') && i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000))
    const status = await request(`https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`, {headers})
    state = status.lastAsyncUploadState
  }
  if (state !== 'SUCCEEDED') throw new Error(`Upload did not finish successfully (${state || 'unknown'}); check the dashboard before retrying.`)
  const submission = await request(`https://chromewebstore.googleapis.com/v2/${name}:publish`, {
    method: 'POST', headers: {...headers, 'Content-Type': 'application/json'}, body: JSON.stringify({publishType: 'DEFAULT_PUBLISH'}),
  })
  console.log(`Submitted to Chrome Web Store. State: ${submission.state || 'unknown'}. Publication depends on Google review.`)
  if (submission.warningInfo) console.log(JSON.stringify(submission.warningInfo, null, 2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
