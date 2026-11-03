import fs from 'node:fs'
import {defineManifest} from '@crxjs/vite-plugin'
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineManifest({
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_appTitle__',
  version: pkg.version,
  icons: {
    48: 'logo.png',
  },
  action: {
    default_title: '__MSG_appTitle__',
    default_icon: {
      48: 'logo.png',
    },
    default_popup: 'src/popup/index.html',
  },
  content_scripts: [{
    js: ['src/content-script/index.js'],
    matches: ['<all_urls>'],
    all_frames: true,
  }],
  permissions: [
    "storage",
    "tabs",
    "offscreen",
    'nativeMessaging'
  ],
  
  background: {
    service_worker: 'src/background.js',
    type: 'module'
  },
})
