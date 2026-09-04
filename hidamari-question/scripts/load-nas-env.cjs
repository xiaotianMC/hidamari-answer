/** 从 .nas-deploy.env 加载 NAS 部署环境变量（不覆盖已设置的值） */
const fs = require('node:fs')
const path = require('node:path')

const ENV_FILE = path.join(__dirname, '..', '.nas-deploy.env')

function loadNasEnv() {
  if (!fs.existsSync(ENV_FILE)) return false
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
  return true
}

module.exports = { loadNasEnv, ENV_FILE }
