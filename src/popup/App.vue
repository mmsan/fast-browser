<script setup>
import {computed, onMounted, onUnmounted, reactive, ref} from 'vue'

const t = chrome.i18n.getMessage

const settings = reactive({port: 9072, enabled: true, shareUrl: true, pageContent: true, automation: true, sites: {}})
const origin = ref('')
const pageTypes = ref('')
const sensitiveValues = ref(false)
const userScripts = ref(false)
const connected = ref(false)
const saving = ref(false)
const loaded = ref(false)
const error = ref('')
const saved = ref(false)
let statusTimer
const status = computed(() => !loaded.value ? t('checking') : connected.value ? t('connected') :
  settings.enabled ? t('connecting') : t('paused'))

/** Refresh connection state without overwriting unsaved advanced settings. */
async function load(includeSettings = false) {
  try {
    const response = await chrome.runtime.sendMessage({type: 'bridgeGetSettings'})
    if(!response?.ok) throw new Error()
    connected.value = response.data.connected
    if(includeSettings) {
      Object.assign(settings, response.data.settings)
      origin.value = response.data.origin
      const site = settings.sites[origin.value] || {}
      pageTypes.value = (site.pageTypes || []).join(', ')
      sensitiveValues.value = site.sensitiveValues === true
      userScripts.value = site.userScripts === true
    }
    loaded.value = true
  } catch {
    error.value = t('loadError')
  }
}

/** Save optional advanced controls while keeping normal connection automatic. */
async function save() {
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    if(userScripts.value && origin.value) {
      const granted = await chrome.permissions.request({permissions: ['userScripts'], origins: [origin.value.startsWith('file:') ? 'file:///*' : origin.value + '/*']})
      if(!granted) throw new Error()
    }
    if(origin.value) settings.sites[origin.value] = {
      pageTypes: pageTypes.value.split(/[,\s]+/).filter(Boolean), sensitiveValues: sensitiveValues.value, userScripts: userScripts.value,
    }
    const response = await chrome.runtime.sendMessage({type: 'bridgeSaveSettings', settings: JSON.parse(JSON.stringify(settings))})
    if(!response?.ok) throw new Error()
    connected.value = response.data.connected
    saved.value = true
    return true
  } catch {
    error.value = t('saveError')
    return false
  } finally {
    saving.value = false
  }
}

/** Pause or resume without requiring a code or a second Save action. */
async function toggleConnection() {
  saving.value = true
  error.value = ''
  try {
    const current = await chrome.runtime.sendMessage({type: 'bridgeGetSettings'})
    if(!current?.ok) throw new Error()
    const next = {...current.data.settings, enabled: !current.data.settings.enabled}
    const response = await chrome.runtime.sendMessage({type: 'bridgeSaveSettings', settings: next})
    if(!response?.ok) throw new Error()
    settings.enabled = next.enabled
    connected.value = response.data.connected
  } catch {
    error.value = t('connectionError')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  document.documentElement.lang = t('uiLanguage')
  document.title = t('appTitle')
  await load(true)
  statusTimer = setInterval(() => load(), 2000)
})
onUnmounted(() => clearInterval(statusTimer))
</script>

<template>
  <main>
    <h1>{{ t('appTitle') }}</h1>
    <p class="status" role="status">{{ status }}</p>
    <p v-if="loaded && !connected && settings.enabled" class="hint">{{ t('startFast') }}</p>
    <button type="button" :disabled="saving || !loaded" @click="toggleConnection">{{ settings.enabled ? t('pause') : t('resume') }}</button>
    <p v-if="error" role="alert">{{ error }}</p>

    <details>
      <summary>{{ t('advanced') }}</summary>
      <form @submit.prevent="save">
        <label>WebSocket 端口 / Port
          <input v-model.number="settings.port" type="number" inputmode="numeric" min="1" max="65535" step="1" required>
        </label>
        <p class="hint">默认 9072。若 F12 显示端口已切换，请填写实际 WebSocket 端口；连接地址固定为 127.0.0.1。</p>
        <label class="check"><input v-model="settings.shareUrl" type="checkbox">{{ t('shareUrl') }}</label>
        <label class="check"><input v-model="settings.pageContent" type="checkbox">{{ t('pageContent') }}</label>
        <label class="check"><input v-model="settings.automation" type="checkbox">{{ t('automation') }}</label>
        <details>
          <summary>{{ t('sitePermissions') }}</summary>
          <fieldset :disabled="!origin">
            <legend>{{ origin ? t('currentSite', origin) : t('openWebsite') }}</legend>
            <p v-if="origin.startsWith('file:')" class="hint">{{ t('fileAccessHint') }}</p>
            <label class="check"><input v-model="sensitiveValues" type="checkbox">{{ t('sensitiveValues') }}</label>
            <label>{{ t('pageMessages') }}
              <input v-model="pageTypes" autocomplete="off" :placeholder="t('pageMessagesPlaceholder')">
            </label>
            <label class="check"><input v-model="userScripts" type="checkbox">{{ t('userScripts') }}</label>
            <p v-if="userScripts" class="hint">{{ t('userScriptsHint') }}</p>
          </fieldset>
        </details>
        <button type="submit" :disabled="saving">{{ saving ? t('saving') : t('save') }}</button>
        <span v-if="saved" role="status">{{ t('saved') }}</span>
      </form>
    </details>
  </main>
</template>

<style scoped>
main {box-sizing: border-box; text-align: left}
h1 {font-size: 1.4rem; margin: 0 0 1rem}
.status {font-size: 1.05rem; font-weight: 600}
label {display: block; margin: 0.8rem 0}
input:not([type=checkbox]) {box-sizing: border-box; width: 100%; padding: 0.6rem; margin-top: 0.3rem; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; font: inherit}
.check {display: flex; align-items: center; gap: 0.5rem}
.check input {flex: 0 0 auto; width: 1rem; height: 1rem; margin: 0}
.hint {font-size: 0.85rem; opacity: 0.8; line-height: 1.5}
details {margin-top: 1rem}
summary {cursor: pointer}
fieldset {margin: 1rem 0; padding: 0.8rem; border: 1px solid var(--border); border-radius: 12px; overflow-wrap: anywhere}
button:disabled {opacity: 0.6}
form > button {margin-top: 1rem; margin-right: 0.6rem}
</style>
