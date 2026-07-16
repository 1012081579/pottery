"use client";

import { useEffect, type RefObject } from "react";
import * as THREE from "three";

interface PotteryModelProps {
  profile: number[];
  brushLayer: HTMLCanvasElement | null;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  sourceCanvasRef: RefObject<HTMLCanvasElement | null>;
  onReady: () => void;
  onUnavailable: () => void;
}

const TEXTURE_SIZE = 1024;
const CANVAS_WIDTH = 360;
const CANVAS_HEIGHT = 440;
const POT_CENTER = 180;
const POT_TOP = 58;
const POT_BOTTOM = 344;
const POT_VISUAL_SCALE = 1.32;
const INITIAL_PROFILE_MAX = 111.614991651;
const PROFILE_TO_WORLD = 1.22 / INITIAL_PROFILE_MAX;
const WORLD_PER_CANVAS_PIXEL = PROFILE_TO_WORLD / POT_VISUAL_SCALE;
const MAX_TILT = 0.28;
const INITIAL_TILT = 0.12;
const MODEL_HEIGHT = (POT_BOTTOM - POT_TOP) * WORLD_PER_CANVAS_PIXEL;
const MODEL_Y_OFFSET =
  (CANVAS_HEIGHT * 0.5 - (POT_TOP + POT_BOTTOM) * 0.5) *
  WORLD_PER_CANVAS_PIXEL;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function radiusAtCanvasY(profile: number[], canvasY: number) {
  const position =
    clamp((canvasY - POT_TOP) / (POT_BOTTOM - POT_TOP), 0, 1) *
    Math.max(1, profile.length - 1);
  const lowerIndex = Math.min(Math.floor(position), profile.length - 1);
  const upperIndex = Math.min(lowerIndex + 1, profile.length - 1);
  const progress = position - lowerIndex;
  return (
    profile[lowerIndex] +
    (profile[upperIndex] - profile[lowerIndex]) * progress
  );
}

function projectedBodyBounds(
  profile: number[],
  verticalScale: number,
  tilt: number,
) {
  const cosine = Math.cos(tilt);
  const sine = Math.abs(Math.sin(tilt));
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  profile.forEach((radius, index) => {
    const progress = index / Math.max(1, profile.length - 1);
    const y = MODEL_HEIGHT * 0.5 - progress * MODEL_HEIGHT;
    const projectedCenter = y * verticalScale * cosine;
    const projectedRadius =
      Math.max(0.06, radius * PROFILE_TO_WORLD) * sine;
    minimum = Math.min(minimum, projectedCenter - projectedRadius);
    maximum = Math.max(maximum, projectedCenter + projectedRadius);
  });

  return { minimum, maximum };
}

function fitInitialPresentation(profile: number[]) {
  let lowerScale = 0.72;
  let upperScale = 1;
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const candidate = (lowerScale + upperScale) * 0.5;
    const bounds = projectedBodyBounds(profile, candidate, INITIAL_TILT);
    if (bounds.maximum - bounds.minimum > MODEL_HEIGHT) {
      upperScale = candidate;
    } else {
      lowerScale = candidate;
    }
  }

  const verticalScale = (lowerScale + upperScale) * 0.5;
  const bounds = projectedBodyBounds(profile, verticalScale, INITIAL_TILT);
  return {
    verticalScale,
    projectedCenter: (bounds.minimum + bounds.maximum) * 0.5,
  };
}

function createPotTexture(
  profile: number[],
  brushLayer: HTMLCanvasElement | null,
) {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = TEXTURE_SIZE;
  textureCanvas.height = TEXTURE_SIZE;
  const context = textureCanvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  const brushContext = brushLayer?.getContext("2d", {
    willReadFrequently: true,
  });
  if (brushLayer && brushContext) {
    const brushPixels = brushContext.getImageData(
      0,
      0,
      brushLayer.width,
      brushLayer.height,
    );
    const texturePixels = context.getImageData(
      0,
      0,
      TEXTURE_SIZE,
      TEXTURE_SIZE,
    );
    const sourceScaleX = brushLayer.width / CANVAS_WIDTH;
    const sourceScaleY = brushLayer.height / CANVAS_HEIGHT;

    for (let textureY = 0; textureY < TEXTURE_SIZE; textureY += 1) {
      const verticalProgress = textureY / (TEXTURE_SIZE - 1);
      const canvasY = POT_TOP + verticalProgress * (POT_BOTTOM - POT_TOP);
      const radius = radiusAtCanvasY(profile, canvasY) * POT_VISUAL_SCALE;
      const sourceY = clamp(
        Math.round(canvasY * sourceScaleY),
        0,
        brushLayer.height - 1,
      );

      for (
        let textureX = TEXTURE_SIZE / 4;
        textureX <= (TEXTURE_SIZE * 3) / 4;
        textureX += 1
      ) {
        const u = textureX / (TEXTURE_SIZE - 1);
        const surfaceAngle = (u - 0.5) * Math.PI * 2;
        const canvasX = POT_CENTER + Math.sin(surfaceAngle) * radius;
        const sourceX = clamp(
          Math.round(canvasX * sourceScaleX),
          0,
          brushLayer.width - 1,
        );
        const sourceIndex =
          (sourceY * brushLayer.width + sourceX) * 4;
        const alpha = brushPixels.data[sourceIndex + 3] / 255;
        if (alpha <= 0) continue;

        const textureIndex =
          (textureY * TEXTURE_SIZE + textureX) * 4;
        texturePixels.data[textureIndex] = Math.round(
          brushPixels.data[sourceIndex] * alpha +
            texturePixels.data[textureIndex] * (1 - alpha),
        );
        texturePixels.data[textureIndex + 1] = Math.round(
          brushPixels.data[sourceIndex + 1] * alpha +
            texturePixels.data[textureIndex + 1] * (1 - alpha),
        );
        texturePixels.data[textureIndex + 2] = Math.round(
          brushPixels.data[sourceIndex + 2] * alpha +
            texturePixels.data[textureIndex + 2] * (1 - alpha),
        );
      }
    }

    context.putImageData(texturePixels, 0, 0);
  }

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function PotteryModel({
  profile,
  brushLayer,
  canvasRef,
  sourceCanvasRef,
  onReady,
  onUnavailable,
}: PotteryModelProps) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
    } catch {
      onUnavailable();
      return;
    }

    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);

    const presentation = fitInitialPresentation(profile);
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.x = INITIAL_TILT;
    tiltGroup.scale.y = presentation.verticalScale;
    tiltGroup.position.y = MODEL_Y_OFFSET - presentation.projectedCenter;
    scene.add(tiltGroup);

    const spinGroup = new THREE.Group();
    spinGroup.rotation.y = Math.PI;
    tiltGroup.add(spinGroup);

    const points = profile
      .map((radius, index) => {
        const progress = index / Math.max(1, profile.length - 1);
        return new THREE.Vector2(
          Math.max(0.06, radius * PROFILE_TO_WORLD),
          MODEL_HEIGHT * 0.5 - progress * MODEL_HEIGHT,
        );
      })
      .reverse();

    const geometry = new THREE.LatheGeometry(points, 96);
    geometry.computeVertexNormals();

    const texture = createPotTexture(profile, brushLayer);
    if (texture) {
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    const gradientMap = new THREE.DataTexture(
      new Uint8Array([196, 238, 255]),
      3,
      1,
      THREE.RedFormat,
    );
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;

    const potteryMaterial = new THREE.MeshToonMaterial({
      color: 0xffffff,
      map: texture,
      gradientMap,
    });
    const pot = new THREE.Mesh(geometry, potteryMaterial);
    spinGroup.add(pot);

    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0x34322f,
      side: THREE.BackSide,
    });
    const outline = new THREE.Mesh(geometry, outlineMaterial);
    outline.scale.set(1.018, 1.006, 1.018);
    spinGroup.add(outline);

    const unmarkedMaterial = new THREE.MeshToonMaterial({
      color: 0xffffff,
      gradientMap,
      side: THREE.DoubleSide,
    });
    const topRadius = Math.max(0.06, profile[0] * PROFILE_TO_WORLD);
    const topY = MODEL_HEIGHT * 0.5;
    const openingRadius = Math.max(0.025, topRadius * 0.82);
    const rimHeightInCanvasPixels = clamp(
      profile[0] * POT_VISUAL_SCALE * 0.18,
      3,
      10.5,
    );
    const collarHeight =
      (Math.max(0, rimHeightInCanvasPixels - 1) * WORLD_PER_CANVAS_PIXEL) /
      (presentation.verticalScale * Math.cos(INITIAL_TILT));
    const rimY = topY + collarHeight;

    const collarGeometry = new THREE.CylinderGeometry(
      topRadius,
      topRadius,
      collarHeight,
      72,
      1,
      true,
    );
    const collar = new THREE.Mesh(collarGeometry, unmarkedMaterial);
    collar.position.y = topY + collarHeight * 0.5;
    spinGroup.add(collar);

    const rimGeometry = new THREE.RingGeometry(
      openingRadius,
      topRadius,
      72,
    );
    const rim = new THREE.Mesh(rimGeometry, unmarkedMaterial);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = rimY;
    spinGroup.add(rim);

    const interiorDepth = clamp(topRadius * 0.3, 0.06, 0.14);
    const interiorGeometry = new THREE.CylinderGeometry(
      openingRadius,
      openingRadius * 0.94,
      interiorDepth,
      72,
      1,
      true,
    );
    const interiorMaterial = new THREE.MeshBasicMaterial({
      color: 0x11100e,
      side: THREE.BackSide,
    });
    const interior = new THREE.Mesh(interiorGeometry, interiorMaterial);
    interior.position.y = rimY - interiorDepth * 0.5 - 0.006;
    spinGroup.add(interior);

    const mouthGeometry = new THREE.CircleGeometry(openingRadius * 0.94, 72);
    const mouthMaterial = new THREE.MeshBasicMaterial({ color: 0x030303 });
    const mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
    mouth.rotation.x = -Math.PI / 2;
    mouth.position.y = rimY - interiorDepth - 0.008;
    spinGroup.add(mouth);

    const bottomRadius = Math.max(
      0.06,
      profile[profile.length - 1] * PROFILE_TO_WORLD,
    );
    const bottomGeometry = new THREE.CircleGeometry(bottomRadius, 72);
    const bottom = new THREE.Mesh(bottomGeometry, unmarkedMaterial);
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -MODEL_HEIGHT * 0.5 + 0.004;
    spinGroup.add(bottom);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x111111, 0.62));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.28);
    keyLight.position.set(-3.4, 4.2, 4.8);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xffd7a0, 0.38);
    rimLight.position.set(3.5, 0.8, -2.4);
    scene.add(rimLight);

    let targetRotation = Math.PI;
    let targetTilt = INITIAL_TILT;
    let dragging = false;
    let activePointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    let frame = 0;
    let lastFrameTime = performance.now();
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const endDrag = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      dragging = false;
      activePointerId = null;
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || activePointerId !== null) {
        return;
      }
      dragging = true;
      activePointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== activePointerId) return;
      targetRotation += (event.clientX - lastX) * 0.012;
      targetTilt = THREE.MathUtils.clamp(
        targetTilt + (event.clientY - lastY) * 0.004,
        -0.22,
        MAX_TILT,
      );
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      dragging = false;
      activePointerId = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        targetRotation += event.key === "ArrowLeft" ? -0.22 : 0.22;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        targetTilt = THREE.MathUtils.clamp(
          targetTilt + (event.key === "ArrowUp" ? 0.08 : -0.08),
          -0.22,
          MAX_TILT,
        );
      }
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("lostpointercapture", endDrag);
    canvas.addEventListener("keydown", handleKeyDown);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);

      const sourceBounds = sourceCanvasRef.current?.getBoundingClientRect();
      const canvasScale = sourceBounds
        ? Math.max(
            0.01,
            Math.min(
              sourceBounds.width / CANVAS_WIDTH,
              sourceBounds.height / CANVAS_HEIGHT,
            ),
          )
        : Math.max(
            0.01,
            Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT),
          );
      const worldPerScreenPixel = WORLD_PER_CANVAS_PIXEL / canvasScale;
      camera.left = (-width * worldPerScreenPixel) / 2;
      camera.right = (width * worldPerScreenPixel) / 2;
      camera.top = (height * worldPerScreenPixel) / 2;
      camera.bottom = (-height * worldPerScreenPixel) / 2;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    if (sourceCanvasRef.current) {
      resizeObserver.observe(sourceCanvasRef.current);
    }
    resize();

    const render = (time: number) => {
      const delta = Math.min((time - lastFrameTime) / 1000, 0.05);
      lastFrameTime = time;
      if (!dragging && !reduceMotion) targetRotation += delta * 0.09;
      spinGroup.rotation.y +=
        (targetRotation - spinGroup.rotation.y) * 0.11;
      tiltGroup.rotation.x += (targetTilt - tiltGroup.rotation.x) * 0.11;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    renderer.render(scene, camera);
    canvas.classList.add("is-ready");
    canvas.setAttribute("aria-busy", "false");
    onReady();
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.classList.remove("is-ready");
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("lostpointercapture", endDrag);
      canvas.removeEventListener("keydown", handleKeyDown);
      geometry.dispose();
      collarGeometry.dispose();
      rimGeometry.dispose();
      interiorGeometry.dispose();
      mouthGeometry.dispose();
      bottomGeometry.dispose();
      potteryMaterial.dispose();
      unmarkedMaterial.dispose();
      outlineMaterial.dispose();
      interiorMaterial.dispose();
      mouthMaterial.dispose();
      texture?.dispose();
      gradientMap.dispose();
      renderer.dispose();
    };
  }, [brushLayer, canvasRef, onReady, onUnavailable, profile, sourceCanvasRef]);

  return (
    <div className="pottery-model">
      <canvas
        ref={canvasRef}
        role="application"
        aria-label="Finished pottery in 3D. Drag or use the arrow keys to rotate."
        aria-busy="true"
        tabIndex={0}
      />
    </div>
  );
}
