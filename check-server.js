// 检查 server 相关插件版本
const r = (p) => {
  try { return require('/koishi/node_modules/' + p + '/package.json').version } catch (e) { return 'MISSING' }
}
console.log('koishi:', r('koishi'))
console.log('plugin-server:', r('@koishijs/plugin-server'))
console.log('koishi-server:', r('@koishijs/server'))
console.log('adapter-onebot:', r('koishi-plugin-adapter-onebot'))
console.log('core:', r('@satorijs/core'))
// server 插件是否提供 ws
try {
  const server = require('/koishi/node_modules/@koishijs/plugin-server/package.json')
  console.log('plugin-server deps:', JSON.stringify(server.dependencies))
} catch (e) { console.log('plugin-server MISSING') }
