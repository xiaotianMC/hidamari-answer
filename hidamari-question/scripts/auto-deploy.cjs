/**
 * 构建并部署到 NAS（需 .nas-deploy.env 或环境变量 NAS_PASS）
 * 用法：node scripts/auto-deploy.cjs [--skip-build]
 */
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { loadNasEnv } = require('./load-nas-env.cjs')

const root = path.join(__dirname, '..')
const skipBuild = process.argv.includes('--skip-build')

loadNasEnv()

if (!process.env.NAS_PASS) {
  console.log('[auto-deploy] 跳过：未设置 NAS_PASS（请配置 .nas-deploy.env）')
  process.exit(0)
}

if (!skipBuild) {
  const build = spawnSync('node', ['scripts/build.mjs'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, BUILD_SKIP_AUTO_DEPLOY: '1' },
  })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const deploy = spawnSync('python', ['scripts/deploy-nas.py'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env,
})
process.exit(deploy.status ?? 1)
