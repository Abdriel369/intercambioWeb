(function () {
  'use strict';

  const COLORS = ['#a91f24', '#dfb74d', '#14532d', '#fff1c1', '#f5d675', '#2f7a4a'];
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let particles = [];
  let animation = null;
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function createParticles() {
    const total = width < 500 ? 95 : 150;
    const originX = width / 2;
    const originY = Math.min(height * 0.34, 260);
    particles = [];
    for (let i = 0; i < total; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.4 + Math.random() * 7.2;
      particles.push({
        x: originX + (Math.random() - 0.5) * 50,
        y: originY + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3.3,
        gravity: 0.115 + Math.random() * 0.06,
        drag: 0.986,
        width: 5 + Math.random() * 7,
        height: 7 + Math.random() * 9,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.35,
        wobble: Math.random() * Math.PI * 2,
        alpha: 1,
      });
    }
  }

  function frame() {
    ctx.clearRect(0, 0, width, height);
    let alive = 0;

    for (const particle of particles) {
      if (particle.alpha <= 0) continue;
      particle.vx *= particle.drag;
      particle.vy = particle.vy * particle.drag + particle.gravity;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.rotationSpeed;
      particle.wobble += 0.09;
      particle.x += Math.sin(particle.wobble) * 0.55;

      if (particle.y > height * 0.8) {
        particle.alpha -= 0.018;
      }
      if (particle.y > height + 30) {
        particle.alpha = 0;
      }
      if (particle.alpha > 0) alive += 1;

      ctx.save();
      ctx.globalAlpha = Math.max(0, particle.alpha);
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.fillStyle = particle.color;
      ctx.fillRect(
        -particle.width / 2,
        -particle.height / 2,
        particle.width,
        particle.height,
      );
      ctx.restore();
    }

    if (alive > 0) {
      animation = requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, width, height);
      animation = null;
      particles = [];
    }
  }

  window.addEventListener('resize', resize);
  resize();

  window.confettiBurst = function confettiBurst() {
    if (reduceMotion) return;
    if (animation) cancelAnimationFrame(animation);
    resize();
    createParticles();
    animation = requestAnimationFrame(frame);
  };
})();
