import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {crx} from '@crxjs/vite-plugin'
import vue from '@vitejs/plugin-vue'
import zip from 'vite-plugin-zip-pack'
import manifest from '../manifest.config.js'

export const browserRoot = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(browserRoot, 'package.json'), 'utf8'))

/** Check that a path remains within its owning project. */
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/** Validate outputs before Vite or the archive plugin writes or cleans them. */
function localOutput(root, relativePath) {
  const output = path.resolve(root, relativePath)
  if (output === root || !isWithin(root, output)) throw new Error(`Output must stay inside its project: ${output}`)
  for (let current = output; current !== root; current = path.dirname(current)) {
    if (fs.existsSync(current) && !isWithin(root, fs.realpathSync(current))) {
      throw new Error(`Output resolves outside its project: ${current}`)
    }
  }
  return output
}

/** Share the manifest, toolchain, dependencies and source assets with extension applications. */
export function createBrowserConfig({projectRoot = browserRoot, extensionManifest = manifest, plugins = []} = {}) {
  const root = fs.realpathSync(projectRoot)
  const outDir = localOutput(root, 'dist')
  const releaseDir = localOutput(root, 'release')
  const archiveTime = new Date().toISOString().replace(/[:.]/g, '-')
  return {
    root: browserRoot,
    envDir: root,
    cacheDir: path.join(root, 'node_modules/.vite'),
    resolve: {
      alias: {'@': path.join(browserRoot, 'src')},
      dedupe: Object.keys(pkg.dependencies),
    },
    define: {__FAST_BROWSER_DEV_BUILD__: 'null'},
    plugins: [
      ...plugins,
      vue(),
      crx({manifest: extensionManifest}),
      {...zip({
        inDir: outDir,
        outDir: releaseDir,
        outFileName: `crx-${extensionManifest.name}-${extensionManifest.version}-${archiveTime}-${process.pid}.zip`,
      }), name: 'browser-release-archive'},
    ],
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {input: {offscreen: path.join(browserRoot, 'src/offscreen.html')}},
    },
  }
}
