// 스크롤할 때 .sidebar가 관성이 붙은 것처럼 살짝 밀렸다가 원래 자리로 튕겨 돌아오는 모션.
// index.html / posts/*.html / write.html / settings.html 등 .sidebar가 있는 모든 페이지에서 공용으로 사용.
(function(){
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const MAX_OFFSET = 14;     // 최대로 밀리는 거리(px)
  const SETTLE_DELAY = 120;  // 스크롤이 멈췄다고 판단하기까지의 시간(ms) - 이 시간 동안 입력이 없으면 원위치로 튕김

  let settleTimer = null;
  let lastScrollY = window.scrollY;

  function nudge(deltaY){
    if (!deltaY) return;
    const offset = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, -deltaY * 0.4));
    sidebar.style.transition = 'none';
    sidebar.style.transform = `translateY(${offset}px)`;

    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      sidebar.style.transition = '';   // site.css에 정의된 스프링(overshoot) 트랜지션으로 되돌림
      sidebar.style.transform = 'translateY(0)';
    }, SETTLE_DELAY);
  }

  window.addEventListener('wheel', (e) => nudge(e.deltaY), { passive: true });

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    nudge(y - lastScrollY);
    lastScrollY = y;
  }, { passive: true });
})();
