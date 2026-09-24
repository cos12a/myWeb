// 验证 index.html 中 mqttPublishCalResult 发布出的 JSON 结构：
// r/df/rsn 应位于 b(身体)/f(脚部) 段内，而不是顶层
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const text = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// 抽取 mqttPublishCalResult 函数源码（括号配对）
const start = text.indexOf('function mqttPublishCalResult(extra) {');
if (start === -1) { console.error('未找到 mqttPublishCalResult'); process.exit(1); }
const openIdx = text.indexOf('{', start);
let depth = 0, end = -1;
for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const funcSrc = text.slice(start, end);

const published = [];
const context = {
    console, Date, Math, String, Number, parseFloat, isNaN, JSON, Object,
    mqttCalData: { body: { first: null, second: null }, foot: { first: null, second: null } },
    calPhaseSensor: null,
    envTempValue: 29,
    App: {
        Interfaces: {
            MQTT: { publishCalResult: (obj) => { published.push(JSON.parse(JSON.stringify(obj))); } }
        }
    },
    document: {
        getElementById: (id) => ({
            deviceIdText: { textContent: 'HT-57006500' },
            deviceVersionText: { textContent: 'v4.2' },
            hardwareUptimeDisplay: { textContent: '00:02:35' }
        }[id] || null)
    }
};
vm.createContext(context);
vm.runInContext(funcSrc, context);

// 场景1: 身体标定 OK
context.mqttCalData.body = {
    preTemp: 29.2, calTemp: 29,
    first: { temp: 29, res: 552 }, second: { temp: 29, res: 552 }
};
context.calPhaseSensor = 'body';
context.mqttPublishCalResult({ result: 'OK', diffOhm: 1.2 });

// 场景2: 脚部标定 OK（身体数据仍在积累区，会一并带上）
context.mqttCalData.foot = {
    preTemp: 29, calTemp: 29,
    first: { temp: 29, res: 486.1 }, second: { temp: 29, res: 485.9 }
};
context.calPhaseSensor = 'foot';
context.mqttPublishCalResult({ result: 'OK', diffOhm: 0.2 });

// 场景3: 身体标定失败（含 reason）
context.calPhaseSensor = 'body';
context.mqttPublishCalResult({ result: 'FAIL', diffOhm: 0.2, reason: '两次阻值差异超过1.5Ω' });

console.log('发布消息数: ' + published.length);
let ok = true;

// 场景1 校验：b 段含 r/df，顶层不含 r/df
const p1 = published[0];
console.log('场景1(身体OK) JSON: ' + JSON.stringify(p1));
if (p1.b.r !== 'OK' || p1.b.df !== 1.2) { ok = false; console.error('✘ 场景1: b.r/b.df 缺失'); }
if ('r' in p1 || 'df' in p1 || 'rsn' in p1) { ok = false; console.error('✘ 场景1: 顶层仍含 r/df/rsn'); }

// 场景2 校验：f 段含 r/df，b 段保留之前的 r/df
const p2 = published[1];
console.log('场景2(脚部OK) JSON: ' + JSON.stringify(p2));
if (p2.f.r !== 'OK' || p2.f.df !== 0.2) { ok = false; console.error('✘ 场景2: f.r/f.df 缺失'); }
if (p2.b.r !== 'OK' || p2.b.df !== 1.2) { ok = false; console.error('✘ 场景2: b 段历史 r/df 丢失'); }
if ('r' in p2 || 'df' in p2) { ok = false; console.error('✘ 场景2: 顶层仍含 r/df'); }

// 场景3 校验：b 段 FAIL + rsn，f 段保留 OK
const p3 = published[2];
console.log('场景3(身体FAIL) JSON: ' + JSON.stringify(p3));
if (p3.b.r !== 'FAIL' || p3.b.df !== 0.2 || p3.b.rsn !== '两次阻值差异超过1.5Ω') {
    ok = false; console.error('✘ 场景3: b 段 FAIL/df/rsn 异常');
}
if (p3.f.r !== 'OK') { ok = false; console.error('✘ 场景3: f 段历史 r 丢失'); }

console.log(ok ? '✔ index.html 发布结构校验通过' : '✘ 校验失败');
process.exit(ok ? 0 : 1);
