#!/usr/bin/env node
import path from 'node:path'
import {build, createServer} from 'vite'

const command = process.argv[2]
const configFile = path.resolve('vite.config.js')
if (command === 'dev') {
  const server = await createServer({configFile})
  await server.listen()
  server.printUrls()
} else if (command === 'build') {
  await build({configFile})
} else {
  throw new Error('Use fast-browser dev or fast-browser build.')
}
