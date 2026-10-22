const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', {fatal: true})
const limit = 2 * 1024 * 1024
const defaults = {port: 9072, enabled: true, shareUrl: true, pageContent: true, automation: true, sites: {}}
const reservedPageTypes = new Set(['constructor', 'prototype', 'onFocus', 'currentUrl', 'daemons', 'getChromeHwnd', 'clickOk', 'hasOk', 'focusOk', 'valueOk', 'getValueOk'])

/** Decode the fixed-size pairing material without accepting partial hexadecimal input. */
function fromHex(value) {
  if(typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('Invalid pairing material')
  return Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16))
}

/** Encode protocol bytes without exposing them in URLs or diagnostics. */
function toHex(value) {
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Bind authentication and traffic keys to the direction and both fresh challenges. */
async function signature(key, parts) {
  return crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(parts)))
}

/** Build an AES-GCM nonce and authenticated metadata for one ordered frame. */
function frameParameters(direction, sequence) {
  const iv = new Uint8Array(12)
  new DataView(iv.buffer).setBigUint64(4, BigInt(sequence))
  return {name: 'AES-GCM', iv, additionalData: encoder.encode(JSON.stringify(['fast-browser-bridge', direction, sequence]))}
}

/** Scope web grants to one origin and local-file grants to one exact document. */
function pageScope(value) {
  const url = new URL(value)
  if(['http:', 'https:'].includes(url.protocol)) return url.origin
  if(url.protocol === 'file:') {
    url.hash = ''
    url.search = ''
    return url.href
  }
  return ''
}

/** Accept only a local TCP port; the address, scheme and WebSocket path remain fixed. */
function validatePort(port) {
  if(!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WebSocket port must be an integer from 1 to 65535')
  return port
}

/** Validate a saved policy; website grants never come from content-script messages. */
function normalizeSettings(value) {
  const settings = {...defaults, sites: {}}
  settings.port = validatePort(value?.port === undefined ? defaults.port : value.port)
  for(const name of ['enabled', 'shareUrl', 'pageContent', 'automation']) settings[name] = value?.[name] === true
  const sites = Object.entries(value?.sites || {})
  if(sites.length > 200) throw new Error('Too many website grants')
  for(const [origin, grant] of sites) {
    if(!pageScope(origin) || pageScope(origin) !== origin) throw new Error('Invalid website origin')
    const pageTypes = grant.pageTypes || []
    if(!Array.isArray(pageTypes) || pageTypes.length > 30 || !pageTypes.every(type => /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(type) && !reservedPageTypes.has(type))) {
      throw new Error('Invalid website message types')
    }
    settings.sites[origin] = {sensitiveValues: grant.sensitiveValues === true, userScripts: grant.userScripts === true, pageTypes: [...new Set(pageTypes)]}
  }
  return settings
}

/** Authenticate the local service before sending any page data, then encrypt ordered traffic. */
export function createEncryptedConnection({key, keyMode, clientId, port = defaults.port, onMessage, onReady, onClose}) {
  const socket = new WebSocket(`ws://127.0.0.1:${validatePort(port)}/ws1`)
  const clientNonce = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const hmacKey = crypto.subtle.importKey('raw', fromHex(key), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify'])
  let phase = 0
  let transmitKey, receiveKey
  let sent = 0, received = 0, pendingSends = 0, pendingReceives = 0
  let outgoing = Promise.resolve(), incoming = Promise.resolve()
  const timer = setTimeout(() => socket.close(1008, 'Pairing required'), 5000)
  const connection = {
    get readyState() {
      return phase === 3 && socket.readyState === WebSocket.OPEN ? 1 : 0
    },
    /** Queue a bounded encrypted message without retaining disconnected page data. */
    send(raw) {
      if(connection.readyState !== 1 || pendingSends >= 100) return false
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      const bytes = encoder.encode(text)
      if(bytes.length > limit) throw new Error('Bridge message too large')
      pendingSends++
      let delivered = false
      outgoing = outgoing.then(async () => {
        if(connection.readyState !== 1) return
        const sequence = ++sent
        if(!Number.isSafeInteger(sequence)) throw new Error('Bridge session expired')
        const encrypted = new Uint8Array(await crypto.subtle.encrypt(frameParameters('clientToServer', sequence), transmitKey, bytes))
        let binary = ''
        for(let offset = 0; offset < encrypted.length; offset += 16384) binary += String.fromCharCode(...encrypted.subarray(offset, offset + 16384))
        socket.send(JSON.stringify({type: 'bridgeFrame', sequence, ciphertext: btoa(binary)}))
        delivered = true
      }).catch(() => socket.close(1008, 'Bridge authentication failed')).finally(() => pendingSends--)
      return outgoing.then(() => delivered)
    },
    /** Revoke the entire connection before policy or pairing material changes. */
    close() {
      phase = -1
      socket.close()
    },
  }
  socket.onopen = () => socket.send(JSON.stringify({type: 'bridgeHello', protocol: 1, clientId, clientNonce, ...(keyMode ? {keyMode} : {})}))
  socket.onmessage = event => {
    if(++pendingReceives > 32) {
      socket.close(1008, 'Bridge receive limit exceeded')
      return
    }
    incoming = incoming.then(async () => {
      if(typeof event.data !== 'string' || event.data.length > limit * 2) throw new Error('Invalid bridge frame')
      const message = JSON.parse(event.data)
      if(phase === 0) {
        if(message.type !== 'bridgeChallenge' || message.protocol !== 1) throw new Error('Invalid challenge')
        const serverNonce = toHex(fromHex(message.serverNonce))
        const parts = [clientId, clientNonce, serverNonce]
        if(!await crypto.subtle.verify('HMAC', await hmacKey, fromHex(message.proof), encoder.encode(JSON.stringify(['server', ...parts])))) {
          throw new Error('Untrusted local service')
        }
        transmitKey = await crypto.subtle.importKey('raw', await signature(await hmacKey, ['clientToServer', ...parts]), 'AES-GCM', false, ['encrypt'])
        receiveKey = await crypto.subtle.importKey('raw', await signature(await hmacKey, ['serverToClient', ...parts]), 'AES-GCM', false, ['decrypt'])
        phase = 1
        socket.send(JSON.stringify({type: 'bridgeProof', proof: toHex(await signature(await hmacKey, ['client', ...parts]))}))
        return
      }
      if(message.type !== 'bridgeFrame' || !Number.isSafeInteger(message.sequence) || message.sequence !== received + 1 ||
        typeof message.ciphertext !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.ciphertext)) throw new Error('Invalid frame sequence')
      const ciphertext = Uint8Array.from(atob(message.ciphertext), char => char.charCodeAt(0))
      if(ciphertext.length < 16 || ciphertext.length > limit + 16) throw new Error('Invalid frame size')
      const plaintext = await crypto.subtle.decrypt(frameParameters('serverToClient', message.sequence), receiveKey, ciphertext)
      const data = JSON.parse(decoder.decode(plaintext))
      received = message.sequence
      if(phase === 1) {
        if(data?.type !== 'bridgeReady') throw new Error('Invalid ready message')
        phase = 3
        clearTimeout(timer)
        onReady()
      } else if(phase === 3) {
        Promise.resolve(onMessage(data)).catch(() => {})
      }
    }).catch(() => socket.close(1008, 'Bridge authentication failed')).finally(() => pendingReceives--)
  }
  socket.onclose = () => {
    phase = -1
    clearTimeout(timer)
    onClose()
  }
  socket.onerror = () => socket.close()
  return connection
}

/** Own automatic native bootstrap, local consent and document-scoped routing. */
export function installBrowserBridge({onMessage, onReady, onPolicyChanged}) {
  let settings = {...defaults, sites: {}}
  let key = '', keyMode = '', connection, retryTimer, generation = 0
  const pages = new Map()
  const ready = chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}).then(async () => {
    const stored = await chrome.storage.local.get(['bridgeKey', 'bridgeKeyMode', 'bridgeSettings', 'bridgePaused'])
    key = stored.bridgeKey || ''
    keyMode = stored.bridgeKeyMode === 'native-v1' ? 'native-v1' : ''
    if(stored.bridgeSettings) settings = normalizeSettings(stored.bridgeSettings)
    if(stored.bridgePaused === true) settings.enabled = false
    if(!stored.bridgeSettings) await chrome.storage.local.set({bridgeSettings: settings})
    reconnect()
  })
  ready.catch(() => {})

  /** Return only the current page's grant, never the pairing key or another site's data. */
  function policy(page) {
    return {generation, enabled: settings.enabled && !!key, pageContent: settings.pageContent,
      automation: settings.automation, ...(settings.sites[page.origin] || {})}
  }

  /** Bootstrap through Chrome's exact native-host allowlist before authenticating the socket. */
  async function reconnect() {
    const version = ++generation
    clearTimeout(retryTimer)
    connection?.close()
    connection = null
    onPolicyChanged()
    for(const page of pages.values()) page.port.postMessage({kind: 'policy', policy: policy(page)})
    if(!settings.enabled) return
    if(!key || keyMode === 'native-v1') {
      try {
        const response = await chrome.runtime.sendNativeMessage('com.fastgoto.browser', {version: 1, type: 'connect'})
        if(version !== generation) return
        if(response?.ok !== true || response.version !== 1 || response.keyMode !== 'native-v1' ||
          typeof response.key !== 'string' || !/^[0-9a-f]{64}$/.test(response.key)) throw new Error('Local connection unavailable')
        key = response.key
        keyMode = 'native-v1'
        await chrome.storage.local.set({bridgeKey: key, bridgeKeyMode: keyMode})
        if(version !== generation) return
        for(const page of pages.values()) page.port.postMessage({kind: 'policy', policy: policy(page)})
      } catch {
        if(version !== generation) return
        if(!key) {
          retryTimer = setTimeout(reconnect, 5000)
          return
        }
      }
    }
    if(!/^[0-9a-f]{64}$/.test(key)) return
    const session = createEncryptedConnection({key, keyMode, clientId: chrome.runtime.id, port: settings.port,
      onMessage(data) {
        if(version === generation) return onMessage(data, session)
      },
      onReady() {
        if(version !== generation) return
        onReady(session)
        for(const page of pages.values()) page.port.postMessage({kind: 'connected'})
      },
      onClose() {
        if(version === generation) retryTimer = setTimeout(reconnect, 1500)
      },
    })
    connection = session
  }

  const bridge = {
    ready,
    get readyState() { return connection?.readyState || 0 },
    get settings() { return settings },
    /** Send only during a mutually authenticated session. */
    send(message) {
      return connection?.send(message) || false
    },
    /** Apply a local command to the exact live page channel selected by the runtime. */
    async deliver(message, source) {
      const page = pages.get(message.channel)
      if(!page || source !== connection || source.readyState !== 1 || !settings.enabled || !settings.automation) return
      const version = generation
      const data = message.data
      if(!data || typeof data !== 'object' || typeof data.type !== 'string') return
      if(['getValue', 'getMathJax', 'eval_'].includes(data.type) && !settings.pageContent) return
      if(data.type === 'eval_') {
        const grant = settings.sites[page.origin]
        try {
          if(!grant?.userScripts || !page.documentId || typeof data.data !== 'string' || data.data.length > 256 * 1024 || !chrome.userScripts?.execute) {
            throw new Error('Enable user scripts for this website in the extension popup and Chrome extension details')
          }
          const tab = await chrome.tabs.get(page.tabId)
          if(version !== generation || source !== connection || pageScope(tab.url) !== page.origin) throw new Error('The target page changed')
          const result = await chrome.userScripts.execute({target: {tabId: page.tabId, documentIds: [page.documentId]}, js: [{code: data.data}], world: 'USER_SCRIPT'})
          if(result[0]?.error) throw new Error('The user script failed')
          if(data.tid && version === generation && source === connection) source.send({type: 'browserPage', channel: message.channel, data: {tid: data.tid, value: result[0]?.result, __from: 'fastExtension'}})
        } catch(error) {
          if(version === generation && source === connection) source.send({type: 'browserPage', channel: message.channel, data: {type: 'error', msg: error.message, tid: data.tid, __from: 'fastExtension'}})
        }
        return
      }
      page.port.postMessage({kind: 'command', message: {...data, _bridgeGeneration: generation, _allowSensitive: policy(page).sensitiveValues === true}})
    },
  }

  chrome.runtime.onConnect.addListener(port => {
    if(port.name !== 'fast-browser-content' || port.sender?.id !== chrome.runtime.id || !port.sender.tab || port.sender.frameId !== 0) return
    let url
    try { url = new URL(port.sender.url) } catch { return }
    const scope = pageScope(url.href)
    if(!scope) return
    if(pages.size >= 1000) return
    const channel = crypto.randomUUID()
    const page = {port, origin: scope, tabId: port.sender.tab.id, documentId: port.sender.documentId, title: port.sender.tab.title || '', timeFocus: 0}
    pages.set(channel, page)
    ready.then(() => port.postMessage({kind: 'policy', policy: policy(page)})).catch(() => {})
    /** Validate each document packet before passing it to the trusted service. */
    async function receive(packet) {
      const message = packet?.message
      if(!settings.enabled || !key || !message || typeof message !== 'object' || Array.isArray(message)) return
      if(JSON.stringify(message).length > limit) return
      if(packet.kind === 'pageEvent') {
        if(!settings.pageContent || !settings.sites[page.origin]?.pageTypes?.includes(message.type)) return
        const data = {...message, timeFocus: 0, __from: 'fastExtension'}
        delete data.tid
        if(!settings.shareUrl) { delete data.url; delete data.title }
        return await bridge.send({type: 'browserPage', channel, data})
      }
      if(packet.kind !== 'message') return
      if(message._bridgeGeneration !== undefined && message._bridgeGeneration !== generation) return
      if(!settings.pageContent && !['onLoad', 'onFocus', 'daemons', 'chromeRefresh', 'clickOk', 'hasOk', 'focusOk', 'inputOk', 'error'].includes(message.type)) return
      if(message.type === 'currentUrl') return
      if(message.type === 'onFocus') {
        const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true})
        const window = await chrome.windows.getLastFocused()
        if(!window.focused || tab?.id !== page.tabId) return
        page.timeFocus = Date.now()
      }
      page.title = typeof message.title === 'string' ? message.title.slice(0, 4096) : page.title
      const data = {...message, timeFocus: page.timeFocus, title: settings.shareUrl ? page.title : '', __from: 'fastExtension'}
      delete data._bridgeGeneration
      if(!settings.shareUrl) delete data.url
      return await bridge.send({type: 'browserPage', channel, data})
    }
    port.onMessage.addListener(packet => {
      void receive(packet).then(delivered => {
        if(packet?.id) port.postMessage({kind: 'receipt', id: packet.id, delivered: delivered === true, retryable: bridge.readyState !== 1 && settings.enabled})
      }).catch(() => {})
    })
    port.onDisconnect.addListener(() => {
      pages.delete(channel)
      bridge.send({type: 'browserPageClosed', channel})
    })
  })

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if(!['bridgeGetSettings', 'bridgeSaveSettings'].includes(message?.type)) return
    if(sender.id !== chrome.runtime.id || sender.tab || !['src/popup/index.html', 'src/sidepanel/index.html'].some(path => sender.url === chrome.runtime.getURL(path))) {
      respond({ok: false, error: 'Only the extension settings page can change pairing or consent'})
      return
    }
    void (async () => {
      await ready
      if(message.type === 'bridgeSaveSettings') {
        const nextSettings = normalizeSettings(message.settings)
        const nextKey = message.key ? toHex(fromHex(message.key.trim())) : key
        const nextKeyMode = message.key ? '' : keyMode
        await chrome.storage.local.set({bridgeKey: nextKey, bridgeKeyMode: nextKeyMode,
          bridgeSettings: nextSettings, bridgePaused: !nextSettings.enabled})
        settings = nextSettings
        key = nextKey
        keyMode = nextKeyMode
        reconnect()
      }
      const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true})
      let origin = ''
      try { origin = pageScope(tab?.url) } catch {}
      respond({ok: true, data: {paired: !!key, connected: bridge.readyState === 1, settings, origin}})
    })().catch(() => respond({ok: false, error: 'Could not save settings. Check the pairing code and website grants.'}))
    return true
  })
  return bridge
}
