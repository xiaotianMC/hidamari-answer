// 检查 Koishi 容器内依赖版本
const r = (p) => {
  try { return require('/koishi/node_modules/' + p + '/package.json').version } catch (e) { return 'MISSING' }
}
console.log('koishi:', r('koishi'))
console.log('core-top:', r('@satorijs/core'))
console.log('satori:', r('@satorijs/satori'))
console.log('core-in-satori:', r('@satorijs/satori/node_modules/@satorijs/core'))
console.log('onebot-plugin:', r('@koishijs/plugin-adapter-onebot'))
console.log('adapter-onebot:', r('@satorijs/adapter-onebot'))
console.log('monetary:', r('koishi-plugin-monetary'))
console.log('smmcat-answer:', r('koishi-plugin-smmcat-answer'))
