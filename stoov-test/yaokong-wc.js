// ╔══════════════════════════════════════════════════════════════╗
// ║      Web Component: <heating-panel>  (独立组件文件)           ║
// ║  属性: mode, power, hours, bodytemp, feettemp               ║
// ║  事件: data-change  { isOn, hours, bodyTemp, feetTemp }     ║
// ╚══════════════════════════════════════════════════════════════╝

class HeatingPanel extends HTMLElement {
    static get template() {
        return `
          <div class="panel">
            <div id="modeIndicator" class="mode-badge external">测试遥控</div>
            <div class="label label-main">Power / Timer</div>
            <div class="label label-left">Body</div>
            <div class="label label-right">Feet</div>
            <div id="main-ring-container">
              <div id="main-glass-ring" class="glass-ring"></div>
              <canvas id="main-ring-canvas" width="480" height="480"></canvas>
            </div>
            <div class="knob main-knob off" id="mainKnob">
              <div class="knob-text" id="mainText">OFF<br><span style="font-size:12px;opacity:0.7">CLICK TO START</span></div>
            </div>
            <div class="small-ring-container small-ring-left" id="leftRingContainer">
              <div class="glass-ring small-glass-ring dimmed" id="leftGlassRing"></div>
              <canvas class="small-ring-canvas dimmed" id="leftRingCanvas" width="200" height="200"></canvas>
            </div>
            <div class="knob small-knob knob-left dimmed" id="leftKnob">
              <div class="knob-text" id="leftText">OFF</div>
              <div class="knob-icon">🌡️</div>
            </div>
            <div class="small-ring-container small-ring-right" id="rightRingContainer">
              <div class="glass-ring small-glass-ring dimmed" id="rightGlassRing"></div>
              <canvas class="small-ring-canvas dimmed" id="rightRingCanvas" width="200" height="200"></canvas>
            </div>
            <div class="knob small-knob knob-right dimmed" id="rightKnob">
              <div class="knob-text" id="rightText">OFF</div>
              <div class="knob-icon">🦶</div>
            </div>
          </div>`;
    }

    static get styles() {
        return `
          :host { display: inline-block; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          .panel {
            position: relative; width: 420px; height: 420px; border-radius: 40px;
            background:
              url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E"),
              radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.2) 0%, transparent 50%),
              radial-gradient(ellipse at 50% 100%, rgba(0,0,0,0.3) 0%, transparent 50%),
              linear-gradient(160deg, #d4744a 0%, #8b1a0a 100%);
            background-blend-mode: overlay, normal, normal, normal;
            user-select: none; -webkit-user-select: none;
            box-shadow: inset 0 1px 1px rgba(255,255,255,0.5), inset 0 -2px 4px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.4), 0 8px 20px rgba(0,0,0,0.5), 0 25px 60px rgba(0,0,0,0.6), 0 -5px 15px rgba(255,100,50,0.05);
          }
          .knob {
            position: absolute; border-radius: 50%; display: flex; flex-direction: column;
            justify-content: center; align-items: center; cursor: grab;
            transition: filter 0.4s ease, opacity 0.4s ease, box-shadow 0.15s ease, transform 0.15s ease;
            background: radial-gradient(circle at 35% 30%, rgba(255,255,255,0.7) 0%, transparent 35%), radial-gradient(circle at 50% 50%, #e0e0e0 0%, #757575 100%);
            box-shadow: 0 6px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.8), inset 0 -2px 4px rgba(0,0,0,0.2);
          }
          .knob.pressed { cursor: grabbing; box-shadow: 0 1px 2px rgba(0,0,0,0.3), inset 0 4px 8px rgba(0,0,0,0.5), inset 0 1px 2px rgba(0,0,0,0.3); }
          .small-knob.dimmed { filter: grayscale(0.5) brightness(0.75); transition: filter 0.4s ease; }
          .main-knob.pressed  { transform: translate(-50%, -50%) scale(0.98); }
          .small-knob.pressed  { transform: scale(0.97); }
          .knob-text { font-weight: 800; color: #333; text-shadow: 0 1px 1px rgba(255,255,255,0.6); pointer-events: none; line-height: 1.2; text-align: center; z-index: 2; }
          .knob-icon { font-size: 1em; opacity: 0.9; pointer-events: none; margin-top: 2px; z-index: 2; filter: drop-shadow(0 1px 1px rgba(255,255,255,0.4)); }
          .main-knob {
            top: calc(50% - 30px); left: 50%; transform: translate(-50%, -50%);
            width: 160px; height: 160px; z-index: 10;
            background: radial-gradient(circle at 35% 30%, rgba(255,255,255,0.6) 0%, transparent 35%), radial-gradient(circle at 50% 50%, #ffab91 0%, #bf360c 100%);
          }
          .main-knob .knob-text { font-size: 24px; color: #5d1a00; text-shadow: 0 1px 1px rgba(255,255,255,0.4); }
          .main-knob.off { filter: brightness(0.85) saturate(0.7); }
          .main-knob.off .knob-text { opacity: 0.6; }
          .glass-ring {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: 50%;
            background: rgba(255,255,255,0.25); backdrop-filter: blur(6px) saturate(1.2);
            -webkit-backdrop-filter: blur(6px) saturate(1.2);
            box-shadow: inset 0 1px 2px rgba(255,255,255,0.2), inset 0 -1px 2px rgba(0,0,0,0.1);
            opacity: 1; transition: filter 0.4s ease, opacity 0.4s ease;
          }
          #main-glass-ring { mask: radial-gradient(closest-side, transparent 62%, black 64%, black 88%, transparent 90%); -webkit-mask: radial-gradient(closest-side, transparent 62%, black 64%, black 88%, transparent 90%); }
          .small-glass-ring { mask: radial-gradient(closest-side, transparent 58%, black 62%, black 85%, transparent 89%); -webkit-mask: radial-gradient(closest-side, transparent 58%, black 62%, black 85%, transparent 89%); }
          .glass-ring.dimmed { filter: grayscale(1) brightness(0.6); opacity: 0.7; }
          #main-ring-container { position: absolute; top: calc(50% - 30px); left: 50%; transform: translate(-50%, -50%); width: 240px; height: 240px; pointer-events: none; z-index: 9; }
          #main-ring-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; transition: opacity 0.3s ease; }
          .small-knob { width: 80px; height: 80px; z-index: 5; }
          .small-knob .knob-text { font-size: 14px; }
          .knob-left  { bottom: 35px; left: 55px; }
          .knob-right { bottom: 35px; right: 55px; }
          .small-ring-container { position: absolute; width: 100px; height: 100px; pointer-events: none; z-index: 4; }
          .small-ring-left  { bottom: 25px; left: 45px; }
          .small-ring-right { bottom: 25px; right: 45px; }
          .small-ring-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; transition: filter 0.4s ease, opacity 0.4s ease; }
          .small-ring-canvas.dimmed { filter: grayscale(1) brightness(0.6); opacity: 0.7; }
          .label { position: absolute; color: rgba(100,30,0,0.6); font-size: 12px; font-weight: 900; letter-spacing: 1.5px; pointer-events: none; z-index: 1; text-transform: uppercase; text-shadow: 1px 1px 0 rgba(255,255,255,0.3), -0.5px -0.5px 0 rgba(0,0,0,0.1); }
          .label-main  { top: 25px; left: 50%; transform: translateX(-50%); }
          .label-left  { bottom: 140px; left: 55px; }
          .label-right { bottom: 140px; right: 55px; }
          .mode-badge {
            position: absolute; top: 16px; right: 22px; padding: 5px 14px; border-radius: 14px;
            font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: #fff; z-index: 20;
            pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,0.4);
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: all 0.4s ease;
          }
          .mode-badge.external { background: rgba(0,100,200,0.55); box-shadow: 0 0 14px rgba(0,140,255,0.35), inset 0 1px 1px rgba(255,255,255,0.2); }
          .mode-badge.internal { background: rgba(200,80,10,0.55); box-shadow: 0 0 14px rgba(255,130,40,0.4), inset 0 1px 1px rgba(255,255,255,0.2); }
          .knob.readonly { cursor: default !important; }
          .knob.readonly:active { cursor: default !important; }
        `;
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._mode = 'external';
        this._power = false;
        this._hours = 1;
        this._bodyTemp = 0;
        this._feetTemp = 0;
        this._state = {
            isOn: false,
            main: { value: 1, min: 1, max: 12, step: 1 },
            left: { value: 0, min: 0, max: 36, minWork: 25, step: 1 },
            right: { value: 0, min: 0, max: 40, minWork: 25, step: 1 }
        };
        this._els = {};
        this._ctx = {};
        this._rafId = null;
        this._initialized = false;
        this._dataChangeCallback = null;
    }

    static get observedAttributes() { return ['mode', 'power', 'hours', 'bodytemp', 'feettemp']; }

    connectedCallback() {
        if (!this._initialized) {
            this.shadowRoot.innerHTML = `<style>${HeatingPanel.styles}</style>${HeatingPanel.template}`;
            this._cacheElements();
            this._initCanvases();
            this._initKnobInteractions();
            this._initialized = true;
        }
        this._syncFromAttributes();
        this._updateKnobsReadonly();
        this._scheduleUI();
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (!this._initialized || oldVal === newVal) return;
        this._syncFromAttributes();
        if (this._mode === 'external') this._scheduleUI();
    }

    get mode() { return this._mode; }
    set mode(v) {
        if (v !== 'external' && v !== 'internal') return;
        if (v === this._mode) return;
        if (v === 'internal' && this._mode === 'external') {
            this._state.isOn = this._power;
            this._state.main.value = this._hours;
            this._state.left.value = this._bodyTemp;
            this._state.right.value = this._feetTemp;
        }
        this._mode = v;
        this.setAttribute('mode', v);
        this._updateKnobsReadonly();
        this._scheduleUI();
    }

    get power() { return this._power; }
    set power(v) { this._power = !!v; this.setAttribute('power', v ? 'on' : 'off'); if (this._mode === 'external') this._scheduleUI(); }

    get hours() { return this._hours; }
    set hours(v) { this._hours = Math.max(1, Math.min(12, parseInt(v) || 1)); this.setAttribute('hours', this._hours); if (this._mode === 'external') this._scheduleUI(); }

    get bodyTemp() { return this._bodyTemp; }
    set bodyTemp(v) { this._bodyTemp = Math.max(0, Math.min(36, parseInt(v) || 0)); this.setAttribute('bodytemp', this._bodyTemp); if (this._mode === 'external') this._scheduleUI(); }

    get feetTemp() { return this._feetTemp; }
    set feetTemp(v) { this._feetTemp = Math.max(0, Math.min(40, parseInt(v) || 0)); this.setAttribute('feettemp', this._feetTemp); if (this._mode === 'external') this._scheduleUI(); }

    onDataChange(cb) { this._dataChangeCallback = cb; }

    getState() {
        const ext = this._mode === 'external';
        return {
            mode: this._mode, isOn: ext ? this._power : this._state.isOn,
            hours: ext ? this._hours : this._state.main.value,
            bodyTemp: ext ? this._bodyTemp : this._state.left.value,
            feetTemp: ext ? this._feetTemp : this._state.right.value
        };
    }

    _syncFromAttributes() {
        this._mode = this.getAttribute('mode') || 'external';
        if (this._mode !== 'external' && this._mode !== 'internal') this._mode = 'external';
        this._power = this.getAttribute('power') === 'on';
        this._hours = Math.max(1, Math.min(12, parseInt(this.getAttribute('hours')) || 1));
        this._bodyTemp = Math.max(0, Math.min(36, parseInt(this.getAttribute('bodytemp')) || 0));
        this._feetTemp = Math.max(0, Math.min(40, parseInt(this.getAttribute('feettemp')) || 0));
    }

    _cacheElements() {
        const s = this.shadowRoot;
        this._els = {
            mainKnob: s.getElementById('mainKnob'), leftKnob: s.getElementById('leftKnob'), rightKnob: s.getElementById('rightKnob'),
            mainText: s.getElementById('mainText'), leftText: s.getElementById('leftText'), rightText: s.getElementById('rightText'),
            mainCanvas: s.getElementById('main-ring-canvas'), leftCanvas: s.getElementById('leftRingCanvas'), rightCanvas: s.getElementById('rightRingCanvas'),
            leftGlass: s.getElementById('leftGlassRing'), rightGlass: s.getElementById('rightGlassRing'), modeIndicator: s.getElementById('modeIndicator')
        };
    }

    _initCanvases() {
        this._ctx = {
            main: this._els.mainCanvas.getContext('2d'), left: this._els.leftCanvas.getContext('2d'), right: this._els.rightCanvas.getContext('2d')
        };
    }

    _scheduleUI() {
        if (this._rafId) return;
        this._rafId = requestAnimationFrame(() => { this._rafId = null; this._updateUI(); });
    }

    _getDisplayData() {
        if (this._mode === 'external') return { isOn: this._power, main: this._hours, left: this._bodyTemp, right: this._feetTemp };
        return { isOn: this._state.isOn, main: this._state.main.value, left: this._state.left.value, right: this._state.right.value };
    }

    _getRingPercent(value, minWork, max) {
        if (value <= 0) return 0;
        const clamped = Math.max(minWork, Math.min(max, value));
        const MIN_ARC = 0.08; const range = max - minWork;
        if (range <= 0) return MIN_ARC;
        return MIN_ARC + (1 - MIN_ARC) * ((clamped - minWork) / range);
    }

    _drawRing(cvs, c, percent, lineWidth, activeColor, constantBright) {
        const w = cvs.width, h = cvs.height, cx = w / 2, cy = h / 2;
        const radius = (Math.min(w, h) / 2) - (lineWidth / 2) - 6;
        c.clearRect(0, 0, w, h);
        if (percent <= 0) return;
        const endAngle = -Math.PI / 2 + Math.PI * 2 * Math.min(percent, 1);
        c.beginPath(); c.arc(cx, cy, radius, -Math.PI / 2, endAngle);
        if (constantBright || percent >= 0.99) { c.strokeStyle = '#fff'; c.shadowColor = '#fff'; c.shadowBlur = 25; }
        else { const a = (0.4 + percent * 0.6).toFixed(2); c.strokeStyle = activeColor.replace('{alpha}', a); c.shadowColor = activeColor.replace('{alpha}', '0.6'); c.shadowBlur = 12; }
        c.lineWidth = lineWidth - 6; c.lineCap = 'round'; c.stroke(); c.shadowBlur = 0;
    }

    _updateUI() {
        const els = this._els, ctx = this._ctx, display = this._getDisplayData(), isOn = display.isOn;
        if (isOn) {
            els.mainKnob.classList.remove('off');
            els.mainText.innerHTML = `${display.main}<br><span style="font-size:13px;opacity:0.8">HOURS</span>`;
            els.mainCanvas.style.opacity = '1';
            this._drawRing(els.mainCanvas, ctx.main, display.main / this._state.main.max, 56, 'rgba(255,255,255,{alpha})', true);
        } else {
            els.mainKnob.classList.add('off');
            els.mainText.innerHTML = 'OFF<br><span style="font-size:12px;opacity:0.7">CLICK TO START</span>';
            els.mainCanvas.style.opacity = '0'; ctx.main.clearRect(0, 0, 480, 480);
        }
        const dimAct = isOn ? 'remove' : 'add';
        [['left', els.leftKnob, els.leftGlass, els.leftCanvas, els.leftText, ctx.left, this._state.left, 'rgba(100,200,255,{alpha})', display.left],
         ['right', els.rightKnob, els.rightGlass, els.rightCanvas, els.rightText, ctx.right, this._state.right, 'rgba(180,220,255,{alpha})', display.right]
        ].forEach(([_, knob, glass, canvas, text, c, s, color, displayVal]) => {
            glass.classList[dimAct]('dimmed'); canvas.classList[dimAct]('dimmed'); knob.classList[dimAct]('dimmed');
            text.textContent = displayVal <= 0 ? 'OFF' : `${displayVal}°`;
            this._drawRing(canvas, c, this._getRingPercent(displayVal, s.minWork, s.max), 16, color, false);
        });
        this._updateModeIndicator();
    }

    _updateModeIndicator() {
        const badge = this._els.modeIndicator;
        if (this._mode === 'external') { badge.textContent = '测试遥控'; badge.className = 'mode-badge external'; }
        else { badge.textContent = '测试加热'; badge.className = 'mode-badge internal'; }
    }

    _updateKnobsReadonly() {
        const readonly = this._mode === 'external';
        [this._els.mainKnob, this._els.leftKnob, this._els.rightKnob].forEach(k => k.classList.toggle('readonly', readonly));
    }

    _sendToExternal() {
        const data = { isOn: this._state.isOn, hours: this._state.main.value, bodyTemp: this._state.left.value, feetTemp: this._state.right.value };
        this.dispatchEvent(new CustomEvent('data-change', { detail: data, bubbles: true, composed: true }));
        if (window.parent !== window) window.parent.postMessage({ type: 'heatingDataChange', data }, '*');
        if (typeof this._dataChangeCallback === 'function') this._dataChangeCallback(data);
    }

    _initKnobInteractions() {
        const self = this;
        function createInteraction(knobEl, stateRef, opts = {}) {
            const { isToggle = false, dragStep = 2, snapZone = 4, deadZone = 5 } = opts;
            let active = false, startY = 0, startVal = 0, moved = false;
            function getY(e) { return e.clientY; }
            function onDown(e) {
                if (self._mode === 'external') return;
                if (e.button !== undefined && e.button !== 0) return;
                e.preventDefault(); knobEl.setPointerCapture(e.pointerId);
                active = true; moved = false; startY = getY(e); startVal = stateRef.value;
                knobEl.classList.add('pressed');
            }
            function onMove(e) {
                if (!active) return;
                const dy = startY - getY(e);
                if (Math.abs(dy) < deadZone && !moved) return;
                moved = true; if (isToggle && !self._state.isOn) return;
                const s = stateRef, step = s.step || 1;
                let raw = startVal + Math.round(dy / dragStep) * step;
                if (snapZone > 0 && raw <= snapZone) raw = 0;
                else if (s.minWork && raw > 0 && raw < s.minWork) raw = (dy < 0 && startVal === 0) ? s.minWork : (raw < s.minWork / 2 ? 0 : s.minWork);
                const nv = Math.max(s.min ?? 0, Math.min(s.max ?? 100, raw));
                if (nv !== stateRef.value) { stateRef.value = nv; self._scheduleUI(); }
            }
            function onUp(e) {
                if (!active) return; active = false;
                knobEl.releasePointerCapture?.(e.pointerId); knobEl.classList.remove('pressed');
                if (isToggle && !moved) {
                    self._state.isOn = !self._state.isOn; self._scheduleUI();
                    if (self._mode === 'internal') self._sendToExternal();
                    return;
                }
                const s = stateRef;
                if (s.minWork && stateRef.value > 0 && stateRef.value < s.minWork) { stateRef.value = (stateRef.value < s.minWork / 2) ? 0 : s.minWork; self._scheduleUI(); }
                if (self._mode === 'internal' && moved) self._sendToExternal();
            }
            function onWheel(e) {
                if (self._mode === 'external') return;
                if (isToggle && !self._state.isOn) return;
                e.preventDefault(); const s = stateRef, step = s.step || 1;
                const delta = e.deltaY > 0 ? -step : step; let raw = stateRef.value + delta;
                if (s.minWork && raw > 0 && raw < s.minWork) raw = delta > 0 ? s.minWork : 0;
                const nv = Math.max(s.min ?? 0, Math.min(s.max ?? 100, raw));
                if (nv !== stateRef.value) { stateRef.value = nv; self._scheduleUI(); if (self._mode === 'internal') self._sendToExternal(); }
            }
            knobEl.addEventListener('pointerdown', onDown);
            knobEl.addEventListener('pointermove', onMove);
            knobEl.addEventListener('pointerup', onUp);
            knobEl.addEventListener('pointercancel', onUp);
            knobEl.addEventListener('wheel', onWheel, { passive: false });
            knobEl.addEventListener('dblclick', e => e.preventDefault());
            knobEl.style.touchAction = 'none';
        }
        createInteraction(this._els.mainKnob, this._state.main, { isToggle: true, dragStep: 3, snapZone: 0, deadZone: 5 });
        createInteraction(this._els.leftKnob, this._state.left, { dragStep: 2, snapZone: 4 });
        createInteraction(this._els.rightKnob, this._state.right, { dragStep: 2, snapZone: 4 });
    }
}

customElements.define('heating-panel', HeatingPanel);
