#!/usr/bin/env node
import path from 'node:path'
import {build} from 'vite'
import {startDevelopment} from './dev.js'

const command = process.argv[2]
const configFile = path.resolve('vite.config.js')
if (command === 'dev') {
  const startup = startDevelopment(configFile)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await (await startup).close()
    process.exit(0)
  })
  await startup
} else if (command === 'build') {
  await build({configFile})
} else {
  throw new Error('Use fast-browser dev or fast-browser build.')
}
