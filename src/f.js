import _ from 'lodash'
import * as f from '@/f'

const cbSymbol = Symbol()
self[cbSymbol] = {}


// 热更新 content-script
if (false) {
  

  (async () => {
    let mod = await import('@/content-script/index.js');
    mod.default?.();
    mod = await import('@/offscreen.js');
    mod.default?.();
  })();
}


export function once(key, callback, options = {}) {
  options.args = options.args || []
  let cb = _.get(self[cbSymbol], `${key}`)
  if(!cb) {
    cb = _.once(callback)
    _.set(self[cbSymbol], `${key}`, cb)
  }
  cb(...options.args)
}

/**
 * 短时间内只执行最后一次 (不重复执行多次)
 * @param key
 * @param callback
 */
export function debounce(key, cb, options = {}) {
  let ctx = self[cbSymbol]
  if(_.isNumber(options)) {
    options = {
      delay: options
    }
  }

  options.delay = options.delay || 150
  options.args = options.args || []

  ctx['__cb' + key] = cb

  if(!ctx[key]) {
    ctx[key] = _.debounce(() => ctx['__cb' + key](...arguments), options.delay, options)
  }
  ctx[key](...options.args)
}

let timeout=6000
export let msgs={}
export async function getReturn(tid) {
  let t_ = new Date()
  while (!_.has(msgs, tid)) {
    if(new Date() - t_ > timeout) {
      return
    }
    await f.sleep(20)
  }

  return _.get(msgs, tid)
}
export function addMsg(msg) {
  if (msg.tid) {
    f.debounce('_0ezb2', () => {
      for (let [k, v] of Object.entries(msgs || {})) {
        if (v.__time && new Date() - v.__time > 20) {
          _.unset(msgs, k)
        }
      }
    }, {delay: 3000})
    msg.__time = new Date()
    msgs[msg.tid] = msg
  }
}
/**
 * 短时间内只执行最后一次 (不重复执行多次)
 * @param key
 * @param callback
 */
export function throttle(key, cb, options = {}) {
  let ctx = self[cbSymbol]
  if(_.isNumber(options)) {
    options = {
      delay: options
    }
  }

  options.delay = options.delay || 150
  options.args = options.args || []
  ctx['__cb' + key] = cb
  if(!ctx[key]) {
    ctx[key] = _.throttle(() => ctx['__cb' + key](...arguments), options.delay, options)
  }
  ctx[key](...options.args)
}



export function sleep(delay) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, delay)
  })
}

export function setCookie(name, value, exseconds = 0) {
  var d = new Date()

  if (exseconds > 0) {
    d.setTime(d.getTime() + exseconds)
    var expires = 'expires=' + d.toGMTString()
    document.cookie = name + '=' + value + '; ' + expires
  } else {
    document.cookie = name + '=' + value + '; '
  }

}


export function getCookie(cname) {
  var name = cname + '='
  var ca = document.cookie.split(';')
  for (var i = 0; i < ca.length; i++) {
    var c = ca[i].trim()
    if (c.indexOf(name) == 0) return c.substring(name.length, c.length)
  }
  return ''
}


export function set(k,v) {
  if(_.isObject(k) && !_.isArray(k)) {
    chrome.storage.local.set(k, () => {
      if (chrome.runtime.lastError) {
      }
    })
  } else {
    chrome.storage.local.set({ [k]:v }, () => {
      if (chrome.runtime.lastError) {
      }
    })
  }
}

export function get(k) {
  let multiple = _.size(arguments)>1;
  let keys= multiple ? arguments : [k]
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, function (result) {
      resolve(multiple ? result : result[k])
    })
  })
}

// export const result={} // tid(时间戳_uid): data
// export async function sendToBackground(type, msg = {}, {timeout = 9000} = {}) {
//   let hasTid = msg.tid
//   if(!hasTid) {
//     msg.tid = new Date().getTime() + _.uniqueId('_')
//   }
//   msg.type = type
//   try {
//     chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError })
//   } catch(e) {
//
//   }
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
//     return result[msg.tid]
//   }
// }
export function sendToBackground(type, msg = {}, opts = {}) {
  const { timeout = 8000, dst } = opts
  const __id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`
  const payload = { type, __id, ...(dst ? { dst } : {}), ...msg }
  
  let _e = new Error()
  let fromFile = _.split(_e.stack.toString(), /\r?\n/g)[2]
  fromFile = _.first(fromFile.match(/(?<=(\s+|\())\S+\)?$/)||[''])
  const makeError = (title, extra = {}) => {
    // 把错误消息拼进去
    const detail = extra.message || extra.stack || title
    const e = new Error(`${detail}\n${fromFile}`)
    e.name = `SendToBackground [${type}]`
    e.payload = payload
    return e
  }
  
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      reject(makeError('TIMEOUT', {}))
    }, timeout)
    
    chrome.runtime.sendMessage(payload, (res) => {
      const le = chrome.runtime.lastError
      if (done) return
      done = true
      clearTimeout(timer)
      if (le) {
        return reject(makeError('RUNTIME_ERROR', {message: le.message}))
      }
      if (!res || typeof res.ok !== 'boolean') {
        return reject(makeError('BAD_RESPONSE', { message: 'no valid response' }))
      }
      if (!res.ok) {
        const title = res.code || 'EXCEPTION'
        return reject(makeError(title, {
          code: res.code,
          message: res.error,
          stack: res.stack||'',
        }))
      }
      resolve(res.data)
    })
  })
}
export function close() {
  sendToBackground('close')
}

export function inUrl (key) {
  return new RegExp(`\.${_.replace(key, /(^\.|\.$)/g, '')}(\.|\/)`, 'g').test(window.location.href)
}

export function isInFrame () {
  return parent!==window
}

export function onLoad (cb) {
  if(document.readyState === 'loading') {
    window.addEventListener('load', async () => {
      await cb()
    })
  } else {
    setTimeout(async () => {
      await cb()
    })
  }
}
export async function isFullscreen() {
  let ratioSys = await sendToBackground('ratioSys')
  return screen.height-window.innerHeight/(ratioSys/window.devicePixelRatio)<10
}
