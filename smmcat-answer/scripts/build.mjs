/**
 * 构建脚本：使用 TypeScript 编译器 API 在进程内编译（不产生子进程），
 * 输出 CJS 格式的 lib/index.js 与类型声明 lib/*.d.ts。
 * 用法：node scripts/build.mjs [--watch]
 *
 * 说明：原 tsconfig 为 esbuild+tsc 双工具设计（emitDeclarationOnly），
 * 本脚本改为单 tsc 全量编译，产物行为一致（require('koishi') 等外部依赖）。
 */
import ts from 'typescript'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(root, 'tsconfig.json')

function compile() {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  if (configFile.error) {
    console.error(ts.formatDiagnostic(configFile.error, getHost()))
    process.exit(1)
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const result = program.emit()

  const diagnostics = ts.getPreEmitDiagnostics(program).concat(result.diagnostics)
  if (diagnostics.length) {
    for (const d of diagnostics) {
      console.error(ts.formatDiagnostic(d, getHost()))
    }
    console.error('[build] 类型检查失败')
    process.exit(1)
  }
  console.log('[build] done: lib/index.js + lib/*.d.ts')
  maybeAutoDeploy()
}

function loadNasEnvFile() {
  const envPath = path.join(root, '.nas-deploy.env')
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    if (!process.env[key]) process.env[key] = trimmed.slice(idx + 1).trim()
  }
}

function maybeAutoDeploy() {
  if (process.env.BUILD_SKIP_AUTO_DEPLOY === '1') return
  loadNasEnvFile()
  const auto = process.env.AUTO_DEPLOY_NAS
  if (auto !== '1' && auto !== 'true') return
  if (!process.env.NAS_PASS) {
    console.log('[build] AUTO_DEPLOY_NAS=1 但未设置 NAS_PASS，跳过部署')
    return
  }
  console.log('[build] AUTO_DEPLOY_NAS=1，正在部署到 NAS...')
  const r = spawnSync('python', ['scripts/deploy-nas.py'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

function getHost() {
  return {
    getCurrentDirectory: () => root,
    getCanonicalFileName: (f) => f,
    getNewLine: () => '\n',
  }
}

if (process.argv.includes('--watch')) {
  console.log('[build] 注意：本沙箱构建脚本为单次编译；如需 watch 请在普通环境使用 `tsc -p tsconfig.json --watch`')
}

compile()
