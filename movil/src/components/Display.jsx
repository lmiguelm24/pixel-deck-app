import { useEffect, useRef } from 'react';
import { fmtTime } from '../lib/format.js';

// Pantalla hi-fi: reloj, título, espectro real y medidores VU izquierdo/derecho
export default function Display({ engine, title, trackKey, time, duration, playing, mixing, source, offline, party, showRemaining, onToggleTime, onExpand }) {
  const specRef = useRef(null);
  const vuRef = useRef(null);
  const shellRef = useRef(null);
  const st = useRef({});
  st.current = { party, playing };

  useEffect(() => {
    const sc = specRef.current, vc = vuRef.current, shell = shellRef.current;
    const gs = sc.getContext('2d'), gv = vc.getContext('2d');
    const BARS = 26;
    const lv = new Float32Array(BARS), pk = new Float32Array(BARS);
    const vu = { l: 0, r: 0, pl: 0, pr: 0, hl: 0, hr: 0 };
    let raf;

    const fit = (c) => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      return [w, h];
    };

    const color = (l) => (l > 0.82 ? '#f1ca68' : l > 0.58 ? '#80efa6' : '#1ed760');

    const draw = () => {
      const L = engine ? engine.levels() : null;
      const partyOn = st.current.party;

      // espectro (escala logarítmica)
      const [w, h] = fit(sc);
      gs.clearRect(0, 0, w, h);
      const gap = 3, bw = (w - gap * (BARS - 1)) / BARS, seg = 4;
      for (let i = 0; i < BARS; i++) {
        let v = 0;
        if (L) {
          const n = L.spectrum.length * 0.8;
          const a = Math.floor(Math.pow(i / BARS, 1.8) * n), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / BARS, 1.8) * n));
          let s = 0;
          for (let k = a; k < b; k++) s += L.spectrum[k];
          v = s / (b - a) / 255;
        }
        lv[i] = v > lv[i] ? v : lv[i] * 0.86 + v * 0.14;           // sube rápido, cae suave
        const bh = Math.round((lv[i] * h) / seg) * seg;
        pk[i] = Math.max(pk[i] - 0.45, bh);
        const x = i * (bw + gap);
        for (let y = h - seg; y >= h - bh; y -= seg) {
          gs.fillStyle = color(1 - y / h);
          gs.fillRect(x, y + 1, bw, seg - 1.5);
        }
        gs.globalAlpha = 0.12; gs.fillStyle = '#1ed760'; gs.fillRect(x, h - 2, bw, 2); gs.globalAlpha = 1;
        if (pk[i] > 2) { gs.fillStyle = '#bcf8d1'; gs.fillRect(x, h - pk[i] - 2, bw, 1.5); }
      }

      // VU izquierdo / derecho con retención de pico
      const [vw, vh] = fit(vc);
      gv.clearRect(0, 0, vw, vh);
      const targetL = L ? L.vuL : 0, targetR = L ? L.vuR : 0;
      vu.l = targetL > vu.l ? vu.l + (targetL - vu.l) * 0.6 : vu.l * 0.92;
      vu.r = targetR > vu.r ? vu.r + (targetR - vu.r) * 0.6 : vu.r * 0.92;
      const now = performance.now();
      if (vu.l >= vu.pl) { vu.pl = vu.l; vu.hl = now; } else if (now - vu.hl > 900) vu.pl *= 0.97;
      if (vu.r >= vu.pr) { vu.pr = vu.r; vu.hr = now; } else if (now - vu.hr > 900) vu.pr *= 0.97;
      const rowH = (vh - 4) / 2, segW = 5, segs = Math.floor((vw - 16) / segW);
      [[vu.l, vu.pl, 'L'], [vu.r, vu.pr, 'R']].forEach(([val, peak, lbl], row) => {
        const y = row * (rowH + 4);
        gv.fillStyle = '#91b39d'; gv.font = '8px monospace'; gv.fillText(lbl, 0, y + rowH - 1);
        const lit = Math.round(val * segs), pkSeg = Math.round(peak * segs);
        for (let s = 0; s < segs; s++) {
          const f = s / segs;
          const on = s < lit || s === pkSeg - 1;
          gv.globalAlpha = on ? 0.95 : 0.1;
          gv.fillStyle = f > 0.88 ? '#ff8c85' : f > 0.7 ? '#f1ca68' : '#1ed760';
          gv.fillRect(10 + s * segW, y, segW - 1.5, rowH);
        }
        gv.globalAlpha = 1;
      });

      // modo fiesta: la pantalla late con el golpe
      const beat = L && partyOn ? L.beat : 0;
      shell.style.setProperty('--beat', beat.toFixed(3));
      shell.classList.toggle('limit', !!(L && L.limiting));
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const clock = showRemaining && isFinite(duration) ? '-' + fmtTime(duration - time) : fmtTime(time).padStart(5, '0');

  return (
    <section ref={shellRef} className={'display' + (party ? ' party' : '') + (playing ? ' on' : '')}>
      <div className="display-top">
        <span className={'state' + (playing ? ' blink' : '')}>{playing ? '▶' : title ? '❚❚' : '■'}</span>
        <span className="clock" onClick={onToggleTime}>{clock}</span>
        <div className="lamps">
          <span className={'lamp' + (source === 'cloud' ? ' on blue' : '')}>NUBE</span>
          <span className={'lamp' + (source === 'audius' ? ' on' : '')}>AUDIUS</span>
          <span className={'lamp' + (source === 'local' ? ' on' : '')}>EN EL TELÉFONO</span>
          <span className={'lamp' + (mixing ? ' on green' : '')}>MEZCLANDO</span>
          <span className={'lamp' + (offline ? ' on red' : '')}>SIN SEÑAL</span>
        </div>
      </div>
      <div className="marquee" onClick={onExpand}>
        <span key={trackKey || 'none'} className={'track-in' + (title && title.length > 34 ? ' scroll' : '')}>
          {title || 'PIXEL DECK · ELIGE UNA CANCIÓN'}
        </span>
      </div>
      <canvas ref={specRef} className="meter" />
      <canvas ref={vuRef} className="vu" />
      {party && <div className="party-tag">MODO FIESTA</div>}
    </section>
  );
}
