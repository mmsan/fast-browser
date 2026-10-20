// Run with: node tests/offscreen-messaging.mjs
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import _ from 'lodash'

const sources = Object.fromEntries(['f', 'background', 'offscreen'].map(name => [
  name,
  readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, ''),
]))
const listeners = new Map()
const event = {addListener() {}}
let exists = false
let creations = 0
let failCreation = false
let failCanvas = false

/** Load the actual extension scripts with isolated Chrome and DOM globals. */
function load(name) {
  const runtime = {
    onMessage: {
      /** Register this context's message receiver. */
      addListener(listener) {
        listeners.set(name, listener)
      },
    },
    onInstalled: event,
    onStartup: event,
    connect() {
      return {onDisconnect: event}
    },
    /** Broadcast to other extension contexts and preserve async responses. */
    sendMessage(message, callback) {
      const response = new Promise((resolve, reject) => {
        let pending = false
        let answered = false
        for(const [recipient, listener] of listeners) {
          if(recipient === name) continue
          pending = listener(message, {tab: {id: 1}}, result => {
            answered = true
            resolve(JSON.parse(JSON.stringify(result)))
          }) === true || pending
        }
        if(!pending && !answered) {
          reject(new Error('The message port closed before a response was received.'))
        }
      })
      if(!callback) return response
      response.then(callback, error => {
        runtime.lastError = {message: error.message}
        try {
          callback()
        } finally {
          delete runtime.lastError
        }
      })
    },
  }
  const context = vm.createContext({
    _, f: {}, self: {}, window: {}, setTimeout, clearTimeout,
    process: {env: {NODE_ENV: 'test'}},
    console: {log() {}, error() {}},
    chrome: {
      runtime,
      offscreen: {
        /** Report existence before loading finishes, as during creation. */
        async hasDocument() {
          return exists
        },
        /** Delay listener registration to exercise requests during creation. */
        async createDocument({url}) {
          assert.equal(url, 'src/offscreen.html')
          creations++
          assert.equal(exists, false, 'must not create duplicate documents')
          if(failCreation) {
            failCreation = false
            throw new Error('document creation failed')
          }
          exists = true
          await new Promise(resolve => setTimeout(resolve, 10))
          load('offscreen')
        },
      },
      tabs: {onActivated: event, onRemoved: event, onUpdated: event},
      windows: {onFocusChanged: event},
      storage: {
        sync: {
          /** Start with no persisted background settings. */
          get(callback) {
            callback({})
          },
        },
      },
    },
    document: {
      /** Supply known pixels, or fail before analysis to check error replies. */
      createElement() {
        if(failCanvas) throw new Error('canvas unavailable')
        return {
          /** Supply the canvas operations used by image analysis. */
          getContext() {
            return {
              drawImage() {},
              /** Return a solid RGB image with opaque pixels. */
              getImageData() {
                return {data: Uint8ClampedArray.from({length: 256}, (v, i) => [40, 80, 120, 255][i % 4])}
              },
            }
          },
        }
      },
    },
    Image: class {
      /** Finish loading asynchronously so the real image loop runs. */
      set src(value) {
        queueMicrotask(() => this.onload())
      }
    },
  })
  vm.runInContext(sources.f + '\nObject.assign(f, {sendToBackground, sleep})', context)
  if(name !== 'content') vm.runInContext(sources[name], context)
  return context.f
}

/** Simulate Chrome closing the offscreen document. */
function closeDocument() {
  exists = false
  listeners.delete('offscreen')
}

load('background')
const f = load('content')
const image = {src: 'https://example.test/image.png', width: 100, height: 100}
const first = f.sendToBackground('getImageColor', image)
const concurrent = f.sendToBackground('getImageColor', image)
const duringLoad = new Promise(resolve => setTimeout(() => {
  resolve(f.sendToBackground('getImageColor', image))
}, 1))
for(const color of await Promise.all([first, concurrent, duringLoad])) {
  assert.deepEqual(color, [40, 80, 120])
}
assert.equal(creations, 1)
assert.deepEqual(await f.sendToBackground('getImageColor', image), [40, 80, 120])
assert.equal(creations, 1, 'reuse the existing document')
assert.equal(await f.sendToBackground('isRunning'), true)
assert.deepEqual(await f.sendToBackground('getImageColor', {...image, dst: 'offscreen'}), [40, 80, 120])

closeDocument()
assert.deepEqual(await f.sendToBackground('getImageColor', image), [40, 80, 120])
assert.equal(creations, 2, 'recreate a closed document')

closeDocument()
failCreation = true
await assert.rejects(f.sendToBackground('getImageColor', image), /document creation failed/)
assert.deepEqual(await f.sendToBackground('getImageColor', image), [40, 80, 120])
assert.equal(creations, 4, 'retry after creation failure')
failCanvas = true
await assert.rejects(f.sendToBackground('getImageColor', image), /canvas unavailable/)

console.log('Offscreen messaging regression checks passed.')
