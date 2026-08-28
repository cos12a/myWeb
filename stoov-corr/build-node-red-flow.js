// ============================================================
// 生成 Node-RED 流程文件（node-red.js）
//
// 功能: 订阅 /unito/stoov/heating-bed/cal-result 标定结果
//       → 解析 JSON → 展平 → 写入 SQLite (cal-results.db)
//
// 运行:  node build-node-red-flow.js
// 输出:  node-red.js  (Node-RED 导入用的流程 JSON 数组)
//
// 依赖:  Node-RED 需安装  node-red-contrib-sqlite
// ============================================================

const fs = require('fs');
const path = require('path');

// ---------- Function 节点代码：展平标定结果并生成 INSERT ----------
const FUNC_FLATTEN = `// ============================================================
// 输入: msg.payload = 已解析的 JSON 对象 (cal-result)
// 输出: msg.topic   = INSERT 语句（sqlite 节点 execute 模式执行）
//       msg.saved   = 摘要信息（供 debug 显示）
// ============================================================
function esc(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return "'" + String(v).replace(/'/g, "''") + "'";
}
function numOrNull(v) {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return 'NULL';
    return String(Number(v));
}

const p = msg.payload || {};
// 只处理标定结果类型，其它类型忽略
if (p.type && p.type !== 'CAL') return null;

const b = p.b || {};
const f = p.f || {};
const bf1 = b.f1 || {};
const bf2 = b.f2 || {};
const ff1 = f.f1 || {};
const ff2 = f.f2 || {};

const cols = [
    'date', 'time', 'type', 'did', 'dv', 'upt', 'et',
    'b_pt', 'b_ct', 'b_f1_tp', 'b_f1_rs', 'b_f2_tp', 'b_f2_rs', 'b_r', 'b_df', 'b_rsn',
    'f_pt', 'f_ct', 'f_f1_tp', 'f_f1_rs', 'f_f2_tp', 'f_f2_rs', 'f_r', 'f_df', 'f_rsn'
];
const vals = [
    esc(p.date), esc(p.time), esc(p.type), esc(p.did), esc(p.dv), esc(p.upt),
    numOrNull(p.et),
    numOrNull(b.pt), numOrNull(b.ct),
    numOrNull(bf1.tp), numOrNull(bf1.rs), numOrNull(bf2.tp), numOrNull(bf2.rs),
    esc(b.r), numOrNull(b.df), esc(b.rsn),
    numOrNull(f.pt), numOrNull(f.ct),
    numOrNull(ff1.tp), numOrNull(ff1.rs), numOrNull(ff2.tp), numOrNull(ff2.rs),
    esc(f.r), numOrNull(f.df), esc(f.rsn)
];

msg.topic = 'INSERT INTO cal_result (' + cols.join(', ') + ') VALUES (' + vals.join(', ') + ');';
msg.saved = { did: p.did, date: p.date, time: p.time, type: p.type, bR: b.r, fR: f.r, upt: p.upt, et: p.et };
return msg;`;
// ---------- 建表 SQL（inject 启动时执行一次） ----------
const SQL_CREATE_TABLE = `CREATE TABLE IF NOT EXISTS cal_result (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    saved_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    date TEXT, time TEXT, type TEXT, did TEXT, dv TEXT, upt TEXT,
    et REAL,
    b_pt REAL, b_ct REAL, b_f1_tp REAL, b_f1_rs REAL, b_f2_tp REAL, b_f2_rs REAL,
    b_r TEXT, b_df REAL, b_rsn TEXT,
    f_pt REAL, f_ct REAL, f_f1_tp REAL, f_f1_rs REAL, f_f2_tp REAL, f_f2_rs REAL,
    f_r TEXT, f_df REAL, f_rsn TEXT
);
CREATE INDEX IF NOT EXISTS idx_cal_result_did ON cal_result(did);
CREATE INDEX IF NOT EXISTS idx_cal_result_date ON cal_result(date);`;
// ---------- 流程定义 ----------
const flow = [
    {
        id: 'comment-usage',
        type: 'comment',
        name: '=== 加热垫标定结果 → SQLite ===\n\n' +
            '订阅 Topic: /unito/stoov/heating-bed/cal-result\n' +
            'Broker   : EMQX wss (r61d1d77.ala.cn-shenzhen.emqxsl.cn:8084)\n' +
            '数据库   : cal-results.db (位于 Node-RED 数据目录下)\n\n' +
            '前置条件:\n' +
            '1) Node-RED 安装节点: node-red-contrib-sqlite\n' +
            '2) 部署后 inject 节点自动建表 (cal_result)\n' +
            '3) 收到标定结果消息后自动写入 cal_result 表',
        info: '',
        x: 80,
        y: 40,
        wires: []
    },
    {
        id: 'mqtt-broker-emqx',
        type: 'mqtt-broker',
        name: 'EMQX wss (加热垫)',
        broker: 'r61d1d77.ala.cn-shenzhen.emqxsl.cn',
        port: '8084',
        protocol: 'wss',
        clientid: 'node-red-heating-bed',
        autoConnect: true,
        usetls: false,
        protocolVersion: '4',
        keepalive: '60',
        cleansession: true,
        birthTopic: '',
        birthQos: '0',
        birthRetain: 'false',
        birthPayload: '',
        closeTopic: '',
        closeQos: '0',
        closeRetain: 'false',
        closePayload: '',
        willTopic: '',
        willQos: '0',
        willRetain: 'false',
        willPayload: '',
        username: 'heatingBed',
        password: 'cos8mos7'
    },
    {
        id: 'mqtt-in-cal-result',
        type: 'mqtt in',
        name: '标定结果 cal-result',
        topic: '/unito/stoov/heating-bed/cal-result',
        qos: '1',
        datatype: 'utf8',
        broker: 'mqtt-broker-emqx',
        nl: false,
        rap: false,
        rh: 0,
        x: 100,
        y: 160,
        wires: [['json-parse-cal', 'debug-raw']]
    },
    {
        id: 'json-parse-cal',
        type: 'json',
        name: '解析 JSON',
        property: 'payload',
        action: 'obj',
        pretty: false,
        x: 280,
        y: 160,
        wires: [['func-flatten-cal']]
    },
    {
        id: 'func-flatten-cal',
        type: 'function',
        name: '展平并生成 INSERT',
        func: FUNC_FLATTEN,
        outputs: 1,
        noerr: 0,
        initialize: '',
        finalize: '',
        libs: [],
        x: 470,
        y: 160,
        wires: [['sqlite-insert-cal', 'debug-saved']]
    },
    {
        id: 'sqlite-insert-cal',
        type: 'sqlite',
        name: 'INSERT → cal_result',
        query: '',
        mode: 'execute',
        sqlite: 'sqlitedb-cal',
        x: 670,
        y: 160,
        wires: [['debug-sql-result']]
    },
    {
        id: 'sqlitedb-cal',
        type: 'sqlitedb',
        db: 'cal-results.db',
        name: 'cal-results.db (SQLite)'
    },
    {
        id: 'inject-init',
        type: 'inject',
        name: '启动时创建表',
        props: [],
        repeat: '',
        crontab: '',
        once: true,
        onceDelay: 0.1,
        topic: '',
        payload: '',
        payloadType: 'date',
        x: 90,
        y: 280,
        wires: [['sqlite-create-table']]
    },
    {
        id: 'sqlite-create-table',
        type: 'sqlite',
        name: 'CREATE TABLE cal_result',
        query: SQL_CREATE_TABLE,
        mode: 'fixed',
        sqlite: 'sqlitedb-cal',
        x: 280,
        y: 280,
        wires: [['debug-init']]
    },
    {
        id: 'debug-raw',
        type: 'debug',
        name: '原始报文',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'payload',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: 470,
        y: 240,
        wires: []
    },
    {
        id: 'debug-saved',
        type: 'debug',
        name: '已保存(摘要)',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'saved',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: 670,
        y: 240,
        wires: []
    },
    {
        id: 'debug-sql-result',
        type: 'debug',
        name: 'SQLite 执行结果',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'true',
        targetType: 'full',
        statusVal: '',
        statusType: 'auto',
        x: 850,
        y: 160,
        wires: []
    },
    {
        id: 'debug-init',
        type: 'debug',
        name: '建表完成',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'payload',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: 470,
        y: 320,
        wires: []
    }
];

// ---------- 输出到 node-red.js ----------
const outFile = path.join(__dirname, 'node-red.js');
const json = JSON.stringify(flow, null, 2) + '\n';
fs.writeFileSync(outFile, json, 'utf8');
console.log('已生成: ' + outFile + '  (' + Buffer.byteLength(json, 'utf8') + ' bytes)');

// ---------- 自检：读回并验证 JSON ----------
const back = JSON.parse(fs.readFileSync(outFile, 'utf8'));
const sqliteNodes = back.filter(n => n.type === 'sqlite');
const mqttNodes = back.filter(n => n.type === 'mqtt in');
console.log('自检通过: 节点数=' + back.length +
    ', mqtt in=' + mqttNodes.length +
    ', sqlite=' + sqliteNodes.length +
    ', broker=' + back.filter(n => n.type === 'mqtt-broker').length +
    ', db=' + back.filter(n => n.type === 'sqlitedb').length);




