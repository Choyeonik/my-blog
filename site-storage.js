/* ==============================================================
   site-storage.js — "posts" 폴더 읽기/쓰기 공용 헬퍼
   - index.html(홈)과 write.html(글쓰기)이 함께 불러와 씁니다.
   - 브라우저의 File System Access API(showDirectoryPicker 등)를 사용합니다.
     ⚠️ 이 API는 Chromium 계열 브라우저(Chrome/Edge/Opera)에서만 동작하고,
        Safari/Firefox에서는 지원하지 않습니다. (지원 안 하면 아래 isFsaSupported()가 false)
   - 폴더를 한 번 선택하면(showDirectoryPicker) 그 폴더의 "핸들"을 IndexedDB에
     저장해두고, 다음 방문부터는 사용자가 다시 누르지 않아도 조용히(queryPermission)
     같은 폴더에 접근할 수 있는지 확인합니다. (권한이 만료됐으면 다시 눌러야 함 — 이건
     브라우저 정책이라 코드로 우회할 수 없습니다.)
   ============================================================== */

// 이 브라우저가 File System Access API를 지원하는지 여부
function isFsaSupported(){
  return typeof window.showDirectoryPicker === 'function';
}

/* ---------- IndexedDB: 폴더 핸들 저장/불러오기 ---------- */
// Chrome은 FileSystemDirectoryHandle 객체를 IndexedDB에 그대로(구조적 복제로) 저장할 수 있습니다.
const IDB_NAME = 'portfolio-blog-fs';
const IDB_STORE = 'handles';
const IDB_KEY = 'siteDir';

function openDb(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- 권한 확인 ---------- */
// promptIfNeeded=false면 사용자 제스처 없이도 되는 queryPermission만 사용(=조용히 확인만).
// promptIfNeeded=true면 필요할 때 requestPermission으로 실제 권한 요청 팝업을 띄움
//   (이건 반드시 버튼 클릭 등 사용자 동작 안에서 호출해야 브라우저가 허용합니다).
async function verifyPermission(handle, { readWrite = true, promptIfNeeded = false } = {}){
  const opts = readWrite ? { mode: 'readwrite' } : { mode: 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!promptIfNeeded) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

/* ---------- 사이트 폴더(작업 폴더) 연결 ---------- */
// 사용자가 "폴더 연결" 버튼을 눌렀을 때 호출: 폴더 선택창을 띄우고, 선택하면 IndexedDB에 저장
async function connectSiteFolder(){
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const ok = await verifyPermission(handle, { readWrite: true, promptIfNeeded: true });
  if (!ok) throw new Error('폴더 쓰기 권한이 필요합니다.');
  // IndexedDB 저장은 "다음 방문 때도 자동으로 이 폴더를 쓰기 위한" 부가 기능이라,
  // 여기서 실패하더라도(사파리 등 일부 환경) 지금 이 세션에서 폴더를 쓰는 것 자체는
  // 계속 진행되도록 실패를 무시합니다.
  try{ await idbSet(IDB_KEY, handle); } catch(e){ /* 다음 방문 때 자동 재연결만 안 될 뿐 */ }
  return handle;
}

// 이전에 연결해둔 폴더 핸들을 IndexedDB에서 꺼내옴.
// promptIfNeeded=true인 호출은 버튼 클릭 핸들러 안에서만 사용할 것.
async function getSiteFolderHandle({ promptIfNeeded = false } = {}){
  if (!isFsaSupported()) return null;
  let handle;
  try{
    handle = await idbGet(IDB_KEY);
  } catch(e){
    return null;
  }
  if (!handle) return null;
  const ok = await verifyPermission(handle, { readWrite: true, promptIfNeeded });
  return ok ? handle : null;
}

// site 폴더 아래의 posts 폴더 핸들. create:true면 없을 때 새로 만듦(첫 저장 시).
async function getPostsDirHandle(siteHandle, { create = false } = {}){
  return siteHandle.getDirectoryHandle('posts', { create });
}

/* ---------- 하위 폴더(중첩) 핸들 ---------- */
// parts를 순서대로 따라가며 폴더를 열거나(없으면 create=true일 때 생성) 반환
// 예: getNestedDirHandle(postsDir, ['assets', 'my-slug'], { create: true })
//     -> postsDir/assets/my-slug 폴더 핸들
async function getNestedDirHandle(root, parts, { create = false } = {}){
  let dir = root;
  for (const part of parts){
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

// 폴더 안에 있는 파일 이름 목록 (하위 폴더 제외)
async function listFileNames(dirHandle){
  const names = [];
  for await (const [name, handle] of dirHandle.entries()){
    if (handle.kind === 'file') names.push(name);
  }
  return names;
}

// 폴더 안에서 filename과 겹치지 않는 이름을 찾아 반환 (겹치면 "-2", "-3"... 붙임)
async function uniqueFileName(dirHandle, filename){
  const existing = new Set(await listFileNames(dirHandle));
  if (!existing.has(filename)) return filename;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let n = 2;
  let candidate = `${base}-${n}${ext}`;
  while (existing.has(candidate)){
    n++;
    candidate = `${base}-${n}${ext}`;
  }
  return candidate;
}

/* ---------- 파일 읽기/쓰기 ---------- */
async function readJSON(dirHandle, name){
  try{
    const fileHandle = await dirHandle.getFileHandle(name);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch(e){
    return null;   // 파일이 없거나(첫 실행) 파싱 실패 -> null
  }
}

async function writeJSON(dirHandle, name, obj){
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(obj, null, 2));
  await writable.close();
}

async function writeText(dirHandle, name, text){
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

// 이미지 등 바이너리 파일(File/Blob) 저장용
async function writeFile(dirHandle, name, fileOrBlob){
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(fileOrBlob);
  await writable.close();
}

// 폴더 안의 파일을 삭제(있으면). 없어도 에러 없이 조용히 넘어감
// (글 수정 중 카테고리가 바뀌어 저장 폴더가 달라졌을 때, 예전 폴더에 남는 파일을 지우는 용도)
async function removeFileIfExists(dirHandle, name){
  try{ await dirHandle.removeEntry(name); } catch(e){ /* 이미 없으면 무시 */ }
}

/* ---------- 사이트 설정(site-config.json): 카테고리 / 비밀번호 ---------- */
// 카테고리는 { name, subcategories: [문자열...] } 형태의 목록입니다.
// name은 필터링 값이자 화면에 보이는 이름 그 자체이고, subcategories는 그 아래
// 한 단계 더 있는 하위 카테고리 이름들(마찬가지로 필터링 값 겸 표시 이름)입니다.
// (설정 페이지에서 추가/삭제하며, write.html의 카테고리 선택 목록도 이 값을 그대로 씀)
const DEFAULT_CATEGORIES = [
  { name: 'Project', subcategories: [] },
  { name: 'Study', subcategories: [] },
  { name: 'Photo', subcategories: [] }
];

// 예전 버전(문자열 배열)과 현재 버전({name, subcategories} 배열) 모두 지원하기 위해
// 저장된 값을 항상 { name, subcategories } 배열 형태로 맞춰서 반환
function normalizeCategories(raw){
  if (!Array.isArray(raw) || raw.length === 0){
    return DEFAULT_CATEGORIES.map(c => ({ name: c.name, subcategories: [] }));
  }
  return raw
    .map(item => {
      if (typeof item === 'string') return { name: item, subcategories: [] };
      const name = item && typeof item.name === 'string' ? item.name : '';
      const subcategories = item && Array.isArray(item.subcategories)
        ? item.subcategories.filter(s => typeof s === 'string' && s)
        : [];
      return { name, subcategories };
    })
    .filter(c => c.name);
}

// 폴더 연결 전이거나 site-config.json이 아직 없을 때 쓰는 기본값을 채워서 반환
async function loadSiteConfig(siteHandle){
  const config = await readJSON(siteHandle, 'site-config.json');
  if (!config) return { categories: normalizeCategories(null), passwordHash: null };
  return {
    categories: normalizeCategories(config.categories),
    passwordHash: config.passwordHash || null
  };
}

async function saveSiteConfig(siteHandle, config){
  await writeJSON(siteHandle, 'site-config.json', config);
}

/* ---------- 카테고리별 폴더 경로 ---------- */
// 글에 붙은 카테고리 이름(상위든 하위든) 하나로부터, posts 폴더 기준으로 그 글을
// 저장할 하위 폴더 경로를 배열로 계산.
// - 상위 카테고리 이름이면: 그 이름 하나만 폴더로 씀 (예: "Study" -> ["Study"])
// - 하위 카테고리 이름이면: 상위/하위 두 단계 폴더로 씀 (예: "Lecture" -> ["Study","Lecture"])
// - (카테고리가 나중에 삭제되는 등) 목록에서 못 찾으면 이름 그대로 한 단계 폴더로 씀
function categoryFolderParts(categories, categoryName){
  const parent = categories.find(c => c.name === categoryName);
  if (parent) return [parent.name];
  const owner = categories.find(c => c.subcategories.includes(categoryName));
  if (owner) return [owner.name, categoryName];
  return [categoryName];
}

// filter로 선택된 카테고리(상위든 하위든)에 해당하는 게시글의 category 값 목록을 반환.
// (index.html의 사이드바 필터, 개별 글 페이지 사이드바의 카테고리 글 수 계산에 공용으로 사용)
// - 상위 카테고리를 고르면 그 상위 이름 + 모든 하위 카테고리 이름을 합쳐서(=하위 글까지 포함) 반환
// - 하위 카테고리를 고르면 그 하위 이름 하나만 반환
function categoryNamesForFilter(categories, filter){
  const parent = categories.find(c => c.name === filter);
  if (parent) return [parent.name, ...parent.subcategories];
  return [filter];
}

// manifest 항목(또는 그와 같은 모양의 객체)의 folder(폴더 경로 배열)+filename으로부터
// posts 폴더 기준 상대 경로 문자열을 만듦 (예: "Study/Lecture/2026-08-30-title.html")
// folder가 없으면(예전 글) posts 바로 아래에 있는 것으로 취급
function postRelPath(entry){
  const folder = Array.isArray(entry.folder) ? entry.folder : [];
  return folder.length ? folder.join('/') + '/' + entry.filename : entry.filename;
}

// postRelPath 같은 상대 경로를 실제 href/src 속성 값으로 안전하게 쓸 수 있도록
// "/"로 나눈 각 구간을 URL 인코딩. 파일/폴더 이름에는 대괄호·한글·공백이 자유롭게 들어갈 수
// 있는데, 대괄호(예: "[2026-08-26]-...")가 인코딩 없이 그대로 file:// 링크 경로에 들어가면
// 크롬이 파일을 못 찾아 이미지가 깨지거나 링크가 열리지 않는 경우가 있어 반드시 인코딩해서 씀.
// (postRelPath 자체는 사람이 읽는 안내 문구에도 쓰이므로 인코딩하지 않은 원래 문자열을 반환함)
function encodePathForUrl(relPath){
  return String(relPath || '').split('/').map(encodeURIComponent).join('/');
}

// 비밀번호를 그대로 저장하지 않고 SHA-256 해시로 변환해서 저장/비교합니다.
// ⚠️ 참고: 이 사이트는 서버 없이 정적 파일로만 동작하므로, 이 검사는 페이지 소스를
//    볼 수 있는 사람에게는 완전한 보안이 되지 못합니다. "아무나 실수로 못 건드리게"
//    막는 수준의 가벼운 잠금으로 이해해주세요.
async function sha256Hex(text){
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- 문자열 유틸 ---------- */
// 한글을 포함해 파일명으로 못 쓰는 문자만 제거/치환 (한글 자체는 그대로 유지)
function slugify(title){
  const s = String(title || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')      // 파일시스템에서 못 쓰는 문자 제거
    .replace(/\s+/g, '-')              // 공백 -> 하이픈
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'post';
}

function todayISODate(){
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function escapeHtml(str){
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// marked.js가 로드돼 있으면 그걸로 마크다운 렌더링, 없으면 최소한의 대체(줄바꿈만 <br>) 처리
// breaks: true 옵션으로 (표준 마크다운과 달리) 줄 끝에 스페이스 2번 없이 엔터 한 번만 쳐도 줄바꿈되게 함
function renderMarkdown(md){
  if (window.marked && typeof window.marked.parse === 'function'){
    return window.marked.parse(md || '', { breaks: true });
  }
  return `<p>${escapeHtml(md || '').replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
}

/* ---------- 개별 글 페이지 사이드바(홈 화면 aside와 같은 구성: 프로필/검색/카테고리/최근 글) ---------- */
// categories = site-config.json의 카테고리 목록, manifest = posts/manifest.json 전체 배열
// toRoot = 이 글 파일 -> 사이트 루트(index.html 등), toPosts = 이 글 파일 -> posts 폴더 자체
// 검색/카테고리는 이 페이지 자체에 상태가 없으므로, index.html로 이동하면서
// ?filter=이름 / ?q=검색어 형태로 조건을 넘기고 index.html이 그 값을 읽어 반영함
function buildSidebarHtml({ categories, manifest, toRoot, toPosts }){
  const posts = Array.isArray(manifest) ? manifest : [];
  const counts = {};
  posts.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });

  const categoryItemsHtml = categories.map(cat => {
    const catCount = categoryNamesForFilter(categories, cat.name)
      .reduce((sum, name) => sum + (counts[name] || 0), 0);
    const subHtml = cat.subcategories.length ? `
        <ul class="category-sub-nested">
          ${cat.subcategories.map(sc => `
            <li><a href="${toRoot}index.html?filter=${encodeURIComponent(sc)}">${escapeHtml(sc)} <span class="count">${counts[sc] || 0}</span></a></li>
          `).join('')}
        </ul>` : '';
    return `
      <li>
        <a href="${toRoot}index.html?filter=${encodeURIComponent(cat.name)}">${escapeHtml(cat.name)} <span class="count">${catCount}</span></a>
        ${subHtml}
      </li>`;
  }).join('') + `<li><a href="${toRoot}index.html?filter=about">About</a></li>`;

  const recentHtml = [...posts]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map(p => `
      <li>
        <a href="${toPosts}${encodePathForUrl(postRelPath(p))}">
          <div class="recent-title">${escapeHtml(p.title)}</div>
          <div class="recent-date">${p.date}</div>
        </a>
      </li>
    `).join('');

  return `<aside class="sidebar">

    <button id="sidebarToggle" class="sidebar-toggle" type="button" aria-label="사이드바 접기/펼치기">
      <span></span><span></span><span></span>
    </button>

    <div class="sidebar-links">
      <a href="${toRoot}write.html" class="write-link">새 글 쓰기 →</a>
      <a href="${toRoot}settings.html" class="write-link">설정 →</a>
    </div>

    <section class="profile">
      <div class="profile-avatar"><img src="${toRoot}assets/profile-photo.jpg" alt="프로필 사진"></div>
      <h2 class="profile-name">Hello, Yeonnnn!</h2>
      <p class="profile-title">Yeonnnn</p>
      <p class="profile-bio"></p>
      <div class="profile-links">
        <a href="https://instagram.com/whyeonik" target="_blank" rel="noopener">Instagram</a>
        <a href="mailto:zging0151@gmail.com">Email</a>
        <a href="https://github.com/Choyeonik" target="_blank" rel="noopener">Github</a>
      </div>
    </section>

    <section class="search-box">
      <form action="${toRoot}index.html" method="get">
        <input type="text" name="q" placeholder="검색어를 입력하세요">
        <button type="submit" aria-label="검색">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
      </form>
    </section>

    <section class="categories">
      <div class="side-heading">Category</div>
      <ul class="category-list">
        <li>
          <a class="category-total" href="${toRoot}index.html">
            <span>Total</span>
            <span class="count">${posts.length}</span>
          </a>
          <ul class="category-sub">${categoryItemsHtml}</ul>
        </li>
      </ul>
    </section>

    <section class="recent-posts">
      <div class="side-heading">최근 글</div>
      <ul class="recent-list">${recentHtml}</ul>
    </section>

  </aside>`;
}

/* ---------- 개별 글 페이지(posts/카테고리/.../xxx.html) 전체 HTML 생성 ---------- */
// prev = 이전 글(더 과거, {title, filename, folder} 또는 null), next = 다음 글(더 최신, 또는 null)
// folder = 이 글 자신이 들어있는, posts 폴더 기준 하위 폴더 경로 배열 (예: ["Study","Lecture"])
//          (예전처럼 posts 바로 아래에 저장되는 글은 빈 배열/생략)
// categories/manifest = 홈 화면과 같은 사이드바(카테고리/최근 글)를 그리기 위해 함께 전달
function buildPostHtml({ title, category, description, bodyHtml, date, prev, next, folder, categories, manifest, filename }){
  // category는 설정 페이지에서 관리하는 카테고리 이름 문자열을 그대로 씀(예: "Project", "여행기록")
  const catLabel = category;

  const depth = Array.isArray(folder) ? folder.length : 0;
  const toRoot = '../'.repeat(depth + 1);   // 이 글 파일 -> 사이트 루트(index.html, site.css)
  const toPosts = '../'.repeat(depth);      // 이 글 파일 -> posts 폴더 자체(다른 카테고리 글로 이동할 때 기준)

  // 본문 마크다운 안의 이미지 경로("assets/슬러그/파일명")는 posts 폴더 기준으로 적혀 있으므로,
  // 실제 글 파일이 카테고리 하위 폴더에 있을 때는 그만큼 앞에 "../"를 붙여줘야 함
  const fixedBodyHtml = depth > 0 ? bodyHtml.replace(/src="assets\//g, `src="${toPosts}assets/`) : bodyHtml;

  // item(prev/next)이 있는 위치까지, 지금 이 글의 위치를 기준으로 한 상대 경로
  const relLinkTo = (item) => toPosts + encodePathForUrl(postRelPath(item));

  const navItem = (item, label, cls) => item
    ? `<a class="post-nav-item ${cls}" href="${relLinkTo(item)}">
         <span class="post-nav-label">${label}</span>
         <span class="post-nav-title">${escapeHtml(item.title)}</span>
       </a>`
    : `<div class="post-nav-item ${cls}">
         <span class="post-nav-label">${label}</span>
         <span class="post-nav-empty">없음</span>
       </div>`;

  const sidebarHtml = buildSidebarHtml({ categories: categories || [], manifest: manifest || [], toRoot, toPosts });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — Portfolio Blog</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;500;600&family=Noto+Sans+KR:wght@300;400;500;700&family=EB+Garamond:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${toRoot}site.css">
</head>
<body>

<div class="layout">
${sidebarHtml}

  <main class="page-inner">

    <div class="post-header">
      <div class="card-tag">${catLabel}</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="post-desc">${escapeHtml(description)}</p>
      <div class="post-date">${date}</div>
      <a class="post-edit-link" href="${toRoot}write.html?edit=${encodeURIComponent(filename)}">수정하기 →</a>
    </div>

    <article class="post-body">
${fixedBodyHtml}
    </article>

    <nav class="post-nav">
      ${navItem(prev, '이전 글', '')}
      ${navItem(next, '다음 글', 'is-next')}
    </nav>

  </main>

</div>

<script>
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
  });
</script>

</body>
</html>
`;
}
