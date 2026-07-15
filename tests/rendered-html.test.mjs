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
  assert.match(html, /Shape/);
  assert.match(html, /Finish/);
  assert.doesNotMatch(html, /STEP|制作进度|窑温|器物编号/i);
  assert.doesNotMatch(html, /上釉|釉色|glaze/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships shaping, incremental brush writing, firing, and a three-dimensional reveal", async () => {
  const [page, model, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/PotteryModel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  const drawBrushLayerStart = page.indexOf("function drawBrushLayer");
  const drawPotStart = page.indexOf("function drawPot");
  const appendBrushSegmentStart = page.indexOf("  const appendBrushSegment");
  const startBrushStrokeStart = page.indexOf("  const startBrushStroke");
  const restartStart = page.indexOf("  const restart");
  const savePieceStart = page.indexOf("  const savePiece");
  const paintStart = page.indexOf("    const paint = (time: number) => {");
  const paintEnd = page.indexOf("    paint(performance.now());", paintStart);
  assert.ok(drawBrushLayerStart >= 0 && drawPotStart > drawBrushLayerStart);
  assert.ok(appendBrushSegmentStart >= 0 && startBrushStrokeStart > appendBrushSegmentStart);
  assert.ok(restartStart >= 0 && savePieceStart > restartStart);
  assert.ok(paintStart >= 0 && paintEnd > paintStart);

  const drawBrushLayerSource = page.slice(drawBrushLayerStart, drawPotStart);
  const appendBrushSegmentSource = page.slice(
    appendBrushSegmentStart,
    startBrushStrokeStart,
  );
  const restartSource = page.slice(restartStart, savePieceStart);
  const paintSource = page.slice(paintStart, paintEnd);

  assert.match(page, /<canvas/);
  assert.match(page, /onPointerDown=\{handleCanvasPointerDown\}/);
  assert.match(page, /onPointerMove=\{handleCanvasPointerMove\}/);
  assert.doesNotMatch(page, /className="stage-body"\s+key=\{stage\}/);
  assert.match(page, /type Stage = "shape" \| "write" \| "fire" \| "reveal"/);
  assert.match(
    page,
    /const STAGE_TITLES: Record<Stage, string> = \{[\s\S]*?shape: "Shape",[\s\S]*?write: "Write",[\s\S]*?fire: "Fire",[\s\S]*?reveal: "Done",[\s\S]*?\};/,
  );
  assert.match(
    page,
    /<h1 className="poster-title">\{STAGE_TITLES\[stage\]\}<\/h1>/,
  );
  assert.match(
    page,
    /const enterWrite = \(\) => \{[\s\S]*?setStage\("write"\);[\s\S]*?\n  \};/,
  );
  assert.match(page, /onClick=\{enterWrite\}[\s\S]*?>Finish<\/span>/);
  assert.match(
    page,
    /const enterFire = \(\) => \{[\s\S]*?setStage\("fire"\);[\s\S]*?void startMicrophone\(\);[\s\S]*?\n  \};/,
  );
  assert.match(page, /onClick=\{enterFire\}[\s\S]*?>Fire<\/span>/);
  assert.match(page, /mode: "shape" \| "write" \| null/);
  assert.match(page, /pointerRef\.current = \{ down: true, mode: "write", \.\.\.point \}/);
  assert.match(page, /pointerRef\.current\.mode === "write"/);
  assert.match(page, /type BrushStamp = \{/);
  assert.match(
    page,
    /type BrushStroke = \{[\s\S]*?stampCount: number;[\s\S]*?lastStamp: BrushStamp \| null;/,
  );
  assert.match(page, /buildPotPath/);
  assert.match(page, /ctx\.fill\(path\)/);
  assert.match(page, /const brushLayerRef = useRef<HTMLCanvasElement \| null>\(null\)/);
  assert.match(page, /layer = document\.createElement\("canvas"\)/);
  assert.match(appendBrushSegmentSource, /context\.clip\(buildPotPath\(profileRef\.current\)\)/);
  assert.match(
    appendBrushSegmentSource,
    /const stamp: BrushStamp = \{[\s\S]*?paintBrushStamp\(context, stamp, stroke\.seed, stampIndex\);[\s\S]*?stroke\.stampCount \+= 1;/,
  );
  assert.match(drawBrushLayerSource, /ctx\.clip\(potPath\)/);
  assert.match(drawBrushLayerSource, /ctx\.drawImage\(/);
  assert.doesNotMatch(drawBrushLayerSource, /paintBrushStamp|forEach|for\s*\(/);
  assert.match(
    page,
    /function drawPot\([\s\S]*?const path = buildPotPath\(profile\);[\s\S]*?drawBrushLayer\(ctx, path, brushLayer\);/,
  );
  assert.match(page, /ctx\.fillStyle = "rgba\(3, 3, 3, \.96\)"/);
  assert.match(page, /ctx\.fillStyle = "rgba\(3, 3, 3, \.62\)"/);
  assert.match(
    paintSource,
    /if \(stage === "fire"\) \{[\s\S]*?drawKiln\([\s\S]*?brushLayerRef\.current,/,
  );
  assert.match(
    paintSource,
    /else if \(stage === "reveal"\) \{[\s\S]*?drawReveal\([\s\S]*?brushLayerRef\.current,/,
  );
  assert.doesNotMatch(paintSource, /stageRef\.current/);
  assert.match(page, /paint\(performance\.now\(\)\);[\s\S]*?\}, \[stage\]\);/);
  assert.match(page, /function drawKiln\([\s\S]*?drawPot\(ctx, profile, brushLayer\);/);
  const drawKilnSource = page.slice(
    page.indexOf("function drawKiln"),
    page.indexOf("function drawStudio"),
  );
  assert.doesNotMatch(drawKilnSource, /strokeStyle|lineWidth|ctx\.stroke\(\)/);
  assert.match(page, /function drawReveal\([\s\S]*?drawPot\(ctx, profile, brushLayer\);/);
  assert.doesNotMatch(page, /brushStrokesRef|slice\(-23\)|\.splice\(/);
  assert.equal(page.match(/brushLayerRef\.current = null;/g)?.length, 1);
  assert.match(restartSource, /brushLayerRef\.current = null;/);
  assert.match(restartSource, /setStage\("shape"\)/);
  assert.match(page, /const minimum = index < 4 \? 8 : 10/);
  assert.match(page, /Math\.max\(2\.5, rimRadius \* 0\.82\)/);
  assert.match(page, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(page, /track\.stop\(\)/);
  assert.match(page, /manualPowerRef\.current = 1/);
  assert.match(
    page,
    /if \(fireProgressRef\.current >= 1\) \{[\s\S]*?setModelStatus\("loading"\);[\s\S]*?setFinishedPiece\(\{[\s\S]*?profile: \[\.\.\.profileRef\.current\],[\s\S]*?brushLayer: brushLayerRef\.current,[\s\S]*?stageRef\.current = "reveal";[\s\S]*?setStage\("reveal"\);[\s\S]*?return;/,
  );
  assert.doesNotMatch(`${page}\n${model}\n${css}`, /cooling|Cooling|cooling-veil|setTimeout/);
  assert.match(page, /onPointerDown=\{\(event\) => \{[\s\S]*?beginManualFire\(\);/);
  assert.match(page, /onPointerCancel=\{endManualFire\}/);
  assert.match(page, /aria-label="吹气或按住按钮烧制陶器"/);
  assert.doesNotMatch(page, /className="(?:canvas|write|fire)-hint"/);
  assert.doesNotMatch(css, /\.(?:canvas|write|fire)-hint/);
  assert.match(page, /className="fire-meter"[\s\S]*?role="progressbar"/);
  assert.match(css, /\.fire-meter\s*\{[^}]*width:\s*min\(48vw, 190px\);/s);
  assert.match(css, /\.fire-meter\s*\{[^}]*height:\s*7px;/s);
  assert.match(
    page,
    /const PotteryModel = lazy\(async \(\) => \{[\s\S]*?await import\("\.\/PotteryModel"\)/,
  );
  assert.match(page, /stage === "reveal"[\s\S]*?finishedPiece/);
  assert.match(page, /stage === "reveal"[\s\S]*?modelStatus !== "unavailable"/);
  assert.match(page, /<Suspense fallback=\{null\}>[\s\S]*?<PotteryModel/);
  assert.match(page, /canvasRef=\{modelCanvasRef\}/);
  assert.match(page, /sourceCanvasRef=\{canvasRef\}/);
  assert.match(page, /onReady=\{handleModelReady\}/);
  assert.match(page, /onUnavailable=\{handleModelUnavailable\}/);
  assert.match(page, /type ModelStatus = "loading" \| "ready" \| "unavailable"/);
  assert.match(
    page,
    /const canvas =[\s\S]*?modelStatus === "ready"[\s\S]*?modelCanvasRef\.current[\s\S]*?: modelStatus === "unavailable"[\s\S]*?\? canvasRef\.current[\s\S]*?: null;/,
  );
  assert.match(page, />Save<\/span>/);
  assert.match(page, />\s*Again\s*<\/button>/);

  assert.match(model, /const PROFILE_TO_WORLD = 1\.22 \/ INITIAL_PROFILE_MAX/);
  assert.match(
    model,
    /const WORLD_PER_CANVAS_PIXEL = PROFILE_TO_WORLD \/ POT_VISUAL_SCALE/,
  );
  assert.match(
    model,
    /const MODEL_HEIGHT = \(POT_BOTTOM - POT_TOP\) \* WORLD_PER_CANVAS_PIXEL/,
  );
  assert.match(
    model,
    /const MODEL_Y_OFFSET =[\s\S]*?WORLD_PER_CANVAS_PIXEL/,
  );
  assert.match(model, /const INITIAL_TILT = 0\.12/);
  assert.doesNotMatch(model, /RIM_PRESENTATION_TILT/);
  assert.match(
    model,
    /function projectedBodyBounds\([\s\S]*?const cosine = Math\.cos\(tilt\);[\s\S]*?const sine = Math\.abs\(Math\.sin\(tilt\)\);[\s\S]*?return \{ minimum, maximum \};/,
  );
  assert.match(
    model,
    /function fitInitialPresentation\(profile: number\[\]\) \{[\s\S]*?projectedBodyBounds\(profile, candidate, INITIAL_TILT\)[\s\S]*?projectedBodyBounds\(profile, verticalScale, INITIAL_TILT\)[\s\S]*?projectedCenter:/,
  );
  assert.match(
    model,
    /const presentation = fitInitialPresentation\(profile\);[\s\S]*?const tiltGroup = new THREE\.Group\(\);[\s\S]*?tiltGroup\.rotation\.x = INITIAL_TILT;[\s\S]*?tiltGroup\.scale\.y = presentation\.verticalScale;[\s\S]*?tiltGroup\.position\.y = MODEL_Y_OFFSET - presentation\.projectedCenter;[\s\S]*?scene\.add\(tiltGroup\);/,
  );
  assert.match(
    model,
    /const spinGroup = new THREE\.Group\(\);[\s\S]*?spinGroup\.rotation\.y = Math\.PI;[\s\S]*?tiltGroup\.add\(spinGroup\);/,
  );
  assert.match(model, /let targetTilt = INITIAL_TILT;/);
  assert.match(
    model,
    /spinGroup\.rotation\.y \+=[\s\S]*?targetRotation - spinGroup\.rotation\.y[\s\S]*?tiltGroup\.rotation\.x \+= \(targetTilt - tiltGroup\.rotation\.x\)/,
  );
  assert.doesNotMatch(model, /const radialScale\s*=/);
  assert.match(model, /const points = profile[\s\S]*?new THREE\.Vector2\(/);
  assert.match(model, /radius \* PROFILE_TO_WORLD/);
  assert.match(model, /new THREE\.LatheGeometry\(points, 96\)/);
  assert.match(model, /new THREE\.MeshToonMaterial\(\{/);
  assert.match(
    model,
    /const outlineMaterial = new THREE\.MeshBasicMaterial\(\{[\s\S]*?side: THREE\.BackSide,/,
  );
  assert.match(model, /new THREE\.CanvasTexture\(textureCanvas\)/);
  assert.match(
    model,
    /for \(let textureY = 0; textureY < TEXTURE_SIZE; textureY \+= 1\)[\s\S]*?radiusAtCanvasY\(profile, canvasY\)[\s\S]*?const surfaceAngle = \(u - 0\.5\) \* Math\.PI \* 2;[\s\S]*?const canvasX = POT_CENTER \+ Math\.sin\(surfaceAngle\) \* radius;/,
  );
  assert.match(
    model,
    /const unmarkedMaterial = new THREE\.MeshToonMaterial\(\{[\s\S]*?gradientMap,[\s\S]*?side: THREE\.DoubleSide,[\s\S]*?\}\);/,
  );
  assert.match(model, /const openingRadius = Math\.max\(0\.025, topRadius \* 0\.82\)/);
  assert.doesNotMatch(model, /rimWallThickness/);
  assert.match(
    model,
    /const rimHeightInCanvasPixels = clamp\([\s\S]*?profile\[0\] \* POT_VISUAL_SCALE \* 0\.18,[\s\S]*?3,[\s\S]*?10\.5,[\s\S]*?\);/,
  );
  assert.match(
    model,
    /const collarHeight =[\s\S]*?Math\.max\(0, rimHeightInCanvasPixels - 1\) \* WORLD_PER_CANVAS_PIXEL[\s\S]*?presentation\.verticalScale \* Math\.cos\(INITIAL_TILT\)/,
  );
  assert.match(model, /const rimY = topY \+ collarHeight/);
  assert.match(
    model,
    /const collarGeometry = new THREE\.CylinderGeometry\([\s\S]*?topRadius,[\s\S]*?topRadius,[\s\S]*?collarHeight,[\s\S]*?72,[\s\S]*?1,[\s\S]*?true,[\s\S]*?\);/,
  );
  assert.match(model, /const collar = new THREE\.Mesh\(collarGeometry, unmarkedMaterial\)/);
  assert.match(model, /collar\.position\.y = topY \+ collarHeight \* 0\.5/);
  assert.match(model, /spinGroup\.add\(collar\)/);
  assert.match(
    model,
    /const rimGeometry = new THREE\.RingGeometry\([\s\S]*?openingRadius,[\s\S]*?topRadius,[\s\S]*?72,[\s\S]*?\);/,
  );
  assert.doesNotMatch(model, /TorusGeometry|rimTubeRadius|rimMajorRadius/);
  assert.match(model, /const rim = new THREE\.Mesh\(rimGeometry, unmarkedMaterial\)/);
  assert.match(model, /rim\.rotation\.x = -Math\.PI \/ 2;/);
  assert.match(model, /rim\.position\.y = rimY/);
  assert.match(
    model,
    /const interiorGeometry = new THREE\.CylinderGeometry\([\s\S]*?openingRadius,[\s\S]*?openingRadius \* 0\.94,[\s\S]*?interiorDepth,[\s\S]*?true,[\s\S]*?\);/,
  );
  assert.match(
    model,
    /const interiorMaterial = new THREE\.MeshBasicMaterial\(\{[\s\S]*?side: THREE\.BackSide,/,
  );
  assert.match(
    model,
    /interior\.position\.y = rimY - interiorDepth \* 0\.5 - 0\.006/,
  );
  assert.match(
    model,
    /const mouthGeometry = new THREE\.CircleGeometry\(openingRadius \* 0\.94, 72\)/,
  );
  assert.match(model, /mouth\.rotation\.x = -Math\.PI \/ 2;/);
  assert.match(model, /mouth\.position\.y = rimY - interiorDepth - 0\.008/);
  assert.match(model, /const bottomGeometry = new THREE\.CircleGeometry\(bottomRadius, 72\)/);
  assert.match(model, /const bottom = new THREE\.Mesh\(bottomGeometry, unmarkedMaterial\)/);
  assert.match(model, /spinGroup\.add\(bottom\)/);
  assert.match(model, /targetRotation \+= \(event\.clientX - lastX\) \* 0\.012/);
  assert.match(model, /canvas\.addEventListener\("pointermove", handlePointerMove\)/);
  assert.match(model, /canvas\.addEventListener\("lostpointercapture", endDrag\)/);
  assert.match(model, /canvas\.addEventListener\("keydown", handleKeyDown\)/);
  assert.match(model, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
  assert.match(model, /tabIndex=\{0\}/);
  assert.match(model, /new THREE\.OrthographicCamera\(-1, 1, 1, -1, 0\.1, 100\)/);
  assert.doesNotMatch(model, /PerspectiveCamera/);
  assert.match(
    model,
    /const sourceBounds = sourceCanvasRef\.current\?\.getBoundingClientRect\(\);[\s\S]*?sourceBounds\.width \/ CANVAS_WIDTH[\s\S]*?sourceBounds\.height \/ CANVAS_HEIGHT[\s\S]*?const worldPerScreenPixel = WORLD_PER_CANVAS_PIXEL \/ canvasScale;[\s\S]*?camera\.left = \(-width \* worldPerScreenPixel\) \/ 2;[\s\S]*?camera\.right = \(width \* worldPerScreenPixel\) \/ 2;[\s\S]*?camera\.top = \(height \* worldPerScreenPixel\) \/ 2;[\s\S]*?camera\.bottom = \(-height \* worldPerScreenPixel\) \/ 2;/,
  );
  assert.doesNotMatch(model, /fitDistance|verticalTangent|horizontalTangent/);
  assert.match(model, /const resizeObserver = new ResizeObserver\(resize\)/);
  assert.match(
    model,
    /const render = \(time: number\) => \{[\s\S]*?const delta = Math\.min\(\(time - lastFrameTime\) \/ 1000, 0\.05\)[\s\S]*?targetRotation \+= delta \* 0\.09[\s\S]*?frame = requestAnimationFrame\(render\)/,
  );
  assert.match(model, /cancelAnimationFrame\(frame\)/);
  assert.match(model, /resizeObserver\.disconnect\(\)/);
  assert.match(model, /canvas\.removeEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(model, /canvas\.removeEventListener\("lostpointercapture", endDrag\)/);
  assert.match(model, /let activePointerId: number \| null = null/);
  assert.match(
    model,
    /const endDrag = \(event: PointerEvent\) => \{[\s\S]*?event\.pointerId !== activePointerId[\s\S]*?activePointerId = null;/,
  );
  assert.match(
    model,
    /const handlePointerDown = \(event: PointerEvent\) => \{[\s\S]*?activePointerId !== null[\s\S]*?activePointerId = event\.pointerId;/,
  );
  assert.match(
    model,
    /const handlePointerMove = \(event: PointerEvent\) => \{[\s\S]*?event\.pointerId !== activePointerId/,
  );
  assert.match(
    model,
    /const handlePointerUp = \(event: PointerEvent\) => \{[\s\S]*?event\.pointerId !== activePointerId[\s\S]*?activePointerId = null;/,
  );
  assert.match(
    model,
    /catch \{[\s\S]*?onUnavailable\(\);[\s\S]*?return;/,
  );
  assert.match(
    model,
    /renderer\.render\(scene, camera\);[\s\S]*?canvas\.classList\.add\("is-ready"\);[\s\S]*?canvas\.setAttribute\("aria-busy", "false"\);[\s\S]*?onReady\(\);/,
  );
  assert.doesNotMatch(model, /modelState|setModelState/);
  assert.match(model, /geometry\.dispose\(\)/);
  assert.match(model, /collarGeometry\.dispose\(\)/);
  assert.match(model, /rimGeometry\.dispose\(\)/);
  assert.match(model, /interiorGeometry\.dispose\(\)/);
  assert.match(model, /mouthGeometry\.dispose\(\)/);
  assert.match(model, /bottomGeometry\.dispose\(\)/);
  assert.match(model, /potteryMaterial\.dispose\(\)/);
  assert.match(model, /unmarkedMaterial\.dispose\(\)/);
  assert.match(model, /outlineMaterial\.dispose\(\)/);
  assert.match(model, /interiorMaterial\.dispose\(\)/);
  assert.match(model, /mouthMaterial\.dispose\(\)/);
  assert.match(model, /texture\?\.dispose\(\)/);
  assert.match(model, /renderer\.dispose\(\)/);

  assert.doesNotMatch(page, /for\s*\(let y = POT_TOP \+ 12; y < POT_BOTTOM; y \+= 11\)/);
  assert.doesNotMatch(`${page}\n${model}\n${layout}\n${css}`, /glaze|上釉|釉色/i);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(packageJson, /"three"\s*:/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
