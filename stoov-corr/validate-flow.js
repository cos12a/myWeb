// 验证 node-red.js 流程: 抽取 function 节点代码 → 跑示例消息 → 生成 SQL → 在内存 SQLite 中执行
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const flow = JSON.parse(fs.readFileSync(path.join(__dirname, 'node-red.js'), 'utf8'));

// 1) 检查必要节点存在
const types = flow.map(n => n.type);
for (const t of ['mqtt-broker', 'mqtt in', 'json', 'function', 'sqlite', 'sqlitedb', 'inject', 'debug', 'comment']) {
    if (!types.includes(t)) throw new Error('缺少节点类型: ' + t);
}
console.log('[1] 流程节点齐全: ' + flow.length + ' 个节点');

// 2) 取出 function 节点代码
const funcNode = flow.find(n => n.id === 'func-flatten-cal');
if (!funcNode) throw new Error('找不到 func-flatten-cal 节点');
const funcCode = funcNode.func;

// 3) 用示例消息执行 function 代码
const samples = [
    // 正常 OK 结果（r/df 在 b/f 段内各自一份）
    { date: '2026-08-14', time: '09:30:31', type: 'CAL', did: 'HT-57006500', dv: 'v4.2', upt: '00:02:35',
      b: { pt: 29.2, ct: 29, f1: { tp: 29, rs: 552 }, f2: { tp: 29, rs: 552 }, r: 'OK', df: 0 },
      f: { pt: 29, ct: 29, f1: { tp: 29, rs: 486.1 }, f2: { tp: 29, rs: 485.9 }, r: 'OK', df: 0.2 },
      et: 29 },
    // 失败结果（b 段 FAIL 含 df/rsn，f 段无数据）
    { date: '2026-08-14', time: '09:31:02', type: 'CAL', did: 'HT-57006500', dv: 'v4.2', upt: '00:02:35',
      b: { pt: 29.2, ct: 29, f1: { tp: 29, rs: 552 }, f2: { tp: 29, rs: 551.8 }, r: 'FAIL', df: 0.2, rsn: '第1次读取阻值失败' } },
    // 非 CAL 类型 → 应返回 null
    { type: 'HELLO', did: 'x' }
];

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE IF NOT EXISTS cal_result (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    saved_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    date TEXT, time TEXT, type TEXT, did TEXT, dv TEXT, upt TEXT,
    et REAL,
    b_pt REAL, b_ct REAL, b_f1_tp REAL, b_f1_rs REAL, b_f2_tp REAL, b_f2_rs REAL,
    b_r TEXT, b_df REAL, b_rsn TEXT,
    f_pt REAL, f_ct REAL, f_f1_tp REAL, f_f1_rs REAL, f_f2_tp REAL, f_f2_rs REAL,
    f_r TEXT, f_df REAL, f_rsn TEXT
);`);

let inserted = 0;
let skipped = 0;
samples.forEach((sample, i) => {
    const msg = { payload: sample };
    let result;
    try {
        const fn = new Function('msg', funcCode);
        result = fn(msg);
    } catch (e) {
        console.error('  示例 #' + i + ' function 执行出错: ' + e.message);
        process.exit(1);
    }
    if (result === null) { skipped++; console.log('[2.' + i + '] 跳过非 CAL 消息 ✔'); return; }
    // 执行生成的 INSERT
    db.exec(result.topic);
    inserted++;
    console.log('[2.' + i + '] INSERT 执行成功 ✔ did=' + result.saved.did + ' bR=' + result.saved.bR + ' fR=' + result.saved.fR);
});

console.log('[3] 插入=' + inserted + ', 跳过=' + skipped);
const rows = db.prepare('SELECT * FROM cal_result ORDER BY id').all();
console.log('[4] 数据库中行数=' + rows.length);
rows.forEach(r => {
    console.log('    id=' + r.id + ' did=' + r.did + ' date=' + r.date + ' time=' + r.time +
        ' b_r=' + r.b_r + ' b_df=' + r.b_df + ' b_rsn=' + (r.b_rsn === null ? 'NULL' : r.b_rsn) +
        ' f_r=' + r.f_r + ' f_df=' + r.f_df +
        ' b_f1_rs=' + r.b_f1_rs + ' f_f2_rs=' + r.f_f2_rs);
});
if (rows.length !== 2) { console.error('校验失败: 期望 2 行'); process.exit(1); }
console.log('✔ 端到端校验通过');
