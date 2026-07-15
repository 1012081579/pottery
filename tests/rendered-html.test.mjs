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
  assert.match(html, /泥火间/);
  assert.match(html, /让泥土跟着手指呼吸/);
  assert.match(html, /制作进度/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships touch, glaze, microphone, and manual-fire interactions", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<canvas/);
  assert.match(page, /onPointerDown=\{handleCanvasPointerDown\}/);
  assert.match(page, /paintGlaze/);
  assert.match(page, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(page, /track\.stop\(\)/);
  assert.match(page, /按住鼓风/);
  assert.match(page, /onPointerCancel=\{endManualFire\}/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
