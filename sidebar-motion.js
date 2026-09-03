// .sidebar가 실제 스크롤 위치를 이벤트 단위로 딱딱 따라가지 않고,
// 매 프레임(requestAnimationFrame)마다 목표 위치를 서서히 쫓아가게 만들어
// "화면과 별개로 따로 움직이는" 관성 느낌을 낸다.
// 빠르게 스크롤하면 뒤로 크게 처졌다가, 스크롤이 느려지거나 멈추면 그 간격만큼
// 자연스럽게 줄어들며 따라잡는다. transform은 매 프레임 JS가 직접 갱신하므로
// site.css 쪽 transition(스프링 트랜지션)은 더 이상 쓰이지 않는다.
// index.html / posts/*.html / write.html / settings.html 등 .sidebar가 있는 모든 페이지에서 공용으로 사용.
(function(){
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const EASE = 0.08;    // 한 프레임마다 실제 스크롤 위치를 따라잡는 비율(0~1). 작을수록 더 느리게 뒤처져서 따라옴
  const MAX_LAG = 560;   // 실제 스크롤 위치와 벌어질 수 있는 최대 거리(px). 너무 크게 벌어지지 않도록 제한

  let virtualY = window.scrollY;

  function tick(){
    const realY = window.scrollY;
    virtualY += (realY - virtualY) * EASE;

    const lag = Math.max(-MAX_LAG, Math.min(MAX_LAG, virtualY - realY));
    sidebar.style.transform = `translateY(${lag}px)`;

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
