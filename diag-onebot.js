// 诊断容器内 onebot 相关包
const fs = require('fs')
const base = '/koishi/node_modules'
const checks = [
  '@koishijs/plugin-adapter-onebot',
  'koishi-plugin-adapter-onebot',
  '@satorijs/adapter-onebot',
  '@satorijs/satori',
  '@satorijs/core',
]
for (const p of checks) {
  const ver = (() => {
    try { return require(base + '/' + p + '/package.json').version } catch (e) { return 'MISSING' }
  })()
  console.log(p, '=>', ver)
}
// package.json 中 adapter 相关
const pkg = JSON.parse(fs.readFileSync('/koishi/package.json', 'utf8'))
console.log('--- package.json deps ---')
for (const [k, v] of Object.entries(pkg.dependencies || {})) {
  if (k.includes('onebot') || k.includes('adapter')) console.log(k, ':', v)
}
