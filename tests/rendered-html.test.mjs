import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the pottery studio shell and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN"/i);
  assert.match(html, /<title>泥火间 · 指尖陶艺模拟器<\/title>/i);
  assert.match(html, /Pottery/);
  assert.match(html, /STEP 01 · 塑形/);
  assert.match(html, /Finish/);
  assert.match(html, /制作进度/);
  assert.doesNotMatch(html, /上釉|釉色|glaze/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships touch shaping, microphone, and manual-fire interactions without a glaze stage", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<canvas/);
  assert.match(page, /onPointerDown=\{handleCanvasPointerDown\}/);
  assert.match(page, /onPointerMove=\{handleCanvasPointerMove\}/);
  assert.doesNotMatch(page, /className="stage-body"\s+key=\{stage\}/);
  assert.match(page, /type Stage = "shape" \| "fire" \| "reveal"/);
  assert.match(page, /setStage\("fire"\)/);
  assert.match(page, /buildPotPath/);
  assert.match(page, /ctx\.fill\(path\)/);
  assert.match(page, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(page, /track\.stop\(\)/);
  assert.match(page, /按住鼓风/);
  assert.match(page, /onPointerCancel=\{endManualFire\}/);
  assert.doesNotMatch(page, /for\s*\(let y = POT_TOP \+ 12; y < POT_BOTTOM; y \+= 11\)/);
  assert.doesNotMatch(`${page}\n${layout}\n${css}`, /glaze|上釉|釉色/i);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
