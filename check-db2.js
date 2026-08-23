// 查看数据库表结构和用户
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync('/koishi/data/koishi.db')
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
console.log('tables:', tables.map(t => t.name).join(', '))
try {
  const cols = db.prepare('PRAGMA table_info(user)').all()
  console.log('user cols:', cols.map(c => c.name).join(', '))
  const rows = db.prepare('SELECT * FROM user').all()
  console.log('users:', JSON.stringify(rows))
} catch (e) { console.log('user check:', e.message) }
