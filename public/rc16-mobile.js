(() => {
  const root = document.documentElement;
  let raf = 0;
  const sync = () => {
    raf = 0;
    const vv = window.visualViewport;
    const h = Math.max(320, Math.round(vv?.height || window.innerHeight || 720));
    const w = Math.max(280, Math.round(vv?.width || window.innerWidth || 360));
    root.style.setProperty('--barsa-vh', `${h}px`);
    root.style.setProperty('--barsa-vw', `${w}px`);
    root.classList.toggle('compact-phone', w <= 430);
    root.classList.add('rc16-mobile-runtime');
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(sync);
  };
  sync();
  addEventListener('resize', schedule, { passive: true });
  addEventListener('orientationchange', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
})();
