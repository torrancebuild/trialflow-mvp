import { createProductionHandler } from '../server/config.mjs'

let handlerPromise

function getHandler() {
  handlerPromise ??= Promise.resolve().then(() => createProductionHandler())
  return handlerPromise
}

export default async function handler(req, res) {
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
    const url = `https://${req.headers.host || 'localhost'}${req.url || '/'}`
    const request = new Request(url, { method: req.method, headers: req.headers, body: body ? new Uint8Array(body) : undefined })
    const response = await (await getHandler())(request)
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    res.statusCode = error.status ?? 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: error.code ?? 'SERVER_MISCONFIGURED', message: error.message }))
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) reject(Object.assign(new Error('Request body is too large.'), { status: 413, code: 'PAYLOAD_TOO_LARGE' }))
      else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
