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

/* ---------- 경로로 파일 읽기 / 파일 삭제 ---------- */
// "assets/profile-photo.jpg" 같은 상대 경로를 siteHandle 기준으로 따라가서
// 파일을 읽고, 화면에 <img src="...">로 바로 쓸 수 있는 objectURL로 변환
async function readFileAsObjectURLByPath(siteHandle, relPath){
  if (!relPath) return null;
  try{
    const parts = relPath.split('/');
    const filename = parts.pop();
    let dir = siteHandle;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    const fileHandle = await dir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
  } catch(e){
    return null;   // 파일이 없거나 삭제된 경우
  }
}

// 폴더 안의 파일을 삭제(있으면). 없어도 에러 없이 조용히 넘어감
// (프로필 사진을 다른 확장자 파일로 교체할 때 이전 파일을 지우는 용도)
async function removeFileIfExists(dirHandle, name){
  try{ await dirHandle.removeEntry(name); } catch(e){ /* 이미 없으면 무시 */ }
}

/* ---------- 사이트 설정(site-config.json): 카테고리 / 프로필 사진 / 비밀번호 ---------- */
// 카테고리는 필터링 값이자 화면에 보이는 이름 그 자체인 문자열 목록입니다.
// (설정 페이지에서 추가/삭제하며, write.html의 카테고리 선택 목록도 이 값을 그대로 씀)
const DEFAULT_CATEGORIES = ['Project', 'Study', 'Photo'];

// 폴더 연결 전이거나 site-config.json이 아직 없을 때 쓰는 기본값을 채워서 반환
async function loadSiteConfig(siteHandle){
  const config = await readJSON(siteHandle, 'site-config.json');
  if (!config) return { categories: DEFAULT_CATEGORIES.slice(), avatar: null, passwordHash: null };
  return {
    categories: Array.isArray(config.categories) && config.categories.length
      ? config.categories
      : DEFAULT_CATEGORIES.slice(),
    avatar: config.avatar || null,
    passwordHash: config.passwordHash || null
  };
}

async function saveSiteConfig(siteHandle, config){
  await writeJSON(siteHandle, 'site-config.json', config);
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
function renderMarkdown(md){
  if (window.marked && typeof window.marked.parse === 'function'){
    return window.marked.parse(md || '');
  }
  return `<p>${escapeHtml(md || '').replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
}

/* ---------- 개별 글 페이지(posts/xxx.html) 전체 HTML 생성 ---------- */
// prev = 이전 글(더 과거, {title, filename} 또는 null), next = 다음 글(더 최신, 또는 null)
function buildPostHtml({ title, category, description, bodyHtml, date, prev, next }){
  // category는 설정 페이지에서 관리하는 카테고리 이름 문자열을 그대로 씀(예: "Project", "여행기록")
  const catLabel = category;

  const navItem = (item, label, cls) => item
    ? `<a class="post-nav-item ${cls}" href="${item.filename}">
         <span class="post-nav-label">${label}</span>
         <span class="post-nav-title">${escapeHtml(item.title)}</span>
       </a>`
    : `<div class="post-nav-item ${cls}">
         <span class="post-nav-label">${label}</span>
         <span class="post-nav-empty">없음</span>
       </div>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — Portfolio Blog</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;500;600&family=Noto+Sans+KR:wght@300;400;500;700&family=EB+Garamond:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../site.css">
</head>
<body>

<header class="site-topbar">
  <div class="brand">Portfolio Blog</div>
  <nav><a href="../index.html">← 목록으로</a></nav>
</header>

<main>
  <div class="page-inner">

    <div class="post-header">
      <div class="card-tag">${catLabel}</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="post-desc">${escapeHtml(description)}</p>
      <div class="post-date">${date}</div>
    </div>

    <article class="post-body">
${bodyHtml}
    </article>

    <nav class="post-nav">
      ${navItem(prev, '이전 글', '')}
      ${navItem(next, '다음 글', 'is-next')}
    </nav>

  </div>
</main>

</body>
</html>
`;
}
