(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))s(i);new MutationObserver(i=>{for(const n of i)if(n.type==="childList")for(const r of n.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&s(r)}).observe(document,{childList:!0,subtree:!0});function t(i){const n={};return i.integrity&&(n.integrity=i.integrity),i.referrerPolicy&&(n.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?n.credentials="include":i.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function s(i){if(i.ep)return;i.ep=!0;const n=t(i);fetch(i.href,n)}})();var C={WORK:2817,ERROR:2818,END:2820,CTRL_WORK:2561,TH:2565,PERIODIC_TEMP:2566,UNITO_MSGTYPE_SYSID:2567,UNITO_SET_TEMP01C:2568,UNITO_SET_TIME:2569,UNITO_SET_REBOOT:2571,UNITO_SET_CLEAR_FAULT:2572,UNITO_MSGTYPE_SIM_TEMP:2573},E={GET:1,SET:2,CLEAR:3,RESPONSE:4,REPORT:5},M=class{constructor(){this.receivedBuffer=new Uint8Array}parseReceivedData(a){if(!a||a.length===0)return[];this.receivedBuffer=this.concatArrays(this.receivedBuffer,a);const e=[];let t=0;for(;t<this.receivedBuffer.length;){const s=this.findFrameHeader(this.receivedBuffer,t);if(s===-1){this.receivedBuffer=this.receivedBuffer.slice(t);break}if(this.receivedBuffer.length-s>=9){const i=7+this.receivedBuffer[s+6]+2;if(this.receivedBuffer.length-s>=i){const n=this.receivedBuffer.slice(s,s+i);this.verifyChecksum(n)?(e.push(n),t=s+i):t=s+1}else{this.receivedBuffer=this.receivedBuffer.slice(t);break}}else{this.receivedBuffer=this.receivedBuffer.slice(t);break}}return this.receivedBuffer=this.receivedBuffer.slice(t),e}parseMessage(a){if(a.length<9||a[a.length-1]!==255)return null;const e=a[6];return a.length!==7+e+2?null:{targetAddr:a[1],senderAddr:a[2],msgId:a[4]<<8|a[3],msgOp:a[5],payload:Array.from(a.slice(7,7+e)),checksum:a[7+e],endByte:a[7+e+1],timestamp:Date.now()}}findFrameHeader(a,e){for(let t=e;t<=a.length-3;t++)if(a[t]===0)return t;return-1}verifyChecksum(a){if(a.length<9||a[a.length-1]!==255)return!1;const e=a.length-2,t=a[e];let s=0;for(let i=0;i<e;i++)s+=a[i];return t===(256-(s&127)&255)}concatArrays(a,e){const t=new Uint8Array(a.length+e.length);return t.set(a,0),t.set(e,a.length),t}},O=class{assembleMessage(a,e,t,s,i=[]){const n=7+i.length+2,r=new Uint8Array(n);r[0]=0,r[1]=a,r[2]=e,r[3]=t&255,r[4]=t>>8&255,r[5]=s,r[6]=i.length,i.length>0&&r.set(i,7);let c=0;for(let d=0;d<n-2;d++)c+=r[d];return r[n-2]=256-(c&127)&255,r[n-1]=255,r}};window.MSGTYPE=C;window.MSGOP=E;window.SerialDataParser=M;window.SerialDataAssembler=O;var A=class y extends HTMLElement{static get template(){return`
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
          </div>`}static get styles(){return`
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
        `}constructor(){super(),this.attachShadow({mode:"open"}),this._mode="external",this._power=!1,this._hours=1,this._bodyTemp=0,this._feetTemp=0,this._state={isOn:!1,main:{value:1,min:1,max:12,step:1},left:{value:0,min:0,max:36,minWork:25,step:1},right:{value:0,min:0,max:40,minWork:25,step:1}},this._els={},this._ctx={},this._rafId=null,this._initialized=!1,this._dataChangeCallback=null}static get observedAttributes(){return["mode","power","hours","bodytemp","feettemp"]}connectedCallback(){this._initialized||(this.shadowRoot.innerHTML=`<style>${y.styles}</style>${y.template}`,this._cacheElements(),this._initCanvases(),this._initKnobInteractions(),this._initialized=!0),this._syncFromAttributes(),this._updateKnobsReadonly(),this._scheduleUI()}attributeChangedCallback(e,t,s){!this._initialized||t===s||(this._syncFromAttributes(),this._mode==="external"&&this._scheduleUI())}get mode(){return this._mode}set mode(e){e!=="external"&&e!=="internal"||e!==this._mode&&(e==="internal"&&this._mode==="external"&&(this._state.isOn=this._power,this._state.main.value=this._hours,this._state.left.value=this._bodyTemp,this._state.right.value=this._feetTemp),this._mode=e,this.setAttribute("mode",e),this._updateKnobsReadonly(),this._scheduleUI())}get power(){return this._power}set power(e){this._power=!!e,this.setAttribute("power",e?"on":"off"),this._mode==="external"&&this._scheduleUI()}get hours(){return this._hours}set hours(e){this._hours=Math.max(1,Math.min(12,parseInt(e)||1)),this.setAttribute("hours",this._hours),this._mode==="external"&&this._scheduleUI()}get bodyTemp(){return this._bodyTemp}set bodyTemp(e){this._bodyTemp=Math.max(0,Math.min(36,parseInt(e)||0)),this.setAttribute("bodytemp",this._bodyTemp),this._mode==="external"&&this._scheduleUI()}get feetTemp(){return this._feetTemp}set feetTemp(e){this._feetTemp=Math.max(0,Math.min(40,parseInt(e)||0)),this.setAttribute("feettemp",this._feetTemp),this._mode==="external"&&this._scheduleUI()}onDataChange(e){this._dataChangeCallback=e}getState(){const e=this._mode==="external";return{mode:this._mode,isOn:e?this._power:this._state.isOn,hours:e?this._hours:this._state.main.value,bodyTemp:e?this._bodyTemp:this._state.left.value,feetTemp:e?this._feetTemp:this._state.right.value}}_syncFromAttributes(){this._mode=this.getAttribute("mode")||"external",this._mode!=="external"&&this._mode!=="internal"&&(this._mode="external"),this._power=this.getAttribute("power")==="on",this._hours=Math.max(1,Math.min(12,parseInt(this.getAttribute("hours"))||1)),this._bodyTemp=Math.max(0,Math.min(36,parseInt(this.getAttribute("bodytemp"))||0)),this._feetTemp=Math.max(0,Math.min(40,parseInt(this.getAttribute("feettemp"))||0))}_cacheElements(){const e=this.shadowRoot;this._els={mainKnob:e.getElementById("mainKnob"),leftKnob:e.getElementById("leftKnob"),rightKnob:e.getElementById("rightKnob"),mainText:e.getElementById("mainText"),leftText:e.getElementById("leftText"),rightText:e.getElementById("rightText"),mainCanvas:e.getElementById("main-ring-canvas"),leftCanvas:e.getElementById("leftRingCanvas"),rightCanvas:e.getElementById("rightRingCanvas"),leftGlass:e.getElementById("leftGlassRing"),rightGlass:e.getElementById("rightGlassRing"),modeIndicator:e.getElementById("modeIndicator")}}_initCanvases(){this._ctx={main:this._els.mainCanvas.getContext("2d"),left:this._els.leftCanvas.getContext("2d"),right:this._els.rightCanvas.getContext("2d")}}_scheduleUI(){this._rafId||(this._rafId=requestAnimationFrame(()=>{this._rafId=null,this._updateUI()}))}_getDisplayData(){return this._mode==="external"?{isOn:this._power,main:this._hours,left:this._bodyTemp,right:this._feetTemp}:{isOn:this._state.isOn,main:this._state.main.value,left:this._state.left.value,right:this._state.right.value}}_getRingPercent(e,t,s){if(e<=0)return 0;const i=Math.max(t,Math.min(s,e)),n=.08,r=s-t;return r<=0?n:n+(1-n)*((i-t)/r)}_drawRing(e,t,s,i,n,r){const c=e.width,d=e.height,u=c/2,p=d/2,b=Math.min(c,d)/2-i/2-6;if(t.clearRect(0,0,c,d),s<=0)return;const f=-Math.PI/2+Math.PI*2*Math.min(s,1);if(t.beginPath(),t.arc(u,p,b,-Math.PI/2,f),r||s>=.99)t.strokeStyle="#fff",t.shadowColor="#fff",t.shadowBlur=25;else{const g=(.4+s*.6).toFixed(2);t.strokeStyle=n.replace("{alpha}",g),t.shadowColor=n.replace("{alpha}","0.6"),t.shadowBlur=12}t.lineWidth=i-6,t.lineCap="round",t.stroke(),t.shadowBlur=0}_updateUI(){const e=this._els,t=this._ctx,s=this._getDisplayData(),i=s.isOn;i?(e.mainKnob.classList.remove("off"),e.mainText.innerHTML=`${s.main}<br><span style="font-size:13px;opacity:0.8">HOURS</span>`,e.mainCanvas.style.opacity="1",this._drawRing(e.mainCanvas,t.main,s.main/this._state.main.max,56,"rgba(255,255,255,{alpha})",!0)):(e.mainKnob.classList.add("off"),e.mainText.innerHTML='OFF<br><span style="font-size:12px;opacity:0.7">CLICK TO START</span>',e.mainCanvas.style.opacity="0",t.main.clearRect(0,0,480,480));const n=i?"remove":"add";[["left",e.leftKnob,e.leftGlass,e.leftCanvas,e.leftText,t.left,this._state.left,"rgba(100,200,255,{alpha})",s.left],["right",e.rightKnob,e.rightGlass,e.rightCanvas,e.rightText,t.right,this._state.right,"rgba(180,220,255,{alpha})",s.right]].forEach(([r,c,d,u,p,b,f,g,x])=>{d.classList[n]("dimmed"),u.classList[n]("dimmed"),c.classList[n]("dimmed"),p.textContent=x<=0?"OFF":`${x}°`,this._drawRing(u,b,this._getRingPercent(x,f.minWork,f.max),16,g,!1)}),this._updateModeIndicator()}_updateModeIndicator(){const e=this._els.modeIndicator;this._mode==="external"?(e.textContent="测试遥控",e.className="mode-badge external"):(e.textContent="测试加热",e.className="mode-badge internal")}_updateKnobsReadonly(){const e=this._mode==="external";[this._els.mainKnob,this._els.leftKnob,this._els.rightKnob].forEach(t=>t.classList.toggle("readonly",e))}_sendToExternal(){const e={isOn:this._state.isOn,hours:this._state.main.value,bodyTemp:this._state.left.value,feetTemp:this._state.right.value};this.dispatchEvent(new CustomEvent("data-change",{detail:e,bubbles:!0,composed:!0})),window.parent!==window&&window.parent.postMessage({type:"heatingDataChange",data:e},"*"),typeof this._dataChangeCallback=="function"&&this._dataChangeCallback(e)}_initKnobInteractions(){const e=this;function t(s,i,n={}){const{isToggle:r=!1,dragStep:c=2,snapZone:d=4,deadZone:u=5}=n;let p=!1,b=0,f=0,g=!1;function x(o){return o.clientY}function T(o){e._mode!=="external"&&(o.button!==void 0&&o.button!==0||(o.preventDefault(),s.setPointerCapture(o.pointerId),p=!0,g=!1,b=x(o),f=i.value,s.classList.add("pressed")))}function k(o){if(!p)return;const l=b-x(o);if(Math.abs(l)<u&&!g||(g=!0,r&&!e._state.isOn))return;const m=i,v=m.step||1;let h=f+Math.round(l/c)*v;d>0&&h<=d?h=0:m.minWork&&h>0&&h<m.minWork&&(h=l<0&&f===0?m.minWork:h<m.minWork/2?0:m.minWork);const _=Math.max(m.min??0,Math.min(m.max??100,h));_!==i.value&&(i.value=_,e._scheduleUI())}function w(o){if(!p)return;if(p=!1,s.releasePointerCapture?.(o.pointerId),s.classList.remove("pressed"),r&&!g){e._state.isOn=!e._state.isOn,e._scheduleUI(),e._mode==="internal"&&e._sendToExternal();return}const l=i;l.minWork&&i.value>0&&i.value<l.minWork&&(i.value=i.value<l.minWork/2?0:l.minWork,e._scheduleUI()),e._mode==="internal"&&g&&e._sendToExternal()}function I(o){if(e._mode==="external"||r&&!e._state.isOn)return;o.preventDefault();const l=i,m=l.step||1,v=o.deltaY>0?-m:m;let h=i.value+v;l.minWork&&h>0&&h<l.minWork&&(h=v>0?l.minWork:0);const _=Math.max(l.min??0,Math.min(l.max??100,h));_!==i.value&&(i.value=_,e._scheduleUI(),e._mode==="internal"&&e._sendToExternal())}s.addEventListener("pointerdown",T),s.addEventListener("pointermove",k),s.addEventListener("pointerup",w),s.addEventListener("pointercancel",w),s.addEventListener("wheel",I,{passive:!1}),s.addEventListener("dblclick",o=>o.preventDefault()),s.style.touchAction="none"}t(this._els.mainKnob,this._state.main,{isToggle:!0,dragStep:3,snapZone:0,deadZone:5}),t(this._els.leftKnob,this._state.left,{dragStep:2,snapZone:4}),t(this._els.rightKnob,this._state.right,{dragStep:2,snapZone:4})}};customElements.define("heating-panel",A);
