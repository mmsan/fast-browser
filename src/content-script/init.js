// noinspection CssInvalidPseudoSelector

import $ from 'jquery'
import 'babel-polyfill'
import * as f from '@/f'
import {sendToBackground} from '@/f'
import _ from 'lodash'

if (typeof __FAST_BROWSER_DEV_BUILD__ !== 'undefined' && __FAST_BROWSER_DEV_BUILD__ && window.top === window) {
  setInterval(() => {
    if (!chrome.runtime.id) window.location.reload()
  }, 1000)
}

window.f = f
window._ = _


window.addEventListener('send', ({detail}) => {
  try {
    const message = typeof detail === 'string' ? JSON.parse(detail) : detail
    contentPort?.postMessage({kind: 'pageEvent', message})
  } catch {}
})


// region onMsg
let socketHandler = {
  /**
   * fast.js ➞ name ➞ 操作 name 元素
   * @param data
   */
  run: ({data}) => {
    if(buttonKv[data.name]) {
      if($(buttonKv[data.name]).is('input')) {
        buttonKv[data.name].focus()
      } else {
        try {
          $(buttonKv[data.name]).children().get(0).click()
        } catch (e) {
          buttonKv[data.name].click()
        }
      }
      
      selectText(buttonKv[data.name])
      let topV = $(buttonKv[data.name]).offset()
      topV && $('html, body').animate({
        scrollTop: topV.top - 100
      }, 100)
      
      lastCtrlDown = new Date(0)
    }
  },
  edit: () => {
    document.body.contentEditable = 'true'
  },
  
  // User-provided scripts are executed by the background's permission-gated userScripts API.
  
  refresh: () => {
    if(isFocus) {
      window.location.reload()
    }
  },
  toBottom: () => {
    if(isFocus) {
      f.setCookie('toBottomTime', new Date().getTime())
    }
  },
  getMathJax: ({html}, reply = send) => {
    let ls = getMathJax(html, 'alt', 'data-tex')
    if(_.size(ls) === 0) return
    
    reply({
      type: 'cmds',
      name: 'mathJax',
      data: ls.join('❄')
    })
  },
  async click({selector, file, mutible}, reply = send) {
    if(!mutible && selector === lastClickSelectorSw && new Date() - lastClickTimeSw < 3000) {
      return
    }
    
    if(_.isNil(selector)) {
      reply({type: 'error', msg: `selector 不能为空\ntype: chrome click 异常\nfile: ${file}`})
      return
    }
    let el = $(selector)
    if(!_.size(el)) {
      return
    }
    
    lastClickTimeSw = new Date()
    lastClickSelectorSw = selector
    if(_.includes(selector, 'contains')) {
      let has = false
      el.each((i, e) => {
        if(has) return
        if(!_.size($(e).find(selector))) {
          has = true
          e.click()
          reply({type: 'clickOk'})
        }
      })
      return
    }
    el.get(0).click()
    reply({type: 'clickOk'})
  },
  async has({selector, file}, reply = send) {
    if(_.isNil(selector)) {
      reply({type: 'error', msg: `selector 不能为空\ntype: chrome has 异常\nfile: ${file}`})
      return
    }
    let el = $(selector)
    
    
    reply({type: 'hasOk', result: !!_.size(el)})
  },
  async getValue({selector, file, isImmediately, _allowSensitive}, reply = send) {
    if(_.isNil(selector)) {
      reply({type: 'error', msg: `selector 不能为空\ntype: chrome getValue 异常\nfile: ${file}`})
      return
    }
    let el = $(selector)
    if(!_.size(el)) {
      if(isImmediately) {
        reply({type: 'getValueOk', result: null})
      }
      return
    }
    const element = el.get(0)
    const sensitive = element.type === 'password' || /(?:password|one-time-code|cc-number|cc-csc)/i.test(element.autocomplete || '')
    if(sensitive && !_allowSensitive) {
      reply({type: 'getValueOk', result: null, error: 'Sensitive input access is not enabled for this website'})
      return
    }
    reply({type: 'getValueOk', result: element.value || element.innerText})
  },
  sysRatio({ratio}) {
    window.sysRatio = ratio
  },
  async position({selector, file, height}) {
    if(!isFocus) return
    let ratioSys = await sendToBackground('ratioSys')
    let isMax = height / ratioSys >= screen.height
    let topOffset = screen.height*ratioSys - window.innerHeight *window.devicePixelRatio
    if(isMax) {
      f.sendToBackground('topOffset', {value: topOffset}).then()
    } else {
      topOffset = await f.sendToBackground('topOffset')
    }
    let el = $(selector)
    function fix(d) {
      return parseInt(d * window.devicePixelRatio)
    }
    
    function rect(r) {
      return {
        top: fix(r.top) + topOffset,
        left: fix(r.left),
        right: fix(r.right),
        bottom: fix(r.bottom) + topOffset,
        x: fix(r.x),
        y: fix(r.y) + topOffset,
        width: fix(r.width),
        height: fix(r.height),
      }
    }
    
    if(_.size(el) > 1) {
      let ls = _.map(el, (v, k) => {
        let r = v.getBoundingClientRect()
        return rect(r)
      })
      
      let ls_ = [...ls]
      _.remove(ls, (v, i) => v.bottom < 0)
      if(!_.size(ls)) {
        ls = ls_
      }
      
      ls = _.take(ls, 10)
      return ls
    }
    
    if(_.size(el)) {
      let r = el[0].getBoundingClientRect()
      return rect(r)
    }
  },
  async focus({selector, file}, reply = send) {
    if(_.isNil(selector)) {
      reply({type: 'error', msg: `selector 不能为空\ntype: chrome find 异常\nfile: ${file}`})
      return
    }
    let el = $(selector)
    if(!_.size(el)) {
      return
    }
    
    if(_.includes(selector, 'contains')) {
      let has = false
      el.each((i, e) => {
        if(has) return
        if(!_.size($(e).find(selector))) {
          has = true
          $(e).focus()
          reply({type: 'focusOk'})
        }
      })
      return
    }
    el.get(0).focus()
    reply({type: 'focusOk'})
  },
  async input({selector, file, value, _bridgeGeneration}, reply = send) {
    if(_.isNil(selector)) {
      reply({type: 'error', msg: `selector 不能为空\ntype: chrome find 异常\nfile: ${file}`})
      return
    }
    let el = $(selector)
    let t_ = new Date()
    while (!(_.size(el))) {
      if(new Date() - t_ > 6000) break
      await f.sleep(20)
      el = $(selector)
    }
    if(!_.size(el)) {
      return
    }
    
    if(!bridgePolicy.enabled || !bridgePolicy.automation || bridgePolicy.generation !== _bridgeGeneration) return
    if(_.includes(selector, 'contains')) {
      let has = false
      el.each((i, e) => {
        if(has) return
        if(!_.size($(e).find(selector))) {
          has = true
          $(e).val(value)
          reply({type: 'inputOk'})
        }
      })
      return
    }
    if(!bridgePolicy.enabled || !bridgePolicy.automation || bridgePolicy.generation !== _bridgeGeneration) return
    el.val(value)
    reply({type: 'inputOk'})
  },
}
/**
 * Registers content-script handlers with the existing WebSocket dispatcher.
 * @param {Object<string, Function>} handlers Message type handlers.
 */
export function registerSocketHandlers(handlers) {
  Object.assign(socketHandler, handlers)
}

const msgHandler = {
  log({msg}) {
    console.log(...msg.msg)
  },
  error({msg}) {
    console.error(...msg.msg)
  },
}

// chrome.runtime.onMessage.addListener((msg) => {
//   if(msg.tid) {
//     f.result[msg.tid] = msg.data
//     return
//   }
//   if(!msgHandler[msg?.type]) return
//   setTimeout(async () => {
//     msg.data = await msgHandler[msg?.type]({msg})
//     f.sendToBackground('__result', msg)
//   })
// })

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msgHandler[msg?.type]) return
  (async () => {
    try {
      const h = msgHandler[msg?.type]
      const data = await h({ msg })
      sendResponse({ ok: true, data })
    } catch (e) {
      sendResponse({
        ok: false,
        error: e.message,
        stack:e?.stack?.toString?.()
      })
    }
  })()
  
  return true
})
// endregion
// region init

function notifyBackgroundReady() {
  f.sendToBackground('init').catch(console.error)
}

if(document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', notifyBackgroundReady, {once: true})
} else {
  notifyBackgroundReady()
}


window._ = _
window.xxx = _

// endregion
// region event

let contentPort
let bridgePolicy = {enabled: false, pageContent: false, automation: false}
let isOnInput = false
let keys = {}

init_()

function init_() {
  if(!f.isInFrame()) {
    initSocket()
    hotkey()
  }
  commonSettings()
}

document.addEventListener('visibilitychange', function() {
  if(!document.hidden) {
    // sendCmds()
    onFocus()
  }
})

window.addEventListener('beforeunload', function(event) { // 网页刷新
  send(JSON.stringify({
    type: 'chromeRefresh',
    data: {
      time: new Date().getTime()
    }
  }))
})


f.onLoad(function(event) {
  // 网页刷新
  send({
    type: 'onLoad',
  })
  toBottomTask()
})

let lastUrl = window.location.href
window.addEventListener('click', () => {
  if(lastUrl === window.location.href) return
  lastUrl = window.location.href
  sendToBackground('sendToFast', {
    _type: 'currentUrl',
    url: window.location.href,
    title: window.document.title,
  })
})
sendToBackground('sendToFast', {
  _type: 'currentUrl',
  url: window.location.href,
  title: window.document.title,
})

export let isFocus = true
let timeFocus = new Date()
window.addEventListener('focus', () => {
  timeFocus = new Date()
  isFocus = true
  send({
    type: 'onFocus'
  })
  send({type: 'currentUrl', url: window.location.href})
})
window.addEventListener('blur', () => {
  timeFocus = new Date()
  isFocus = false
})
// endregion
// region common
let lastClickTime = _.now() - 5000

function click(el) {
  el = $(el)[0]
  let {x, y, height, width} = el.getBoundingClientRect()
  
  if(new Date() - lastClickTime > 5000) {
    lastClickTime = _.now()
    send(JSON.stringify({
      type: 'cmds',
      name: 'click',
      x: x + parseInt(width / 2),
      y: y + 74 + parseInt(height / 2),
    }))
  }
}

window.click = click
// endregion
// region socket
let lastClickTimeSw = new Date(0)
let lastClickSelectorSw = ''

function getMathJax(html, ...props) {
  let ls = []
  html = $(html)
  _.forEach(props, (prop, i) => {
    if(_.size(html) < 5) {
      _.forEach(html, (v, i) => {
        let mathJax = $(v).attr(prop)
        if(_.includes(mathJax, '=')) {
          ls.push(mathJax)
        }
      })
    }
    
    _.forEach(html.find(`*[${prop}*="="]`), (v, i) => {
      ls.push($(v).attr(prop))
    })
  })
  
  return _.uniq(ls)
}

/**
 * 去除 数量信息
 * @param e
 * @param name
 * @returns {*|string}
 */
function getNameNoNum(e) {
  let title = $(e).attr('title')
  if(title) return title
  
  let name = e.innerText
  let nums = []
  $(e).children().each((i, ee) => {
    if(ee.innerText) {
      let text = ee.innerText.trim()
      if(/^\d+$/g.test(text)) {
        nums.push(text)
      }
    }
  })
  
  for(let num of nums) {
    name = name.replace(num, '')
  }
  return name
}

window.buttonKv = window.buttonKv || {} // [name] ➞ e
let adds = new WeakMap() // element ➞ name

/**
 * 添加命令
 * @param e
 * @param name
 */
function addCmd(e, name) {
  if(adds.has(e)) {
    const existingName = adds.get(e)
    if(existingName !== null) {
      buttonKv[existingName] = e
    }
    return
  }
  adds.set(e, null)
  
  if($(e).is(':hidden')) return
  if($(e).parent().is(':hidden')) return
  if($(e).parent().parent().is(':hidden')) return
  if($(e).parent().parent().parent().is(':hidden')) return
  
  if(!name) {
    name = getNameNoNum(e)
  }
  
  if(!name) {
    name = e.title
  }
  
  name = name.replace(/[^\u4E00-\u9FA5A-Za-z0-9]+/g, ' ')
  name = name.replace(/[\n\r]/g, '')
  name = name.replace(/\s+/g, ' ')
  name = name.trim()
  
  let isTooLong = name.length > 50
  if(isTooLong) {
    if($(e).parent().is('h1,h2,h3') ||
      $(e).parent().parent().is('h1,h2,h3') ||
      $(e).parent().parent().parent().is('h1,h2,h3')) {
      isTooLong = false
    }
  }
  
  if(isTooLong) {
    name = name.substr(0, 29).trim() + '...' + name.substr(-20).trim()
  }
  if(name && !/^\d+$/g.test(name)) {
    if(!buttonKv[name]) {
      buttonKv[name] = e
      adds.set(e, name)
    }
  }
}


/**
 * 命令 ➞ fast.js
 */
function sendCmds() {
  $('a,button').each((i, e) => {
    addCmd(e)
  })
  
  // 注意 不能和上面合并  ➞ 有优先顺序
  $('li,ul,ol').each((i, e) => {
    let name = getNameNoNum(e)
    
    $(e).find('li,ul,ol').each((i, e) => {
      name = name.replace(e.innerText, '')
    })
    
    addCmd(e, name)
  })
  
  $('h1,h2,h3,p').each((i, e) => {
    addCmd(e)
  })
  
  $('input').each((i, e) => {
    let name = $(e).attr('placeholder')
    if(name) {
      addCmd(e, name)
    }
  })
  
  $('div,span').each((i, e) => {
    if($(e).find('div,a,button,li').length === 0) {
      addCmd(e)
    }
  })
  
  send(JSON.stringify({
    type: 'cmds',
    data: {
      buttons: Object.keys(buttonKv)
    }
  }))
  
  // 下载状态栏是否显示
  if(window.outerHeight - window.innerHeight > 120) {
    send(JSON.stringify({
      type: 'downloadShow',
    }))
  }
  
}

let lastCtrlDown = new Date(0)


function onFocus() {
  let send = window.send || (() => {
  })
  send(JSON.stringify({
    type: 'cmds',
    data: {
      buttons: []
    }
  }))
}

onFocus()

let isAutoScroll = false
let scrollTask
let isStartScrollTask = false

function toBottomTask() {
  let t = f.getCookie('toBottomTime')
  if(!t) return
  
  if(/^\d+$/g.test(t)) {
    if(new Date() - new Date(parseInt(t)) > 6000) return
  }
  var i = 1
  var element = document.documentElement
  let tt = new Date()
  scrollTask = setInterval(() => {
    isStartScrollTask = true
    isAutoScroll = true
    if(element.scrollTop + element.clientHeight + 5 >= element.scrollHeight) {
      if(new Date() - tt > 3500) {
        clearInterval(scrollTask)
      }
    } else {
      
      element.scrollTop += 30500
      i += 1
    }
  }, 100)
}

window.addEventListener('scroll', (e) => {
  if(isAutoScroll) {
    isAutoScroll = false
  } else {
    if(isStartScrollTask) {
      clearInterval(scrollTask)
      isStartScrollTask = false
    }
  }
}, true)

function send() {
  return window.send(...arguments)
}

_.xxx = 1
setTimeout(() => {
  window.document.defaultView.xxx = 1
}, 2000)

// var s = document.createElement('script')
// s.src = chrome.runtime.getURL('window.js')
// s.onload = function () {
//
// }
//
//
//
// (document.head || document.documentElement).appendChild(s)
window.send = function() {
  return chrome.runtime.send?.(...arguments)
}

/** Keep page messaging live through the authenticated background; no key enters the page. */
function initSocket() {
  let reconnectTimer, daemonTimer, retryTimer, pendingBytes = 0, messageSequence = 0, receivedPolicy = false
  const pending = new Map()
  /** Flush only consented messages, with bounded retention during authentication. */
  function flush() {
    if(!contentPort || !bridgePolicy.enabled) return
    for(const [id, entry] of pending) {
      if(entry.message._bridgeGeneration !== undefined && entry.message._bridgeGeneration !== bridgePolicy.generation) {
        entry.finish(false)
      } else if(!entry.inFlight) {
        entry.inFlight = true
        try { contentPort.postMessage({kind: 'message', id, message: entry.message}) } catch { entry.inFlight = false }
      }
    }
  }
  /** Reattach this document after a background lifecycle restart. */
  function connect() {
    try {
      const port = chrome.runtime.connect({name: 'fast-browser-content'})
      contentPort = port
      port.onMessage.addListener(async packet => {
        if(contentPort !== port) return
        if(packet.kind === 'receipt') {
          const entry = pending.get(packet.id)
          if(!entry) return
          if(packet.delivered || !packet.retryable) entry.finish(packet.delivered === true)
          else {
            entry.inFlight = false
            clearTimeout(retryTimer)
            retryTimer = setTimeout(flush, 250)
          }
          return
        }
        if(packet.kind === 'policy') {
          bridgePolicy = packet.policy
          receivedPolicy = true
          if(!bridgePolicy.enabled) for(const entry of pending.values()) entry.finish(false)
          flush()
          return
        }
        if(packet.kind === 'connected') {
          flush()
          send({type: document.hasFocus() ? 'onFocus' : 'daemons'})
          return
        }
        const msg = packet.message
        if(packet.kind !== 'command' || !bridgePolicy.enabled || !bridgePolicy.automation || msg?._bridgeGeneration !== bridgePolicy.generation || !Object.hasOwn(socketHandler, msg?.type)) return
        /** Keep replies attached to the live document and authorization generation. */
        function reply(message) {
          if(contentPort === port && bridgePolicy.enabled && bridgePolicy.automation && bridgePolicy.generation === msg._bridgeGeneration) {
            send({...message, _bridgeGeneration: msg._bridgeGeneration})
          }
        }
        try {
          const result = await socketHandler[msg.type](msg, reply)
          if(result != null && msg.tid) reply(_.isObject(result) && !_.isArray(result) ? {...result, tid: msg.tid} : {tid: msg.tid, value: result})
        } catch {
          reply({type: 'error', msg: 'Browser page action failed', tid: msg.tid})
        }
      })
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError
        if(contentPort !== port) return
        contentPort = null
        receivedPolicy = false
        for(const entry of pending.values()) entry.inFlight = false
        bridgePolicy = {enabled: false, pageContent: false, automation: false}
        clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(connect, 1000)
      })
    } catch {
      reconnectTimer = setTimeout(connect, 1000)
    }
  }
  /** Preserve string/object messages and confirm delivery before callers close a page. */
  function send_(message) {
    if(receivedPolicy && !bridgePolicy.enabled) return Promise.resolve(false)
    try {
      if(typeof message === 'string') message = JSON.parse(message)
      message = {...message, timeFocus: timeFocus.getTime(), title: document.title}
      const bytes = JSON.stringify(message).length * 2
      if(pending.size >= 100 || pendingBytes + bytes > 2 * 1024 * 1024) return Promise.resolve(false)
      const id = String(++messageSequence)
      return new Promise(resolve => {
        const timer = setTimeout(() => finish(false), 10000)
        /** Release retained data after delivery, denial or a bounded startup timeout. */
        function finish(delivered) {
          if(!pending.delete(id)) return
          clearTimeout(timer)
          pendingBytes -= bytes
          resolve(delivered)
        }
        pending.set(id, {message, finish, inFlight: false})
        pendingBytes += bytes
        flush()
      })
    } catch {
      return Promise.resolve(false)
    }
  }

  chrome.runtime.send = send_
  send = send_
  connect()
  daemonTimer = setInterval(() => send({type: 'daemons'}), 10000)
  window.addEventListener('pagehide', () => {
    clearInterval(daemonTimer)
    clearTimeout(reconnectTimer)
    clearTimeout(retryTimer)
    for(const entry of pending.values()) entry.finish(false)
  }, {once: true})
}

function selectText(element) {
  if(document.body.createTextRange) {
    let range = document.body.createTextRange()
    range.moveToElementText(element)
    range.select()
  } else if(window.getSelection) {
    let selection = window.getSelection()
    let range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
  } else {
    console.log('none')
  }
}


// endregion
function hotkey() {
  /**
   * 添加 快捷键
   * @param keyStr ['a','b'] | 'a'
   * @param cb
   */
  function addKey(keyStr, cb) {
    if(keyStr instanceof Array) {
      for(let e of keyStr) {
        _addKey(e, cb)
      }
    } else {
      _addKey(keyStr, cb)
    }
  }
  
  function _addKey(keyStr, cb) {
    if(keys[keyStr]) {
      console.log('热键重复')
    }
    keys[keyStr] = cb
  }
  
  window.addKey = addKey
  
  $('input').on('focus', () => {
    isOnInput = true
  })
  $('input').on('blur', () => {
    isOnInput = false
  })
  
  let onkeyupOld = document.onkeyup
  
  // 快捷键
  document.onkeydown = function(e) {
    if(e.key !== 'Shift' || !e.isTrusted || !bridgePolicy.enabled || !bridgePolicy.pageContent) return
    
    if(new Date() - lastCtrlDown < 3000) return
    lastCtrlDown = new Date()
    
    // let $$ = $
    // $ = jQuery
    
    buttonKv = {}
    sendCmds()
    
    // $ = $$
  }
  document.onkeyup = function(e) {
    if(e.key === 'Control' && e.isTrusted && bridgePolicy.enabled) {
      // 弹出 fast.exe 命令界面
      send(JSON.stringify({
        type: 'openFast',
      }))
    }
    onkeyupOld && onkeyupOld(e)
    if(isOnInput) return
    
    
    _.chain(keys).keys().find((key, k) => {
      if(e.ctrlKey && !/\bctrl\b/gi.test(key)) {
        return
      }
      if(e.shiftKey && !/\bshift\b/gi.test(key)) {
        return
      }
      if(e.altKey && !/\balt\b/gi.test(key)) {
        return
      }
      
      
      if(new RegExp(`\\b${e.key}\\b`, 'gi').test(key)) {
        keys[key]()
      }
      
      
    }).value()
  }
}

/**
 * 通用方法
 */
function commonSettings() {
  // region 界面修改
  // 净化
  let rms = {}
  
  /**
   * 在 <head> 中添加 隐藏 style
   * @param {string} selector <style>中支持的选择器
   */
  function rm(selector, isNew) {
    if(!_.has(rms, selector) || isNew) {
      rms[selector] = isNew
      setTimeout(() => {
        $('<style></style>').text(`${_.keys(rms).join(',')}{display: none!important}`).appendTo($('head'))
      }, 1)
    }
  }
  
  window.rm = rm
  
  
  /**
   * 在 <head> 中添加 隐藏 style
   * @param {string} selector <style>中支持的选择器
   */
  function rm_(selector, isNew) {
    if(!_.has(rms, selector) || isNew) {
      rms[selector] = isNew
      setTimeout(() => {
        $('<style></style>').text(`${_.keys(rms).join(',')}{visibility: hidden!important}`).appendTo($('head'))
      }, 1)
    }
  }
  
  window.rm_ = rm_
  
  /**
   * 在 <head> 中添加 显示 style
   * @param {string} selector <style>中支持的选择器
   */
  function rm__(selector, isNew) {
    if(!_.has(rms, selector) || isNew) {
      rms[selector] = isNew
      setTimeout(() => {
        $('<style></style>').text(`${_.keys(rms).join(',')}{display: block!important}`).appendTo($('head'))
      }, 1)
    }
  }
  
  window.rm__ = rm__
  
  /**
   * 隐藏通过 .css({})
   * @param {string, jquery} selector jquery选择器
   */
  function hide(selector) {
    if($(selector).length > 0) {
      $(selector).css({
        display: 'none'
      })
    }
  }
  
  window.hide = hide
  
  // 滚动到指定位置
  function scrollPosition(selector, parent = 'html, body') {
    $(parent).animate({
      scrollTop: $(selector).offset().top
    }, 300)
  }
  
  window.scrollPosition = scrollPosition
  let allCss = []
  
  // 添加 css 样式 到 head
  function addCss(selector, cssStr) {
    allCss.push({selector, cssStr})
    if(cssStr) {
      $('<style></style>')
        .text(`${selector}{${cssStr}}`)
        .appendTo($('head'))
    } else {
      $('<style></style>').text(`${selector}`).appendTo($('head'))
    }
  }
  
  addCss('.o-o {}')
  window.addCss = addCss
  let urlOld = window.location.href
  setInterval(async () => {
    if(urlOld !== window.location.href) {
      urlOld = window.location.href
      let t_ = new Date()
      let isChanged = true
      while (hasGlobalCssClassDefinition('o-o')) {
        if(new Date() - t_ > 3000) {
          isChanged = false
          break
        }
        await f.sleep(20)
      }
      if(isChanged) {
        let allCss_ = [...allCss]
        allCss = []
        for(let {selector, cssStr} of allCss_ || []) {
          addCss(selector, cssStr)
        }
        
        let rmss = {...rms}
        rms = {}
        for(let [k, v] of Object.entries(rmss || {})) {
          rm(k, v)
        }
      }
    }
  }, 500)
  
  // endregion
}

/**
 * 检查全局 CSS 样式表中是否存在指定类名的样式规则。
 * @param {string} className - 要检查的类名，不带点（例如 'my-class'）。
 * @returns {boolean} 如果找到该类名的样式规则，则返回 true，否则返回 false。
 */
function hasGlobalCssClassDefinition(className) {
  const selectorToFind = `.${className}`
  for(let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i]
    try {
      const rules = sheet.cssRules || sheet.rules
      if(rules) {
        for(let j = 0; j < rules.length; j++) {
          const rule = rules[j]
          
          if(rule instanceof CSSStyleRule) {
            if(rule.selectorText.includes(selectorToFind)) {
              const selectors = rule.selectorText.split(',').map(s => s.trim())
              if(selectors.includes(selectorToFind)) {
                return true
              }
            }
          } else if(rule instanceof CSSMediaRule) {
            for(let k = 0; k < rule.cssRules.length; k++) {
              const mediaRule = rule.cssRules[k]
              if(mediaRule instanceof CSSStyleRule && mediaRule.selectorText.includes(selectorToFind)) {
                const selectors = mediaRule.selectorText.split(',').map(s => s.trim())
                if(selectors.includes(selectorToFind)) {
                  return true
                }
              }
            }
          }
        }
      }
    } catch (e) {
    
    }
  }
  
  return false
}

// endregion
