import _ from 'lodash'
import * as f from '@/f'
import 'babel-polyfill'
import $ from 'jquery'
window.onerror = function (errorMsg, url, lineNumber, column, errorObj) {
  console.error(errorMsg + '\n' + errorObj.stack)
  return true
}

async function getImageColor(img) {
  var canvas = document.createElement('canvas')
  if (_.isString(img)) {
    img = {
      width: 100,
      height: 100,
      src: img,
    }
  }

  if (img.width > img.height && img.width < 150) return [0, 0, 0]  // 验证码

  canvas.width = img.width
  canvas.height = img.height

  var context = canvas.getContext('2d')
  let w = 8
  let h = 8

  let img1 = new Image()
  // img1.setAttribute('crossOrigin', 'anonymous')
  img1.crossOrigin = '*'
  var r = 0,
    g = 0,
    b = 0

  let ok = false
  img1.onload = () => {
    context.drawImage(img1, 0, 0, w, h)

    // 获取像素数据
    var data = context.getImageData(0, 0, w, h).data
    // 取所有像素的平均值
    for (var row = 0; row < h; row++) {
      for (var col = 0; col < w; col++) {
        const offset = ((w * row) + col) * 4
        r += data[offset]
        g += data[offset + 1]
        b += data[offset + 2]
      }
    }
    // 求取平均值
    r /= (w * h)
    g /= (w * h)
    b /= (w * h)

    // 将最终的值取整
    r = Math.round(r)
    g = Math.round(g)
    b = Math.round(b)
    ok = true
  }
  img1.src = img.src

  let t = new Date()
  while (!ok) {
    if (new Date() - t > 6000) break
    await f.sleep(20)
  }
  return [r, g, b]
}

const msgHandler = {
  async getImageColor({msg}) {
    return await getImageColor(msg)
  },
}
// chrome.runtime.onMessage.addListener((msg, sender) => {
//   if(!msgHandler[msg?.type]) return
//   setTimeout(async () => {
//     msg.data = await msgHandler[msg?.type]({msg, tab: sender.tab})
//     msg.type = 'sendToTab'
//     msg.tabId = sender.tab.id
//     try {
//       chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError })
//     } catch(e) {
//
//     }
//   })
// })


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.dst !== 'offscreen' || !msgHandler[msg?.type]) return
  (async () => {
    try {
      const h = msgHandler[msg?.type]
      const data = await h({ msg, tab:sender.tab })
      sendResponse({ ok: true, data })
    } catch (e) {
      console.error(e.message+'\n'+e.stack.toString())
      sendResponse({
        ok: false,
        error: e.message,
        stack:e.stack.toString()
      })
    }
  })()
  
  return true // 告诉 Chrome sendResponse 将会被异步调用
})





if (typeof __FAST_BROWSER_DEV_BUILD__ !== 'undefined' && __FAST_BROWSER_DEV_BUILD__) {
  let checking = false
  /** Detect completed local builds; a stopped dev process leaves the last build fully usable. */
  async function checkDevelopmentBuild() {
    if (checking) return
    checking = true
    try {
      const response = await fetch(chrome.runtime.getURL('dev-build.json'), {cache: 'no-store'})
      if (!response.ok) return
      const {version, builtAt} = await response.json()
      if (typeof version === 'string' && /^[0-9a-f-]{36}$/.test(version) && Number.isSafeInteger(builtAt) && builtAt > __FAST_BROWSER_DEV_BUILD__.builtAt) {
        await chrome.runtime.sendMessage({type: 'developmentReload', version, builtAt})
      }
    } catch {
      // Missing or temporarily unavailable output must not interrupt normal extension operation.
    } finally {
      checking = false
    }
  }
  setInterval(checkDevelopmentBuild, 1000)
}
