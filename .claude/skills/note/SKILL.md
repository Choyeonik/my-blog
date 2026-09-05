---
name: note
description: 배운 것을 학습 노트로 정리해서 블로그에 올린다. /note 라고 하면 실행한다.
---

# 학습 노트 만들기

아래 순서대로 해줘.

1. 이전에 작성된 "2026-08-31-Html,마크다운을-이용한-블로그-디자인-개발.html"과 비슷한 느낌으로 작성해줘.
2. `posts/Study/배운 것/` 에 HTML 파일을 만들어줘.
   파일 이름: `YYYY-MM-DD-제목.html` 형식
3. 내가 주는 자료를 바탕으로 노트를 써줘.
4. 다 쓰면 나에게 먼저 보여줘. 내가 좋다고 하기 전에는 커밋하지 마.
5. 내가 확인하면:
   - `posts/manifest.json` 파일에 게시물 정보를 추가해줘
   - 필드: slug, filename, folder, title, category, description, date, markdown
   - 새 항목은 배열의 가장 앞(가장 최신)에 추가
   - 사이드바의 Total, Study, 배운 것 카운트를 +1 씩 증가
6. 커밋하고 push 해줘. (커밋 메시지: "제목 블로그 본문 작성")