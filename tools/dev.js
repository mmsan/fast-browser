import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {build, loadConfigFromFile} from 'vite'
import {browserRoot} from './build-config.js'

/** Reject linked output descendants before reads or writes can escape the project output. */
function assertLocalOutput(outDir, target) {
  const relative = path.relative(outDir, target)
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Invalid development output path')
  for (let current = target; ; current = path.dirname(current)) {
    const info = fs.lstatSync(current, {throwIfNoEntry: false})
    if (info) {
      const resolved = path.relative(outDir, fs.realpathSync(current))
      if (info.isSymbolicLink() || resolved === '..' || resolved.startsWith('..' + path.sep) || path.isAbsolute(resolved)) {
        throw new Error('Linked development output is not allowed: ' + current)
      }
    }
    if (current === outDir) break
  }
}

/** Watch sources and publish successful, self-contained builds without a development server. */
export async function startDevelopment(configFile) {
  const projectRoot = fs.realpathSync(path.dirname(configFile))
  const workRoot = path.join(projectRoot, 'node_modules', '.cache', 'fast-browser-dev')
  fs.mkdirSync(workRoot, {recursive: true})
  const lockPath = path.join(workRoot, 'owner.json')
  if (fs.existsSync(lockPath)) {
    const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    let running = true
    try { process.kill(owner.pid, 0) } catch (error) {
      if (error.code !== 'ESRCH') throw error
      running = false
    }
    if (running) throw new Error('Development is already running for this project. Stop that dev command first.')
    fs.unlinkSync(lockPath)
  }
  const lock = fs.openSync(lockPath, 'wx')
  fs.writeFileSync(lock, JSON.stringify({pid: process.pid}))
  fs.closeSync(lock)
  for (const entry of fs.readdirSync(workRoot, {withFileTypes: true})) {
    if (entry.isDirectory() && entry.name.startsWith('build-')) {
      const abandoned = path.join(workRoot, entry.name)
      if (path.dirname(fs.realpathSync(abandoned)) !== fs.realpathSync(workRoot)) throw new Error('Invalid abandoned build directory')
      fs.rmSync(abandoned, {recursive: true, force: true})
    }
  }
  const watchers = []
  let stopped = false, pending = false, timer, active, closing

  /** Commit assets before entrypoints and roll back replacements if publication fails. */
  function publish(directory, outDir, stamp) {
    const files = fs.readdirSync(directory, {recursive: true, withFileTypes: true})
      .filter(entry => entry.isFile()).map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)))
      .sort((a, b) => Number(b.startsWith('assets' + path.sep)) - Number(a.startsWith('assets' + path.sep)) || Number(a === 'manifest.json') - Number(b === 'manifest.json'))
    const backup = fs.mkdtempSync(path.join(workRoot, 'previous-'))
    const replaced = []
    let temporary, recovered = true
    try {
      for (const relative of files) {
        const target = path.join(outDir, relative)
        assertLocalOutput(outDir, target)
        const previous = path.join(backup, relative)
        const existed = fs.existsSync(target)
        if (existed) {
          fs.mkdirSync(path.dirname(previous), {recursive: true})
          fs.copyFileSync(target, previous)
        }
        fs.mkdirSync(path.dirname(target), {recursive: true})
        temporary = target + '.fast-browser-tmp'
        assertLocalOutput(outDir, temporary)
        fs.copyFileSync(path.join(directory, relative), temporary)
        fs.renameSync(temporary, target)
        replaced.push({target, previous, existed})
      }
      const marker = path.join(outDir, 'dev-build.json')
      temporary = marker + '.tmp'
      assertLocalOutput(outDir, marker)
      assertLocalOutput(outDir, temporary)
      fs.writeFileSync(temporary, JSON.stringify(stamp))
      fs.renameSync(temporary, marker)
    } catch (error) {
      recovered = false
      for (const {target, previous, existed} of replaced.reverse()) {
        if (existed) fs.renameSync(previous, target)
        else fs.unlinkSync(target)
      }
      recovered = true
      throw error
    } finally {
      if (temporary) fs.rmSync(temporary, {force: true})
      if (recovered) fs.rmSync(backup, {recursive: true, force: true})
      else console.error('[fast-browser] Publication recovery files retained at:', backup)
    }
  }

  /** Recreate the Vite pipeline each time so failed or removed entries cannot poison the next build. */
  async function rebuild() {
    do {
      pending = false
      const directory = fs.mkdtempSync(path.join(workRoot, 'build-'))
      try {
        const loaded = await loadConfigFromFile({command: 'build', mode: 'development'}, configFile)
        if (!loaded) throw new Error('Missing browser build configuration')
        const outDir = path.resolve(loaded.config.build.outDir)
        if (outDir !== path.join(projectRoot, 'dist') || fs.realpathSync(path.dirname(outDir)) !== projectRoot ||
          (fs.existsSync(outDir) && fs.realpathSync(outDir) !== outDir)) throw new Error('Development output must be the project dist directory')
        const marker = path.join(outDir, 'dev-build.json')
        assertLocalOutput(outDir, marker)
        const previous = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : {}
        const stamp = {version: randomUUID(), builtAt: Math.max(Date.now(), (previous.builtAt || 0) + 1)}
        await build({...loaded.config, configFile: false, mode: 'development', logLevel: 'warn',
          define: {...loaded.config.define, __FAST_BROWSER_DEV_BUILD__: JSON.stringify(stamp)},
          plugins: loaded.config.plugins.flat(Infinity).filter(plugin => plugin && plugin.name !== 'browser-release-archive'),
          build: {...loaded.config.build, outDir: directory, emptyOutDir: true, watch: null}})
        if (!stopped) {
          publish(directory, outDir, stamp)
          console.log('[fast-browser] Updated local dist. The extension remains usable after dev stops.')
        }
      } catch (error) {
        console.error('[fast-browser] Build/update failed; no reload requested.', error.message)
      } finally {
        fs.rmSync(directory, {recursive: true, force: true})
      }
    } while (pending && !stopped)
  }

  /** Debounce saves and serialize rebuilds without dropping changes made during a build. */
  function schedule() {
    if (stopped) return
    pending = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!active) active = rebuild().finally(() => { active = null })
    }, 150)
  }

  /** Stop only this command's watchers and release its ownership record. */
  function close() {
    if (!closing) closing = (async () => {
      stopped = true
      clearTimeout(timer)
      for (const watcher of watchers) watcher.close()
      try {
        await active
      } finally {
        fs.rmSync(lockPath, {force: true})
      }
    })()
    return closing
  }

  try {
    for (const root of new Set([browserRoot, projectRoot])) {
      for (const name of ['src', 'public', 'tools']) {
        const directory = path.join(root, name)
        if (fs.existsSync(directory)) watchers.push(fs.watch(directory, {recursive: true}, schedule))
      }
      for (const name of ['vite.config.js', 'manifest.config.js', 'package.json']) {
        const file = path.join(root, name)
        if (fs.existsSync(file)) watchers.push(fs.watch(file, schedule))
      }
    }
    active = rebuild()
    await active
    active = null
    console.log('[fast-browser] Watching sources. No development port is required.')
    return {close}
  } catch (error) {
    await close()
    throw error
  }
}
