[
  {
    "id": "comment-usage",
    "type": "comment",
    "name": "=== 加热垫标定结果 → SQLite ===\n\n订阅 Topic: /unito/stoov/heating-bed/cal-result\nBroker   : EMQX wss (r61d1d77.ala.cn-shenzhen.emqxsl.cn:8084)\n数据库   : cal-results.db (位于 Node-RED 数据目录下)\n\n前置条件:\n1) Node-RED 安装节点: node-red-contrib-sqlite\n2) 部署后 inject 节点自动建表 (cal_result)\n3) 收到标定结果消息后自动写入 cal_result 表",
    "info": "",
    "x": 80,
    "y": 40,
    "wires": []
  },
  {
    "id": "mqtt-broker-emqx",
    "type": "mqtt-broker",
    "name": "EMQX wss (加热垫)",
    "broker": "r61d1d77.ala.cn-shenzhen.emqxsl.cn",
    "port": "8084",
    "protocol": "wss",
    "clientid": "node-red-heating-bed",
    "autoConnect": true,
    "usetls": false,
    "protocolVersion": "4",
    "keepalive": "60",
    "cleansession": true,
    "birthTopic": "",
    "birthQos": "0",
    "birthRetain": "false",
    "birthPayload": "",
    "closeTopic": "",
    "closeQos": "0",
    "closeRetain": "false",
    "closePayload": "",
    "willTopic": "",
    "willQos": "0",
    "willRetain": "false",
    "willPayload": "",
    "username": "heatingBed",
    "password": "cos8mos7"
  },
  {
    "id": "mqtt-in-cal-result",
    "type": "mqtt in",
    "name": "标定结果 cal-result",
    "topic": "/unito/stoov/heating-bed/cal-result",
    "qos": "1",
    "datatype": "utf8",
    "broker": "mqtt-broker-emqx",
    "nl": false,
    "rap": false,
    "rh": 0,
    "x": 100,
    "y": 160,
    "wires": [
      [
        "json-parse-cal",
        "debug-raw"
      ]
    ]
  },
  {
    "id": "json-parse-cal",
    "type": "json",
    "name": "解析 JSON",
    "property": "payload",
    "action": "obj",
    "pretty": false,
    "x": 280,
    "y": 160,
    "wires": [
      [
        "func-flatten-cal"
      ]
    ]
  },
  {
    "id": "func-flatten-cal",
    "type": "function",
    "name": "展平并生成 INSERT",
    "func": "// ============================================================\n// 输入: msg.payload = 已解析的 JSON 对象 (cal-result)\n// 输出: msg.topic   = INSERT 语句（sqlite 节点 execute 模式执行）\n//       msg.saved   = 摘要信息（供 debug 显示）\n// ============================================================\nfunction esc(v) {\n    if (v === null || v === undefined) return 'NULL';\n    if (typeof v === 'number') return String(v);\n    return \"'\" + String(v).replace(/'/g, \"''\") + \"'\";\n}\nfunction numOrNull(v) {\n    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return 'NULL';\n    return String(Number(v));\n}\n\nconst p = msg.payload || {};\n// 只处理标定结果类型，其它类型忽略\nif (p.type && p.type !== 'CAL') return null;\n\nconst b = p.b || {};\nconst f = p.f || {};\nconst bf1 = b.f1 || {};\nconst bf2 = b.f2 || {};\nconst ff1 = f.f1 || {};\nconst ff2 = f.f2 || {};\n\nconst cols = [\n    'date', 'time', 'type', 'did', 'dv', 'upt', 'et',\n    'b_pt', 'b_ct', 'b_f1_tp', 'b_f1_rs', 'b_f2_tp', 'b_f2_rs', 'b_r', 'b_df', 'b_rsn',\n    'f_pt', 'f_ct', 'f_f1_tp', 'f_f1_rs', 'f_f2_tp', 'f_f2_rs', 'f_r', 'f_df', 'f_rsn'\n];\nconst vals = [\n    esc(p.date), esc(p.time), esc(p.type), esc(p.did), esc(p.dv), esc(p.upt),\n    numOrNull(p.et),\n    numOrNull(b.pt), numOrNull(b.ct),\n    numOrNull(bf1.tp), numOrNull(bf1.rs), numOrNull(bf2.tp), numOrNull(bf2.rs),\n    esc(b.r), numOrNull(b.df), esc(b.rsn),\n    numOrNull(f.pt), numOrNull(f.ct),\n    numOrNull(ff1.tp), numOrNull(ff1.rs), numOrNull(ff2.tp), numOrNull(ff2.rs),\n    esc(f.r), numOrNull(f.df), esc(f.rsn)\n];\n\nmsg.topic = 'INSERT INTO cal_result (' + cols.join(', ') + ') VALUES (' + vals.join(', ') + ');';\nmsg.saved = { did: p.did, date: p.date, time: p.time, type: p.type, bR: b.r, fR: f.r, upt: p.upt, et: p.et };\nreturn msg;",
    "outputs": 1,
    "noerr": 0,
    "initialize": "",
    "finalize": "",
    "libs": [],
    "x": 470,
    "y": 160,
    "wires": [
      [
        "sqlite-insert-cal",
        "debug-saved"
      ]
    ]
  },
  {
    "id": "sqlite-insert-cal",
    "type": "sqlite",
    "name": "INSERT → cal_result",
    "query": "",
    "mode": "execute",
    "sqlite": "sqlitedb-cal",
    "x": 670,
    "y": 160,
    "wires": [
      [
        "debug-sql-result"
      ]
    ]
  },
  {
    "id": "sqlitedb-cal",
    "type": "sqlitedb",
    "db": "cal-results.db",
    "name": "cal-results.db (SQLite)"
  },
  {
    "id": "inject-init",
    "type": "inject",
    "name": "启动时创建表",
    "props": [],
    "repeat": "",
    "crontab": "",
    "once": true,
    "onceDelay": 0.1,
    "topic": "",
    "payload": "",
    "payloadType": "date",
    "x": 90,
    "y": 280,
    "wires": [
      [
        "sqlite-create-table"
      ]
    ]
  },
  {
    "id": "sqlite-create-table",
    "type": "sqlite",
    "name": "CREATE TABLE cal_result",
    "query": "CREATE TABLE IF NOT EXISTS cal_result (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    saved_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),\n    date TEXT, time TEXT, type TEXT, did TEXT, dv TEXT, upt TEXT,\n    et REAL,\n    b_pt REAL, b_ct REAL, b_f1_tp REAL, b_f1_rs REAL, b_f2_tp REAL, b_f2_rs REAL,\n    b_r TEXT, b_df REAL, b_rsn TEXT,\n    f_pt REAL, f_ct REAL, f_f1_tp REAL, f_f1_rs REAL, f_f2_tp REAL, f_f2_rs REAL,\n    f_r TEXT, f_df REAL, f_rsn TEXT\n);\nCREATE INDEX IF NOT EXISTS idx_cal_result_did ON cal_result(did);\nCREATE INDEX IF NOT EXISTS idx_cal_result_date ON cal_result(date);",
    "mode": "fixed",
    "sqlite": "sqlitedb-cal",
    "x": 280,
    "y": 280,
    "wires": [
      [
        "debug-init"
      ]
    ]
  },
  {
    "id": "debug-raw",
    "type": "debug",
    "name": "原始报文",
    "active": true,
    "tosidebar": true,
    "console": false,
    "tostatus": false,
    "complete": "payload",
    "targetType": "msg",
    "statusVal": "",
    "statusType": "auto",
    "x": 470,
    "y": 240,
    "wires": []
  },
  {
    "id": "debug-saved",
    "type": "debug",
    "name": "已保存(摘要)",
    "active": true,
    "tosidebar": true,
    "console": false,
    "tostatus": false,
    "complete": "saved",
    "targetType": "msg",
    "statusVal": "",
    "statusType": "auto",
    "x": 670,
    "y": 240,
    "wires": []
  },
  {
    "id": "debug-sql-result",
    "type": "debug",
    "name": "SQLite 执行结果",
    "active": true,
    "tosidebar": true,
    "console": false,
    "tostatus": false,
    "complete": "true",
    "targetType": "full",
    "statusVal": "",
    "statusType": "auto",
    "x": 850,
    "y": 160,
    "wires": []
  },
  {
    "id": "debug-init",
    "type": "debug",
    "name": "建表完成",
    "active": true,
    "tosidebar": true,
    "console": false,
    "tostatus": false,
    "complete": "payload",
    "targetType": "msg",
    "statusVal": "",
    "statusType": "auto",
    "x": 470,
    "y": 320,
    "wires": []
  }
]
