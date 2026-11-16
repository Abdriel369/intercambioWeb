(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const COLORS = ['#9f1d24', '#14532d'];
  const GOLD = '#dfb74d';
  const CREAM = '#fff8ea';

  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  class Wheel {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.names = [];
      this.rotation = 0;
      this.animating = false;
      this.size = 360;

      this.resize = this.resize.bind(this);
      this.draw = this.draw.bind(this);

      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => {
          this.resize();
          if (!this.animating) this.draw();
        });
        this.observer.observe(canvas);
      }
      window.addEventListener('resize', this.resize);
      this.resize();
      this.draw();
    }

    setNames(names) {
      this.names = Array.isArray(names) ? names.slice() : [];
      this.rotation = 0;
      this.resize();
      this.draw();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const cssSize = Math.max(240, Math.min(720, rect.width || 360));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixels = Math.round(cssSize * dpr);
      this.size = cssSize;
      if (this.canvas.width !== pixels || this.canvas.height !== pixels) {
        this.canvas.width = pixels;
        this.canvas.height = pixels;
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    draw() {
      const ctx = this.ctx;
      const size = this.size;
      const center = size / 2;
      const radius = center - 5;
      const names = this.names;
      const count = names.length;

      ctx.clearRect(0, 0, size, size);

      ctx.save();
      ctx.translate(center, center);

      const glow = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
      glow.addColorStop(1, 'rgba(80, 11, 14, 0.18)');
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.fillStyle = glow;
      ctx.fill();

      if (count === 0) {
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, TAU);
        ctx.fillStyle = '#7f1d1d';
        ctx.fill();
        ctx.fillStyle = CREAM;
        ctx.font = `700 ${Math.max(14, size * 0.045)}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Cargando nombres…', 0, 0);
        ctx.restore();
        return;
      }

      const arc = TAU / count;
      const fontSize = Math.max(8.5, Math.min(13, size / 37));

      for (let i = 0; i < count; i += 1) {
        const centerAngle = this.rotation + i * arc - Math.PI / 2;
        const start = centerAngle - arc / 2;
        const end = centerAngle + arc / 2;
        const colorIndex = i % COLORS.length;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, start, end);
        ctx.closePath();
        ctx.fillStyle = COLORS[colorIndex];
        ctx.fill();

        ctx.strokeStyle = 'rgba(242, 223, 164, 0.4)';
        ctx.lineWidth = 0.9;
        ctx.stroke();

        ctx.save();
        ctx.rotate(centerAngle);
        const leftSide = Math.cos(centerAngle) < 0;
        if (leftSide) ctx.rotate(Math.PI);
        ctx.textAlign = leftSide ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = CREAM;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 2;
        ctx.shadowOffsetY = 1;
        ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
        const x = leftSide ? -(radius - 24) : radius - 24;
        ctx.fillText(names[i], x, 0, radius - 92);
        ctx.restore();

        const dotRadius = radius - 10;
        ctx.beginPath();
        ctx.arc(
          Math.cos(centerAngle) * dotRadius,
          Math.sin(centerAngle) * dotRadius,
          1.7,
          0,
          TAU,
        );
        ctx.fillStyle = GOLD;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(0, 0, radius - 4, 0, TAU);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 7;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, radius - 11, 0, TAU);
      ctx.strokeStyle = 'rgba(255, 248, 234, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const hubRadius = Math.max(43, size * 0.13);
      const hub = ctx.createRadialGradient(
        -hubRadius * 0.3,
        -hubRadius * 0.35,
        2,
        0,
        0,
        hubRadius,
      );
      hub.addColorStop(0, '#fffdf8');
      hub.addColorStop(1, '#f0ddb0');
      ctx.beginPath();
      ctx.arc(0, 0, hubRadius, 0, TAU);
      ctx.fillStyle = hub;
      ctx.fill();
      ctx.strokeStyle = '#9f1d24';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.fillStyle = '#7f1d1d';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(20, hubRadius * 0.55)}px serif`;
      ctx.fillText('🎁', 0, -hubRadius * 0.18);
      ctx.font = `800 ${Math.max(7, hubRadius * 0.18)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = '#a97813';
      ctx.fillText('MENDIOLA', 0, hubRadius * 0.48);

      ctx.restore();
    }

    spinTo(name, duration = 4500) {
      if (this.animating) {
        return Promise.reject(new Error('La ruleta ya está girando.'));
      }
      const index = this.names.indexOf(name);
      if (index < 0) {
        return Promise.reject(new Error('El nombre no está en la ruleta.'));
      }

      const arc = TAU / this.names.length;
      const reduction = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const spinDuration = reduction ? 700 : duration;
      const offset = (Math.random() - 0.5) * arc * 0.22;
      const target = -index * arc + offset;
      const current = this.rotation;
      const targetMod = ((target % TAU) + TAU) % TAU;
      const currentMod = ((current % TAU) + TAU) % TAU;
      let delta = (targetMod - currentMod + TAU) % TAU;
      delta += TAU * (reduction ? 2 : 6);
      const finalRotation = current + delta;

      this.animating = true;
      const started = performance.now();

      return new Promise((resolve) => {
        const frame = (now) => {
          const elapsed = Math.min(1, (now - started) / spinDuration);
          const progress = easeOutQuart(elapsed);
          this.rotation = current + delta * progress;
          this.draw();
          if (elapsed < 1) {
            requestAnimationFrame(frame);
          } else {
            this.rotation = finalRotation;
            this.draw();
            this.animating = false;
            resolve();
          }
        };
        requestAnimationFrame(frame);
      });
    }
  }

  window.Wheel = Wheel;
})();
