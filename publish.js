// publish.js — 초안 마크다운을 manifest에 등록하고 모든 글 페이지를 다시 생성
// 사용법:
//   node publish.js drafts/2026-10-21-제목.md   → 초안 게시(같은 파일명이 있으면 수정)
//   node publish.js                             → 등록 없이 전체 글 페이지만 재생성
// write.html의 regenerateAllPostFiles와 같은 일을 하며, site-storage.js의 함수를 그대로 씀
// 초안 머리말: title, category, description, date(YYYY-MM-DD), thumbnail(선택)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const POSTS = path.join(ROOT, 'posts');
const MARKED_URL = 'https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js'; // write.html과 같은 버전

function parseDraft(file){
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`머리말(---)이 없습니다: ${file}`);
  const meta = {};
  m[1].split(/\r?\n/).forEach(line => {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  });
  for (const key of ['title', 'category', 'description', 'date']){
    if (!meta[key]) throw new Error(`머리말에 ${key}가 없습니다: ${file}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) throw new Error(`date는 YYYY-MM-DD 형식이어야 합니다: ${meta.date}`);
  return { meta, body: m[2].trim() + '\n' };
}

async function main(){
  const ctx = vm.createContext({ console, TextEncoder });
  ctx.window = ctx; // 브라우저처럼 window === 전역 → marked가 window.marked로 잡힘
  vm.runInContext(await (await fetch(MARKED_URL)).text(), ctx);
  if (!ctx.marked) throw new Error('marked 로드 실패');
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'site-storage.js'), 'utf8'), ctx);

  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site-config.json'), 'utf8'));
  const categories = ctx.normalizeCategories(config.categories);
  const manifestPath = path.join(POSTS, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const draftFile = process.argv[2];
  if (draftFile){
    const { meta, body } = parseDraft(draftFile);
    const known = categories.flatMap(c => [c.name, ...c.subcategories]);
    if (!known.includes(meta.category)) throw new Error(`없는 카테고리: ${meta.category} (가능: ${known.join(', ')})`);
    const slug = ctx.slugify(meta.title);
    const entry = {
      slug,
      filename: `${meta.date}-${slug}.html`,
      folder: ctx.categoryFolderParts(categories, meta.category),
      title: meta.title,
      category: meta.category,
      description: meta.description,
      date: meta.date,
      markdown: body,
      ...(meta.thumbnail ? { thumbnail: meta.thumbnail } : {})
    };
    const i = manifest.findIndex(p => p.filename === entry.filename);
    if (i >= 0) manifest[i] = entry; else manifest.push(entry);
    console.log(`${i >= 0 ? '수정' : '추가'}: posts/${entry.folder.join('/')}/${entry.filename}`);
  }

  manifest.sort((a, b) => a.date.localeCompare(b.date) || a.filename.localeCompare(b.filename));
  const nav = p => p ? { title: p.title, filename: p.filename, folder: p.folder || [] } : null;
  manifest.forEach((p, i) => {
    const html = ctx.buildPostHtml({
      title: p.title,
      category: p.category,
      description: p.description,
      bodyHtml: ctx.renderMarkdown(p.markdown),
      date: p.date,
      prev: nav(manifest[i - 1]),
      next: nav(manifest[i + 1]),
      folder: p.folder || [],
      categories,
      manifest,
      filename: p.filename
    });
    const dir = path.join(POSTS, ...(p.folder || []));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, p.filename), html);
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`글 ${manifest.length}개 페이지 재생성 완료`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
