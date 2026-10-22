import _ from 'lodash'
import * as f from '@/f'
import 'babel-polyfill'
import {installBrowserBridge} from './browser-bridge.js'

// region msg
let tabs = {} // tabId: tab
let currentUrlRevision = 0
let currentUrlWindowId = null
let currentUrlTabId = null
let tasks = ''
let tasks_ = null
let topOffset
let ratioSysChrome
const chromeHwndStorageKey = 'chromeHwnd'
let chromeHwnd
let chromeHwndRequestPromise
const tabObservers = new Set()
let bridge
const msgHandler = {
  init({tab, frameId}) {
    tabs[tab.id] = tab
    for (const observer of tabObservers) observer.initialized?.(tab)
    if(frameId === 0 && isCurrentUrlTab(tab)) {
      currentUrlTabId = tab.id
      signalCurrentUrl(true)
    }
  },
  /** Return the active tab snapshot for Chrome's focused window. */
  async getCurrentUrl() {
    return await getCurrentUrlSnapshot()
  },
  reload() {
    chrome.runtime.reload()
  },
  async goto({msg}) {
    const domain = _.trim(msg.domain || msg.url || '')
    const hostname = getHostname(domain)
    if(!hostname) {
      return {success: false, reason: 'invalid_domain'}
    }

    const matchedTab = _.find(await chrome.tabs.query({}), tab => {
      const tabHostname = getHostname(tab.url)
      return tabHostname === hostname || _.endsWith(tabHostname, '.' + hostname)
    })
    if(!matchedTab) {
      return {success: false, reason: 'tab_not_found'}
    }

    tabs[matchedTab.id] = matchedTab
    await chrome.windows.update(matchedTab.windowId, {focused: true})
    await chrome.tabs.update(matchedTab.id, {active: true})
    const hwnd = await recordChromeHwnd(matchedTab.windowId)

    return {
      success: true,
      hwnd
    }
  },
  async topOffset({msg}) {
    if(msg.value !== undefined && topOffset !== msg.value) {
      topOffset = msg.value
      f.set('topOffset', topOffset)
      return
    }
    if(topOffset !== undefined) {
      return topOffset
    }
    
    return await f.get('topOffset')
  },
  async ratioSys({msg}) {
    let value = msg.value
    if(value) {
      if(ratioSysChrome !== value) {
        ratioSysChrome = value
        f.set('ratioSys', value)
      }
    } else {
      ratioSysChrome = ratioSysChrome || await f.get('ratioSys')
      return ratioSysChrome
    }
  },
  async close({tab}) {
    await bridge?.ready
    if(bridge?.settings.enabled && bridge.settings.automation && tab) chrome.tabs.remove(tab.id)
  },
  async sendToTab({msg}) {
    await send(msg.tabId, msg)
  },
  /** 在离屏页面加载完成后获取图片颜色. */
  async getImageColor({msg}) {
    await setupOffscreenDocument()
    return await f.sendToBackground('getImageColor', {...msg, dst: 'offscreen'})
  },
  isRunning() {
    return true
  },
  ping({msg}) {
    let urls = msg.urls
    if(!tasks_ || tasks !== urls) {
      tasks = urls
      tasks_ = _.split(_.trim(tasks), /\s*[\r\n,]+\s*/g)
      tasks_ = _.compact(tasks_)
    }
    _.forEach(tasks_, (v, i) => {
      if(!v) return
      fetch('https://' + v, {timeout: 1000}).then(r => {
      }).catch(e => {
      })
    })
  },
  allTabs({msg}) {
    if(!bridge?.settings.shareUrl) return {tabs: []}
    sendToFast({
      tabs: _.map(_.values(tabs), (v, k) => {
        return {
          id: v.id,
          title: v.title,
          url: v.url
        }
      }),
      tid: msg.tid,
    })
  },
  
  sendToFast({msg, frameId, tab}) {
    if(msg._type === 'currentUrl' || msg.type === 'currentUrl') {
      if(frameId === 0 && isCurrentUrlTab(tab)) {
        currentUrlTabId = tab.id
        signalCurrentUrl(true)
      }
      return
    }
    throw new Error('Page data must use its authenticated content channel')
  },
}

/**
 * Read a stable snapshot of the active tab in Chrome's focused window.
 */
async function getCurrentUrlSnapshot() {
  const revision = currentUrlRevision
  const failed = () => ({
    url: '',
    title: '',
    tabId: null,
    windowId: null,
    observedAt: Date.now(),
    revision: currentUrlRevision,
    focused: false,
  })

  try {
    const window = await chrome.windows.getLastFocused({populate: false})
    if(!bridge?.settings.shareUrl || revision !== currentUrlRevision || !window?.focused || window.id == null) return failed()

    const [tab] = await chrome.tabs.query({active: true, windowId: window.id})
    if(revision !== currentUrlRevision || !tab) return failed()

    const latestWindow = await chrome.windows.getLastFocused({populate: false})
    if(revision !== currentUrlRevision || !latestWindow?.focused || latestWindow.id !== window.id) return failed()

    const [latestTab] = await chrome.tabs.query({active: true, windowId: latestWindow.id})
    if(revision !== currentUrlRevision ||
      !latestTab ||
      latestTab.id !== tab.id ||
      latestTab.url !== tab.url ||
      latestTab.title !== tab.title) {
      return failed()
    }

    currentUrlWindowId = latestWindow.id
    currentUrlTabId = latestTab.id
    return {
      url: latestTab.url || '',
      title: latestTab.title || '',
      tabId: latestTab.id,
      windowId: latestWindow.id,
      observedAt: Date.now(),
      revision,
      focused: true,
    }
  } catch(e) {
    return failed()
  }
}

/** Check whether a content-script tab belongs to the tracked focused window. */
function isCurrentUrlTab(tab) {
  return !!tab?.active && currentUrlWindowId != null && tab.windowId === currentUrlWindowId
}

/**
 * Send a current URL signal, advancing the revision for invalidations.
 */
function signalCurrentUrl(invalidate) {
  if(invalidate) currentUrlRevision++
  const socket = self.__socket
  if(socket?.readyState !== 1 || !bridge?.settings.shareUrl) return

  try {
    socket.send(JSON.stringify({
      type: 'currentUrl',
      invalidate,
      __from: 'fastChromeBackground',
    }))
  } catch(e) {
  }
}

function getHostname(value) {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value).hostname.toLowerCase()
  } catch(e) {
    return ''
  }
}

// endregion

// region listener
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen.html' // 你的离屏 HTML 文件
let offscreenDocumentPromise

/** 复用正在进行的创建操作, 确保离屏页面已加载. */
async function setupOffscreenDocument() {
  if(!offscreenDocumentPromise) {
    offscreenDocumentPromise = chrome.offscreen.hasDocument().then(exists => {
      if(exists) return
      return chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ['BLOBS'], // 根据你的实际用途选择原因，例如 'BLOBS' 用于处理 Blob
        justification: 'Needed for image color analysis with canvas',
      })
    }).finally(() => {
      offscreenDocumentPromise = null
    })
  }
  await offscreenDocumentPromise
}



chrome.runtime.onInstalled.addListener(setupOffscreenDocument)
chrome.runtime.onStartup.addListener(setupOffscreenDocument)
if (typeof __FAST_BROWSER_DEV_BUILD__ !== 'undefined' && __FAST_BROWSER_DEV_BUILD__) void setupOffscreenDocument().catch(console.error)
// const result= {} // tid(时间戳_uid): data
// chrome.runtime.onMessage.addListener((msg, sender) => {
//   if(msg?.type === 'sendToTab') {
//     msgHandler[msg?.type]({msg, tab: sender.tab}).then()
//     return
//   }
//   if(msg.tid) {
//     result[msg.tid] = msg.data
//     return
//   }
//   if(msg?.type === 'getImageColor') return
//   const h = msgHandler[msg?.type]
//   if(!h) {
//     console.error(`UNKNOWN_TYPE ${msg?.type}`)
//     return
//   }
//   setTimeout(async () => {
//     msg.data = await h({msg, tab: sender.tab})
//     send(sender.tab?.tabId || settings.currentTabId, msg)
//   })
// })

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'developmentReload') {
    if (typeof __FAST_BROWSER_DEV_BUILD__ !== 'undefined' && __FAST_BROWSER_DEV_BUILD__ && sender.id === chrome.runtime.id && !sender.tab &&
        sender.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH) &&
        typeof msg.version === 'string' && /^[0-9a-f-]{36}$/.test(msg.version) &&
        Number.isSafeInteger(msg.builtAt) && msg.builtAt > __FAST_BROWSER_DEV_BUILD__.builtAt) {
      chrome.runtime.reload()
    }
    return
  }
  if(msg?.dst === 'offscreen' || ['bridgeGetSettings', 'bridgeSaveSettings'].includes(msg?.type)) return
  (async () => {
    try {
      if(sender.id !== chrome.runtime.id) throw new Error('Invalid extension sender')
      if(sender.tab && !['init', 'topOffset', 'ratioSys', 'close', 'getImageColor', 'isRunning', 'sendToFast', 'only'].includes(msg?.type)) throw new Error('Content action is not allowed')
      const h = Object.hasOwn(msgHandler, msg?.type) && msgHandler[msg?.type]
      if(!h) {
        sendResponse({ok: false, error: `UNKNOWN_TYPE ${msg?.type}`})
        return
      }
      const data = await h({msg, tab: sender.tab, frameId: sender.frameId})
      sendResponse({ok: true, data})
    } catch (e) {
      _error(e.message + '\n' + e.stack.toString())
      sendResponse({
        ok: false,
        type: e.type,
        error: e.message,
        stack: e.stack.toString()
      })
    }
  })()
  
  return true
})

let _log = console.log
console.log = function(...msg) {
  _log(...msg)
  sendCurrent({type: 'log', msg: msg}).then()
}
let _error = console.error
console.error = function(...msg) {
  _error(...msg)
  sendCurrent({type: 'error', msg: msg}).then()
}

self.onerror = function(errorMsg, url, lineNumber, column, errorObj) {
  console.error(errorMsg + '\n' + errorObj.stack)
  return true
}


const settings = {currentTabId: null}

// sender side
// async function send(tabId, msg, {timeout = 9000} = {}) {
//   let hasTid = msg.tid
//   if(!hasTid) {
//     msg.tid = new Date().getTime() + _.uniqueId('_')
//   }
//
//   try {
//     chrome.tabs.sendMessage(tabId, msg, () => { void chrome.runtime.lastError })
//   } catch(e) {
//
//   }
//
//   if(!hasTid) {
//     f.debounce('_1krme', () => {
//       for(let [k, v] of Object.entries(result || {})) {
//         let t = _.first(_.split(k, /_/g))
//         if(new Date() - new Date(parseInt(t)) > 120_000) {
//           _.unset(result, k)
//         }
//       }
//     }, {delay: 9000})
//     let t_ = new Date()
//     while (!_.has(result, msg.tid)) {
//       if(new Date() - t_ > timeout) return
//       await f.sleep(20)
//     }
//
//     return result[msg.tid].data
//   }
// }
function send(tabId, msg, {timeout = 5000} = {}) {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = callback => value => {
      if(done) return
      done = true
      clearTimeout(t)
      callback(value)
    }
    const resolveOnce = finish(resolve)
    const rejectOnce = finish(reject)
    const t = setTimeout(() => rejectOnce(new Error('TIMEOUT')), timeout)
    chrome.tabs.sendMessage(tabId, msg, res => {
      if(chrome.runtime.lastError) {
        rejectOnce(new Error(chrome.runtime.lastError.message))
        return
      }
      if(!res) {
        rejectOnce(new Error('NO_RESPONSE'))
        return
      }
      if(res.ok) {
        resolveOnce(res.data)
      } else {
        rejectOnce(new Error(res.error || 'UNKNOWN_ERROR'))
      }
    })
  })
}

async function sendCurrent(msg) {
  if(!settings.currentTabId) return
  return await send(settings.currentTabId, ...arguments)
}


chrome.tabs.onActivated.addListener((tab) => {
  const {tabId, windowId} = tab
  if(windowId === currentUrlWindowId) {
    currentUrlTabId = tabId
    signalCurrentUrl(true)
  }
  settings.currentTabId = tabId
  for (const observer of tabObservers) observer.activated?.(tabId)
  
  f.debounce('_nbp35', () => {
    chrome.tabs.query({}, ts => {
      let ts_ = []
      _.forEach(ts, (tab, i) => {
        let t_ = tabs[tab.id]
        tab = {
          ...t_,
          ...tab,
        }
        ts_.push(tab)
      })
      
      tabs = _.keyBy(ts_, 'id')
      
      for (const observer of tabObservers) observer.updated?.()
    })
  })
})

const port = chrome.runtime.connect()
port.onDisconnect.addListener(() => {
  if(chrome.runtime.lastError) {
  
  }
})
chrome.tabs.onRemoved.addListener(tabId => {
  _.unset(tabs, tabId)
  if(tabId === currentUrlTabId) {
    currentUrlTabId = null
    signalCurrentUrl(true)
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if(changeInfo.url === undefined && changeInfo.title === undefined && changeInfo.status === undefined) return
  tabs[tabId] = {...tabs[tabId], ...tab}
  if(tab?.active && (currentUrlWindowId == null || tab.windowId === currentUrlWindowId)) signalCurrentUrl(true)
})

chrome.windows.onFocusChanged.addListener(windowId => {
  currentUrlWindowId = windowId === chrome.windows.WINDOW_ID_NONE ? null : windowId
  currentUrlTabId = null
  signalCurrentUrl(true)
  if(windowId === chrome.windows.WINDOW_ID_NONE) return
  recordChromeHwnd(windowId).then()
})
// endregion
// region socket
let sendToFast = (msg) => {}
const pendingFastRequests = {}

async function recordChromeHwnd(windowId) {
  if(chromeHwnd === undefined) {
    const stored = await chrome.storage.local.get(chromeHwndStorageKey)
    chromeHwnd = stored[chromeHwndStorageKey] || ''
  }
  if(chromeHwnd) return chromeHwnd
  if(chromeHwndRequestPromise) return await chromeHwndRequestPromise

  chromeHwndRequestPromise = (async () => {
    const response = await requestFromFast({type: 'getChromeHwnd'})
    const hwnd = response?.hwnd || ''
    if(hwnd) {
      chromeHwnd = hwnd
      await chrome.storage.local.set({[chromeHwndStorageKey]: hwnd})
      return hwnd
    }

    try {
      const win = await chrome.windows.get(windowId)
      if(win.focused && !chromeHwnd) {
        setTimeout(() => recordChromeHwnd(windowId).then(), 200)
      }
    } catch(e) {
    }
    return ''
  })()
  try {
    return await chromeHwndRequestPromise
  } finally {
    chromeHwndRequestPromise = null
  }
}

function requestFromFast(msg, timeout = 1000) {
  const tid = _.uniqueId('chromeHwnd_')
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      _.unset(pendingFastRequests, tid)
      resolve()
    }, timeout)
    pendingFastRequests[tid] = response => {
      clearTimeout(timer)
      resolve(response)
    }
    sendToFast({...msg, tid})
  })
}

/** Start the shared authenticated bridge without changing current-URL reply correlation. */
function initSocket() {
  if(!self.WebSocket) return
  let currentUrlTimer
  bridge = installBrowserBridge({
    onPolicyChanged() {
      self.__socket = null
      currentUrlRevision++
    },
    onReady(socket) {
      self.__socket = socket
      socket.send(JSON.stringify({type: 'browserReady', __from: 'fastChromeBackground'}))
      signalCurrentUrl(true)
      if(!currentUrlTimer) currentUrlTimer = self.setInterval(() => signalCurrentUrl(false), 1000)
    },
    async onMessage(msg, socket) {
      if(msg?.type === 'browserPage') {
        await bridge.deliver(msg, socket)
        return
      }
      if(!msg || typeof msg !== 'object') return
      const pending = Object.hasOwn(pendingFastRequests, msg.tid) && pendingFastRequests[msg.tid]
      if(pending) {
        delete pendingFastRequests[msg.tid]
        pending(msg)
        return
      }
      const handler = Object.hasOwn(msgHandler, msg.type) && msgHandler[msg.type]
      if(!handler) return
      try {
        if(['reload', 'goto', 'ping', 'sendToTab', 'close', 'only'].includes(msg.type) && !bridge.settings.automation) throw new Error('Automation is disabled')
        const data = await handler({msg})
        if(data !== undefined && socket === self.__socket && socket?.readyState === 1) socket.send(JSON.stringify({ok: true, data: _.isObject(data) ? data : {result: data}, tid: msg.tid, __from: 'fastChromeBackground'}))
      } catch {
        if(socket === self.__socket && socket?.readyState === 1) socket.send(JSON.stringify({ok: false, error: 'Browser action failed', tid: msg.tid, __from: 'fastChromeBackground'}))
      }
    },
  })
  sendToFast = message => {
    if(typeof message === 'string') message = JSON.parse(message)
    if(message.type === 'currentUrl') {
      signalCurrentUrl(message.invalidate !== false)
      return
    }
    bridge.send({...message, __from: 'fastChromeBackground'})
  }
}


initSocket()
/** Register additional message handlers and tab lifecycle observers in this extension. */
export function registerBackground(install) {
  const observer = install({handlers: msgHandler, settings, getTabs: () => tabs})
  if (observer) tabObservers.add(observer)
}

// endregion
