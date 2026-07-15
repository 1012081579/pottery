"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Stage = "shape" | "glaze" | "fire" | "reveal";
type GlazeKey = "celadon" | "moon" | "cobalt" | "persimmon";
type MicStatus =
  | "idle"
  | "requesting"
  | "calibrating"
  | "ready"
  | "denied"
  | "unsupported";

type PointerState = {
  down: boolean;
  mode: "shape" | "glaze" | null;
  x: number;
  y: number;
};

type AudioState = {
  context: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
  frame: number;
};

type Glaze = {
  key: GlazeKey;
  name: string;
  note: string;
  wet: string;
  fired: string;
  ring: string;
};

const CANVAS_WIDTH = 360;
const CANVAS_HEIGHT = 440;
const POT_CENTER = 180;
const POT_TOP = 58;
const POT_BOTTOM = 344;
const PROFILE_COUNT = 32;

const GLAZES: readonly Glaze[] = [
  {
    key: "celadon",
    name: "雨过青",
    note: "清透温润",
    wet: "#67827e",
    fired: "#7c9e95",
    ring: "#425f5c",
  },
  {
    key: "moon",
    name: "月白",
    note: "柔光乳浊",
    wet: "#d5d0bd",
    fired: "#e4dfcc",
    ring: "#ada68f",
  },
  {
    key: "cobalt",
    name: "霁蓝",
    note: "沉静深邃",
    wet: "#38516c",
    fired: "#284d72",
    ring: "#1e354d",
  },
  {
    key: "persimmon",
    name: "柿红",
    note: "铁锈流金",
    wet: "#a35b3e",
    fired: "#b55d3d",
    ring: "#7a3829",
  },
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function glazeByKey(key: GlazeKey) {
  return GLAZES.find((glaze) => glaze.key === key) ?? GLAZES[0];
}

function makeProfile(kind: "cloud" | "column" | "gourd") {
  return Array.from({ length: PROFILE_COUNT }, (_, index) => {
    const t = index / (PROFILE_COUNT - 1);

    if (kind === "column") {
      return (
        66 +
        7 * Math.exp(-Math.pow((t - 0.52) / 0.34, 2)) -
        10 * Math.exp(-Math.pow((t - 0.88) / 0.12, 2)) +
        2 * t
      );
    }

    if (kind === "gourd") {
      return (
        43 +
        35 * Math.exp(-Math.pow((t - 0.26) / 0.18, 2)) +
        52 * Math.exp(-Math.pow((t - 0.66) / 0.23, 2)) -
        15 * Math.exp(-Math.pow((t - 0.45) / 0.1, 2)) +
        12 * t
      );
    }

    return (
      48 +
      55 * Math.exp(-Math.pow((t - 0.5) / 0.3, 2)) -
      12 * Math.exp(-Math.pow((t - 0.08) / 0.12, 2)) -
      12 * Math.exp(-Math.pow((t - 0.9) / 0.12, 2)) +
      17 * t
    );
  });
}

const INITIAL_PROFILE = makeProfile("cloud");

const PRESETS = [
  { id: "cloud" as const, name: "丰肩" },
  { id: "column" as const, name: "直筒" },
  { id: "gourd" as const, name: "葫芦" },
];

function addSmoothCurve(
  path: Path2D,
  points: Array<{ x: number; y: number }>,
) {
  path.moveTo(points[0].x, points[0].y);
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] ?? next;

    path.bezierCurveTo(
      current.x + (next.x - previous.x) / 6,
      current.y + (next.y - previous.y) / 6,
      next.x - (afterNext.x - current.x) / 6,
      next.y - (afterNext.y - current.y) / 6,
      next.x,
      next.y,
    );
  }
}

function buildPotPath(profile: number[]) {
  const step = (POT_BOTTOM - POT_TOP) / (profile.length - 1);
  const left = profile.map((radius, index) => ({
    x: POT_CENTER - radius,
    y: POT_TOP + index * step,
  }));
  const right = profile
    .map((radius, index) => ({
      x: POT_CENTER + radius,
      y: POT_TOP + index * step,
    }))
    .reverse();
  const path = new Path2D();
  addSmoothCurve(path, [...left, ...right]);
  path.closePath();
  return path;
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function mixHex(from: string, to: string, amount: number) {
  const first = hexToRgb(from);
  const second = hexToRgb(to);
  const t = clamp(amount, 0, 1);
  const channel = (start: number, end: number) =>
    Math.round(start + (end - start) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(first.r, second.r)}${channel(first.g, second.g)}${channel(first.b, second.b)}`;
}

function drawWheel(ctx: CanvasRenderingContext2D, time: number) {
  const wheelY = POT_BOTTOM + 31;
  const shadow = ctx.createRadialGradient(
    POT_CENTER,
    wheelY + 16,
    12,
    POT_CENTER,
    wheelY + 16,
    145,
  );
  shadow.addColorStop(0, "rgba(70, 48, 34, .28)");
  shadow.addColorStop(1, "rgba(70, 48, 34, 0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(25, wheelY - 10, 310, 75);

  ctx.beginPath();
  ctx.ellipse(POT_CENTER, wheelY + 18, 118, 27, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#7c6b5b";
  ctx.fill();

  const top = ctx.createLinearGradient(0, wheelY - 5, 0, wheelY + 22);
  top.addColorStop(0, "#c8b6a0");
  top.addColorStop(1, "#95816c");
  ctx.beginPath();
  ctx.ellipse(POT_CENTER, wheelY, 121, 25, 0, 0, Math.PI * 2);
  ctx.fillStyle = top;
  ctx.fill();

  ctx.save();
  ctx.translate(POT_CENTER, wheelY);
  ctx.rotate(time * 0.00025);
  ctx.strokeStyle = "rgba(255, 248, 235, .45)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 88, 16, 0, 0.15, 2.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, 55, 10, 0, 3.2, 5.7);
  ctx.stroke();
  ctx.restore();
}

function drawPot(
  ctx: CanvasRenderingContext2D,
  profile: number[],
  bands: Array<GlazeKey | null>,
  stage: Stage,
  fireProgress: number,
) {
  const path = buildPotPath(profile);
  const isFired = stage === "fire" || stage === "reveal";
  const clayTop = isFired
    ? mixHex("#a8664e", "#884433", fireProgress)
    : "#c98261";
  const clayEdge = isFired
    ? mixHex("#82472f", "#5b2c24", fireProgress)
    : "#8f4e39";
  const body = ctx.createLinearGradient(
    POT_CENTER - 118,
    0,
    POT_CENTER + 118,
    0,
  );
  body.addColorStop(0, clayEdge);
  body.addColorStop(0.18, clayTop);
  body.addColorStop(0.48, mixHex(clayTop, "#f1c09a", 0.42));
  body.addColorStop(0.72, clayTop);
  body.addColorStop(1, clayEdge);
  ctx.fillStyle = body;
  ctx.fill(path);

  ctx.save();
  ctx.clip(path);
  const rowHeight = (POT_BOTTOM - POT_TOP) / bands.length + 1.5;
  bands.forEach((key, index) => {
    if (!key) return;
    const glaze = glazeByKey(key);
    const firedAmount = stage === "reveal" ? 1 : stage === "fire" ? fireProgress : 0;
    ctx.fillStyle = mixHex(glaze.wet, glaze.fired, firedAmount);
    ctx.fillRect(
      0,
      POT_TOP + index * ((POT_BOTTOM - POT_TOP) / bands.length),
      CANVAS_WIDTH,
      rowHeight,
    );
  });

  const volume = ctx.createLinearGradient(
    POT_CENTER - 130,
    0,
    POT_CENTER + 130,
    0,
  );
  volume.addColorStop(0, "rgba(43, 24, 18, .32)");
  volume.addColorStop(0.16, "rgba(80, 42, 28, .08)");
  volume.addColorStop(0.42, "rgba(255, 244, 215, .2)");
  volume.addColorStop(0.62, "rgba(255, 255, 255, .05)");
  volume.addColorStop(1, "rgba(38, 22, 17, .32)");
  ctx.fillStyle = volume;
  ctx.fillRect(30, POT_TOP - 12, CANVAS_WIDTH - 60, POT_BOTTOM - POT_TOP + 30);

  ctx.strokeStyle = "rgba(72, 37, 26, .13)";
  ctx.lineWidth = 0.8;
  for (let y = POT_TOP + 12; y < POT_BOTTOM; y += 9) {
    ctx.beginPath();
    ctx.moveTo(48, y);
    ctx.quadraticCurveTo(POT_CENTER, y + 2.5, CANVAS_WIDTH - 48, y);
    ctx.stroke();
  }

  if (bands.some(Boolean)) {
    for (let index = 0; index < 54; index += 1) {
      const x = 58 + ((index * 73) % 244);
      const y = POT_TOP + ((index * 47) % Math.round(POT_BOTTOM - POT_TOP));
      ctx.beginPath();
      ctx.arc(x, y, index % 4 === 0 ? 1.1 : 0.65, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(46, 35, 29, .1)";
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.strokeStyle = isFired
    ? "rgba(54, 27, 24, .58)"
    : "rgba(92, 46, 34, .5)";
  ctx.lineWidth = 1.5;
  ctx.stroke(path);

  const rimKey = bands[0];
  const rimGlaze = rimKey ? glazeByKey(rimKey) : null;
  const rimColor = rimGlaze
    ? mixHex(
        rimGlaze.wet,
        rimGlaze.fired,
        stage === "reveal" ? 1 : stage === "fire" ? fireProgress : 0,
      )
    : clayTop;
  ctx.beginPath();
  ctx.ellipse(POT_CENTER, POT_TOP + 1, profile[0], 10.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = mixHex(rimColor, "#33251f", 0.18);
  ctx.fill();
  ctx.strokeStyle = "rgba(52, 29, 23, .55)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(
    POT_CENTER,
    POT_TOP + 1,
    Math.max(12, profile[0] - 8),
    6.3,
    0,
    0,
    Math.PI * 2,
  );
  const mouth = ctx.createRadialGradient(
    POT_CENTER,
    POT_TOP,
    2,
    POT_CENTER,
    POT_TOP,
    profile[0],
  );
  mouth.addColorStop(0, "#2d211d");
  mouth.addColorStop(0.65, "#4b3027");
  mouth.addColorStop(1, mixHex(rimColor, "#291a16", 0.55));
  ctx.fillStyle = mouth;
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.36;
  ctx.strokeStyle = "#fff1dc";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  profile.slice(2, -4).forEach((radius, index) => {
    const y = POT_TOP + ((index + 2) / (profile.length - 1)) * (POT_BOTTOM - POT_TOP);
    const x = POT_CENTER - radius * 0.58;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawFlames(
  ctx: CanvasRenderingContext2D,
  time: number,
  power: number,
  foreground: boolean,
) {
  const baseY = foreground ? 395 : 380;
  const count = foreground ? 5 : 4;
  for (let index = 0; index < count; index += 1) {
    const center = 60 + index * (foreground ? 62 : 78) + (foreground ? 0 : 14);
    const sway = Math.sin(time * 0.004 + index * 1.7) * (4 + power * 8);
    const height =
      (foreground ? 62 : 92) +
      power * (foreground ? 95 : 130) +
      Math.sin(time * 0.006 + index) * 14;
    const width = foreground ? 32 : 42;
    const flame = ctx.createLinearGradient(0, baseY, 0, baseY - height);
    flame.addColorStop(0, foreground ? "rgba(255, 91, 24, .9)" : "rgba(213, 53, 20, .68)");
    flame.addColorStop(0.45, foreground ? "rgba(255, 170, 48, .92)" : "rgba(255, 111, 24, .75)");
    flame.addColorStop(1, "rgba(255, 231, 139, .06)");
    ctx.beginPath();
    ctx.moveTo(center - width, baseY);
    ctx.bezierCurveTo(
      center - width * 0.85,
      baseY - height * 0.34,
      center + sway - width * 0.2,
      baseY - height * 0.62,
      center + sway,
      baseY - height,
    );
    ctx.bezierCurveTo(
      center + sway + width * 0.55,
      baseY - height * 0.58,
      center + width,
      baseY - height * 0.34,
      center + width,
      baseY,
    );
    ctx.closePath();
    ctx.fillStyle = flame;
    ctx.fill();
  }
}

function drawKiln(
  ctx: CanvasRenderingContext2D,
  time: number,
  profile: number[],
  bands: Array<GlazeKey | null>,
  power: number,
  fireProgress: number,
) {
  const glow = ctx.createRadialGradient(
    POT_CENTER,
    245,
    20,
    POT_CENTER,
    245,
    225,
  );
  glow.addColorStop(0, `rgba(255, 120, 42, ${0.18 + power * 0.34})`);
  glow.addColorStop(0.48, "rgba(105, 39, 24, .28)");
  glow.addColorStop(1, "rgba(20, 16, 16, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.beginPath();
  ctx.moveTo(34, 415);
  ctx.lineTo(34, 184);
  ctx.bezierCurveTo(34, 66, 92, 18, POT_CENTER, 18);
  ctx.bezierCurveTo(268, 18, 326, 66, 326, 184);
  ctx.lineTo(326, 415);
  ctx.closePath();
  ctx.fillStyle = "#2c2422";
  ctx.fill();
  ctx.strokeStyle = "rgba(145, 104, 82, .28)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(57, 408);
  ctx.lineTo(57, 191);
  ctx.bezierCurveTo(57, 88, 105, 45, POT_CENTER, 45);
  ctx.bezierCurveTo(255, 45, 303, 88, 303, 191);
  ctx.lineTo(303, 408);
  ctx.closePath();
  ctx.fillStyle = "#181719";
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = "rgba(129, 82, 64, .16)";
  ctx.lineWidth = 1;
  for (let y = 92; y < 390; y += 42) {
    ctx.beginPath();
    ctx.moveTo(42, y);
    ctx.lineTo(318, y);
    ctx.stroke();
  }
  for (let x = 78; x < 310; x += 56) {
    ctx.beginPath();
    ctx.moveTo(x, 120 + ((x / 56) % 2) * 22);
    ctx.lineTo(x, 405);
    ctx.stroke();
  }
  ctx.restore();

  drawFlames(ctx, time, power, false);
  drawPot(ctx, profile, bands, "fire", fireProgress);
  drawFlames(ctx, time + 190, power, true);

  for (let index = 0; index < 11; index += 1) {
    const cycle = (time * (0.025 + index * 0.0015) + index * 37) % 250;
    const x = 55 + ((index * 61) % 250) + Math.sin(time * 0.003 + index) * 8;
    const y = 382 - cycle * (0.55 + power * 0.7);
    if (y < 64 || power < 0.12) continue;
    ctx.beginPath();
    ctx.arc(x, y, index % 3 === 0 ? 1.8 : 1.1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, ${156 + (index % 3) * 25}, 72, ${0.25 + power * 0.65})`;
    ctx.fill();
  }
}

function drawStudio(
  ctx: CanvasRenderingContext2D,
  time: number,
  profile: number[],
  bands: Array<GlazeKey | null>,
  stage: Stage,
  pointer: PointerState,
) {
  const halo = ctx.createRadialGradient(
    POT_CENTER,
    190,
    20,
    POT_CENTER,
    210,
    190,
  );
  halo.addColorStop(0, "rgba(255, 250, 233, .78)");
  halo.addColorStop(1, "rgba(255, 250, 233, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.save();
  ctx.setLineDash([3, 8]);
  ctx.strokeStyle = "rgba(117, 84, 59, .16)";
  ctx.beginPath();
  ctx.moveTo(POT_CENTER, 33);
  ctx.lineTo(POT_CENTER, POT_BOTTOM + 8);
  ctx.stroke();
  ctx.restore();

  drawWheel(ctx, time);
  drawPot(ctx, profile, bands, stage, 0);

  if (pointer.down) {
    const radius = pointer.mode === "glaze" ? 18 : 14;
    const pulse = 2 + Math.sin(time * 0.01) * 2;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius + pulse, 0, Math.PI * 2);
    ctx.strokeStyle =
      pointer.mode === "glaze" ? "rgba(255, 250, 232, .78)" : "rgba(91, 48, 35, .48)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = pointer.mode === "glaze" ? "#fff9eb" : "#70402f";
    ctx.fill();
  }
}

function drawReveal(
  ctx: CanvasRenderingContext2D,
  time: number,
  profile: number[],
  bands: Array<GlazeKey | null>,
) {
  const aura = ctx.createRadialGradient(
    POT_CENTER,
    210,
    35,
    POT_CENTER,
    210,
    205,
  );
  aura.addColorStop(0, "rgba(255, 244, 210, .9)");
  aura.addColorStop(0.56, "rgba(220, 187, 129, .24)");
  aura.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.save();
  ctx.translate(POT_CENTER, 204);
  ctx.rotate(time * 0.00003);
  ctx.strokeStyle = "rgba(151, 109, 61, .12)";
  for (let index = 0; index < 18; index += 1) {
    ctx.rotate((Math.PI * 2) / 18);
    ctx.beginPath();
    ctx.moveTo(126, 0);
    ctx.lineTo(174, 0);
    ctx.stroke();
  }
  ctx.restore();

  const pedestal = ctx.createLinearGradient(0, 368, 0, 412);
  pedestal.addColorStop(0, "#c8b49b");
  pedestal.addColorStop(1, "#8d7864");
  ctx.beginPath();
  ctx.ellipse(POT_CENTER, 387, 110, 25, 0, 0, Math.PI * 2);
  ctx.fillStyle = pedestal;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(POT_CENTER, 375, 110, 23, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#ded0bc";
  ctx.fill();
  drawPot(ctx, profile, bands, "reveal", 1);

  for (let index = 0; index < 9; index += 1) {
    const x = 38 + ((index * 83) % 290);
    const y = 55 + ((index * 47 + time * 0.006) % 265);
    ctx.beginPath();
    ctx.arc(x, y, index % 2 ? 1.2 : 1.7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(153, 112, 67, .2)";
    ctx.fill();
  }
}

const STAGE_COPY: Record<Stage, { eyebrow: string; title: string; description: string }> = {
  shape: {
    eyebrow: "第一步 · 塑形",
    title: "让泥土跟着手指呼吸",
    description: "沿着陶坯边缘轻轻推拉，收窄口沿，或撑起一段饱满的器腹。",
  },
  glaze: {
    eyebrow: "第二步 · 上釉",
    title: "为器物披上一层颜色",
    description: "选一味釉色，在器身上滑动。可以分段叠色，也可以整器浸釉。",
  },
  fire: {
    eyebrow: "第三步 · 烧制",
    title: "以气息，唤醒窑火",
    description: "对着麦克风短短吹几次。风越强，火越旺；累了就停下来。",
  },
  reveal: {
    eyebrow: "开窑 · 完成",
    title: "这件器物，只属于你",
    description: "泥、釉、火与气息，在这一刻留下了独一无二的痕迹。",
  },
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>("shape");
  const [profile, setProfile] = useState<number[]>(() => [...INITIAL_PROFILE]);
  const [history, setHistory] = useState<number[][]>([]);
  const [glazeBands, setGlazeBands] = useState<Array<GlazeKey | null>>(() =>
    Array.from({ length: PROFILE_COUNT }, () => null),
  );
  const [selectedGlaze, setSelectedGlaze] = useState<GlazeKey>("celadon");
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [firePower, setFirePower] = useState(0);
  const [fireProgress, setFireProgress] = useState(0);
  const [manualActive, setManualActive] = useState(false);
  const [cooling, setCooling] = useState(false);

  const stageRef = useRef(stage);
  const profileRef = useRef(profile);
  const glazeBandsRef = useRef(glazeBands);
  const pointerRef = useRef<PointerState>({
    down: false,
    mode: null,
    x: POT_CENTER,
    y: 210,
  });
  const gestureRef = useRef<{
    lastX: number;
    side: 1 | -1;
    snapshot: number[];
    changed: boolean;
  } | null>(null);
  const audioRef = useRef<AudioState | null>(null);
  const micRequestIdRef = useRef(0);
  const micPowerRef = useRef(0);
  const manualPowerRef = useRef(0);
  const firePowerRef = useRef(0);
  const fireProgressRef = useRef(0);
  const coolingRef = useRef(false);

  const glazedCount = useMemo(
    () => glazeBands.filter(Boolean).length,
    [glazeBands],
  );
  const glazeCoverage = glazedCount / PROFILE_COUNT;

  const dominantGlaze = useMemo(() => {
    const counts = new Map<GlazeKey, number>();
    glazeBands.forEach((key) => {
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    let best: GlazeKey = selectedGlaze;
    let bestCount = -1;
    counts.forEach((count, key) => {
      if (count > bestCount) {
        best = key;
        bestCount = count;
      }
    });
    return glazeByKey(best);
  }, [glazeBands, selectedGlaze]);

  const stopMicrophone = useCallback(() => {
    micRequestIdRef.current += 1;
    const audio = audioRef.current;
    if (!audio) return;
    cancelAnimationFrame(audio.frame);
    audio.stream.getTracks().forEach((track) => track.stop());
    void audio.context.close().catch(() => undefined);
    audioRef.current = null;
    micPowerRef.current = 0;
  }, []);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    return () => stopMicrophone();
  }, [stopMicrophone]);

  useEffect(() => {
    const releaseManualPower = () => {
      manualPowerRef.current = 0;
      setManualActive(false);
    };
    window.addEventListener("blur", releaseManualPower);
    document.addEventListener("visibilitychange", releaseManualPower);
    return () => {
      window.removeEventListener("blur", releaseManualPower);
      document.removeEventListener("visibilitychange", releaseManualPower);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = CANVAS_WIDTH * pixelRatio;
    canvas.height = CANVAS_HEIGHT * pixelRatio;

    let animationFrame = 0;
    const paint = (time: number) => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      if (stageRef.current === "fire") {
        drawKiln(
          context,
          time,
          profileRef.current,
          glazeBandsRef.current,
          firePowerRef.current,
          fireProgressRef.current,
        );
      } else if (stageRef.current === "reveal") {
        drawReveal(context, time, profileRef.current, glazeBandsRef.current);
      } else {
        drawStudio(
          context,
          time,
          profileRef.current,
          glazeBandsRef.current,
          stageRef.current,
          pointerRef.current,
        );
      }
      animationFrame = requestAnimationFrame(paint);
    };
    animationFrame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (stage !== "fire") return;
    let frame = 0;
    let lastTime = performance.now();
    let lastUiUpdate = 0;
    let revealTimer: ReturnType<typeof setTimeout> | null = null;

    const advanceFire = (time: number) => {
      const delta = Math.min((time - lastTime) / 1000, 0.06);
      lastTime = time;
      const target = Math.max(micPowerRef.current, manualPowerRef.current);
      const smoothing = target > firePowerRef.current ? 0.28 : 0.075;
      firePowerRef.current += (target - firePowerRef.current) * smoothing;

      if (!coolingRef.current && firePowerRef.current > 0.08) {
        const speed = (0.16 + firePowerRef.current * 0.84) / 7.2;
        fireProgressRef.current = Math.min(
          1,
          fireProgressRef.current + delta * speed,
        );
      }

      if (time - lastUiUpdate > 55) {
        setFirePower(firePowerRef.current);
        setFireProgress(fireProgressRef.current);
        lastUiUpdate = time;
      }

      if (fireProgressRef.current >= 1 && !coolingRef.current) {
        coolingRef.current = true;
        setCooling(true);
        setMicStatus("idle");
        manualPowerRef.current = 0;
        setManualActive(false);
        stopMicrophone();
        revealTimer = setTimeout(() => setStage("reveal"), 1450);
      }

      frame = requestAnimationFrame(advanceFire);
    };
    frame = requestAnimationFrame(advanceFire);
    return () => {
      cancelAnimationFrame(frame);
      if (revealTimer) clearTimeout(revealTimer);
    };
  }, [stage, stopMicrophone]);

  const startMicrophone = async () => {
    stopMicrophone();
    const requestId = micRequestIdRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("unsupported");
      return;
    }

    setMicStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (requestId !== micRequestIdRef.current || stageRef.current !== "fire") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const audioWindow = window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      };
      const AudioContextConstructor =
        window.AudioContext ?? audioWindow.webkitAudioContext;
      if (!AudioContextConstructor) {
        stream.getTracks().forEach((track) => track.stop());
        setMicStatus("unsupported");
        return;
      }

      const context = new AudioContextConstructor();
      await context.resume();
      if (requestId !== micRequestIdRef.current || stageRef.current !== "fire") {
        stream.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => undefined);
        return;
      }
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.18;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const noiseSamples: number[] = [];
      const startedAt = performance.now();
      let baseline = -58;
      let readyAnnounced = false;
      setMicStatus("calibrating");

      const sample = (time: number) => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const byte of data) {
          const normalized = (byte - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / data.length);
        const decibels = 20 * Math.log10(Math.max(rms, 0.00001));

        if (time - startedAt < 850) {
          noiseSamples.push(decibels);
        } else {
          if (!readyAnnounced) {
            baseline = clamp(
              noiseSamples.reduce((total, value) => total + value, 0) /
                Math.max(1, noiseSamples.length),
              -78,
              -28,
            );
            readyAnnounced = true;
            setMicStatus("ready");
          }
          const rawPower = clamp((decibels - baseline - 4.5) / 17, 0, 1);
          const coefficient = rawPower > micPowerRef.current ? 0.34 : 0.08;
          micPowerRef.current +=
            (rawPower - micPowerRef.current) * coefficient;
        }

        const currentAudio = audioRef.current;
        if (currentAudio) {
          currentAudio.frame = requestAnimationFrame(sample);
        }
      };

      audioRef.current = { context, stream, analyser, frame: 0 };
      audioRef.current.frame = requestAnimationFrame(sample);
    } catch {
      if (requestId !== micRequestIdRef.current || stageRef.current !== "fire") {
        return;
      }
      micPowerRef.current = 0;
      setMicStatus("denied");
    }
  };

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * CANVAS_WIDTH,
      y: ((event.clientY - bounds.top) / bounds.height) * CANVAS_HEIGHT,
    };
  };

  const isInsidePot = (x: number, y: number) => {
    if (y < POT_TOP - 16 || y > POT_BOTTOM + 12) return false;
    const index = clamp(
      Math.round(((y - POT_TOP) / (POT_BOTTOM - POT_TOP)) * (PROFILE_COUNT - 1)),
      0,
      PROFILE_COUNT - 1,
    );
    return Math.abs(x - POT_CENTER) <= profileRef.current[index] + 28;
  };

  const paintGlaze = (x: number, y: number) => {
    if (!isInsidePot(x, y)) return;
    const index = clamp(
      Math.round(((y - POT_TOP) / (POT_BOTTOM - POT_TOP)) * (PROFILE_COUNT - 1)),
      0,
      PROFILE_COUNT - 1,
    );
    const next = [...glazeBandsRef.current];
    for (let offset = -2; offset <= 2; offset += 1) {
      const target = index + offset;
      if (target >= 0 && target < PROFILE_COUNT) next[target] = selectedGlaze;
    }
    glazeBandsRef.current = next;
    setGlazeBands(next);
  };

  const shapeAtPoint = (x: number, y: number) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const delta = (x - gesture.lastX) * gesture.side;
    gesture.lastX = x;
    if (Math.abs(delta) < 0.15) return;
    const centerIndex = clamp(
      Math.round(((y - POT_TOP) / (POT_BOTTOM - POT_TOP)) * (PROFILE_COUNT - 1)),
      0,
      PROFILE_COUNT - 1,
    );
    const next = profileRef.current.map((radius, index) => {
      const distance = index - centerIndex;
      const influence = Math.exp(-(distance * distance) / (2 * 2.35 * 2.35));
      const baseLock = index > PROFILE_COUNT - 4 ? 0.18 : 1;
      const minimum = index < 4 ? 32 : 40;
      const maximum = index < 4 ? 98 : 126;
      return clamp(radius + delta * 0.72 * influence * baseLock, minimum, maximum);
    });
    const smoothed = [...next];
    for (let index = 1; index < PROFILE_COUNT - 3; index += 1) {
      smoothed[index] =
        next[index] * 0.72 + next[index - 1] * 0.14 + next[index + 1] * 0.14;
    }
    gesture.changed = true;
    profileRef.current = smoothed;
    setProfile(smoothed);
  };

  const finishCanvasGesture = () => {
    const gesture = gestureRef.current;
    if (gesture?.changed) {
      setHistory((items) => [...items.slice(-7), gesture.snapshot]);
    }
    gestureRef.current = null;
    pointerRef.current = { ...pointerRef.current, down: false, mode: null };
  };

  const handleCanvasPointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (stage !== "shape" && stage !== "glaze") return;
    const point = canvasPoint(event);
    if (!isInsidePot(point.x, point.y)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { down: true, mode: stage, ...point };
    if (stage === "shape") {
      gestureRef.current = {
        lastX: point.x,
        side: point.x >= POT_CENTER ? 1 : -1,
        snapshot: [...profileRef.current],
        changed: false,
      };
    } else {
      paintGlaze(point.x, point.y);
    }
  };

  const handleCanvasPointerMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (!pointerRef.current.down) return;
    const point = canvasPoint(event);
    pointerRef.current = { ...pointerRef.current, ...point };
    if (pointerRef.current.mode === "shape") shapeAtPoint(point.x, point.y);
    if (pointerRef.current.mode === "glaze") paintGlaze(point.x, point.y);
  };

  const handleCanvasPointerUp = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    finishCanvasGesture();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const applyPreset = (kind: "cloud" | "column" | "gourd") => {
    setHistory((items) => [...items.slice(-7), [...profileRef.current]]);
    const next = makeProfile(kind);
    profileRef.current = next;
    setProfile(next);
  };

  const undoShape = () => {
    const previous = history.at(-1);
    if (!previous) return;
    const next = [...previous];
    profileRef.current = next;
    setProfile(next);
    setHistory((items) => items.slice(0, -1));
  };

  const resetShape = () => {
    setHistory((items) => [...items.slice(-7), [...profileRef.current]]);
    const next = [...INITIAL_PROFILE];
    profileRef.current = next;
    setProfile(next);
  };

  const dipWholePiece = () => {
    const next = Array.from(
      { length: PROFILE_COUNT },
      () => selectedGlaze as GlazeKey,
    );
    glazeBandsRef.current = next;
    setGlazeBands(next);
  };

  const enterFire = () => {
    stopMicrophone();
    firePowerRef.current = 0;
    fireProgressRef.current = 0;
    micPowerRef.current = 0;
    manualPowerRef.current = 0;
    coolingRef.current = false;
    setFirePower(0);
    setFireProgress(0);
    setCooling(false);
    setMicStatus("idle");
    setStage("fire");
  };

  const leaveFire = () => {
    stopMicrophone();
    micPowerRef.current = 0;
    manualPowerRef.current = 0;
    firePowerRef.current = 0;
    fireProgressRef.current = 0;
    coolingRef.current = false;
    setManualActive(false);
    setFirePower(0);
    setFireProgress(0);
    setCooling(false);
    setMicStatus("idle");
    setStage("glaze");
  };

  const beginManualFire = () => {
    if (cooling) return;
    manualPowerRef.current = 1;
    setManualActive(true);
  };

  const endManualFire = () => {
    manualPowerRef.current = 0;
    setManualActive(false);
  };

  const handleBreathKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      beginManualFire();
    }
  };

  const handleBreathKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      endManualFire();
    }
  };

  const restart = () => {
    stopMicrophone();
    const nextProfile = [...INITIAL_PROFILE];
    const nextBands = Array.from({ length: PROFILE_COUNT }, () => null);
    profileRef.current = nextProfile;
    glazeBandsRef.current = nextBands;
    fireProgressRef.current = 0;
    firePowerRef.current = 0;
    micPowerRef.current = 0;
    manualPowerRef.current = 0;
    coolingRef.current = false;
    setProfile(nextProfile);
    setGlazeBands(nextBands);
    setHistory([]);
    setSelectedGlaze("celadon");
    setMicStatus("idle");
    setFireProgress(0);
    setFirePower(0);
    setManualActive(false);
    setCooling(false);
    setStage("shape");
  };

  const savePiece = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `泥火间-${dominantGlaze.name}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const temperature = Math.min(
    1280,
    Math.round(24 + 1210 * Math.pow(fireProgress, 0.72) + firePower * 46),
  );
  const progressPercent = Math.round(fireProgress * 100);
  const stepIndex = stage === "shape" ? 0 : stage === "glaze" ? 1 : 2;
  const copy = STAGE_COPY[stage];
  const canvasLabel =
    stage === "shape"
      ? "可触摸塑形的陶坯。沿器身左右拖动改变轮廓。"
      : stage === "glaze"
        ? "可触摸上釉的陶器。在器身上下滑动涂抹所选釉色。"
        : stage === "fire"
          ? "窑火与陶器，火焰会随吹气强度变化。"
          : "已经烧制完成的陶艺作品。";

  return (
    <main className={`experience stage-${stage}`}>
      <aside className="ambient-copy" aria-hidden="true">
        <div className="ambient-mark">泥火间</div>
        <div className="ambient-words">
          <span>泥</span>
          <span>火</span>
          <span>息</span>
        </div>
        <p>用双手留住形，用一口气唤醒火。</p>
        <div className="ambient-index">DIGITAL POTTERY · 001</div>
      </aside>

      <section className="studio-shell" aria-label="泥火间陶艺工作室">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-seal" aria-hidden="true">泥</span>
            <span>
              <strong>泥火间</strong>
              <small>NÍ HUǑ JIĀN</small>
            </span>
          </div>
          <span className="piece-number">作品 001</span>
        </header>

        <nav className="process" aria-label="制作进度">
          {["塑形", "上釉", "烧制"].map((label, index) => {
            const completed = stage === "reveal" || index < stepIndex;
            const active = stage !== "reveal" && index === stepIndex;
            return (
              <div
                className={`process-step ${completed ? "is-complete" : ""} ${active ? "is-active" : ""}`}
                key={label}
                aria-current={active ? "step" : undefined}
              >
                <span className="process-dot">{completed ? "✓" : index + 1}</span>
                <span>{label}</span>
              </div>
            );
          })}
        </nav>

        <div className="stage-body">
          <div className="stage-copy">
            <span>{copy.eyebrow}</span>
            <h1>{cooling ? "嘘，釉色正在冷却" : copy.title}</h1>
            <p>{cooling ? "最后一点火光正在退去，开窑就在片刻之后。" : copy.description}</p>
          </div>

          <div className={`canvas-wrap ${cooling ? "is-cooling" : ""}`}>
            <canvas
              ref={canvasRef}
              className="pottery-canvas"
              aria-label={canvasLabel}
              role="img"
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
            />
            {stage === "shape" && (
              <div className="gesture-hint" aria-hidden="true">
                <span className="gesture-finger" />
                <span>贴近器身 · 左右推拉</span>
              </div>
            )}
            {stage === "glaze" && glazeCoverage < 0.08 && (
              <div className="gesture-hint glaze-hint" aria-hidden="true">
                <span className="gesture-finger" />
                <span>在器身上滑动上釉</span>
              </div>
            )}
            {cooling && (
              <div className="cooling-veil" role="status">
                <span className="cooling-orbit" />
                <strong>降温中</strong>
              </div>
            )}
          </div>

          {stage === "shape" && (
            <div className="control-panel shape-controls">
              <div className="control-row compact-row">
                <div className="preset-group" aria-label="坯型灵感">
                  <span className="micro-label">坯型灵感</span>
                  <div className="preset-buttons">
                    {PRESETS.map((preset) => (
                      <button
                        type="button"
                        className="chip-button"
                        onClick={() => applyPreset(preset.id)}
                        key={preset.id}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="history-actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={undoShape}
                    disabled={history.length === 0}
                    aria-label="撤销上一次塑形"
                  >
                    ↶
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={resetShape}
                    aria-label="重置陶坯"
                  >
                    ↺
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={() => setStage("glaze")}
              >
                <span>完成塑形</span>
                <span aria-hidden="true">去上釉&nbsp; →</span>
              </button>
            </div>
          )}

          {stage === "glaze" && (
            <div className="control-panel glaze-controls">
              <div className="glaze-heading">
                <span className="micro-label">釉色盘</span>
                <button type="button" className="text-button" onClick={dipWholePiece}>
                  整器浸釉
                </button>
              </div>
              <div className="glaze-palette" role="radiogroup" aria-label="选择釉色">
                {GLAZES.map((glaze) => {
                  const selected = glaze.key === selectedGlaze;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`glaze-choice ${selected ? "is-selected" : ""}`}
                      style={{
                        "--glaze": glaze.fired,
                        "--glaze-ring": glaze.ring,
                      } as CSSProperties}
                      onClick={() => setSelectedGlaze(glaze.key)}
                      key={glaze.key}
                    >
                      <span className="glaze-swatch">{selected ? "✓" : ""}</span>
                      <span>
                        <strong>{glaze.name}</strong>
                        <small>{glaze.note}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="coverage-row" aria-label={`上釉完成 ${Math.round(glazeCoverage * 100)}%`}>
                <span>上釉覆盖</span>
                <span className="coverage-track">
                  <span style={{ width: `${glazeCoverage * 100}%` }} />
                </span>
                <strong>{Math.round(glazeCoverage * 100)}%</strong>
              </div>
              <div className="dual-actions">
                <button type="button" className="secondary-button" onClick={() => setStage("shape")}>
                  上一步
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={enterFire}
                  disabled={glazedCount === 0}
                >
                  入窑烧制 <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          )}

          {stage === "fire" && (
            <div className="control-panel fire-controls">
              <div className="kiln-readout">
                <div>
                  <span>窑温</span>
                  <strong>{temperature.toLocaleString()}<small>°C</small></strong>
                </div>
                <div>
                  <span>火候</span>
                  <strong>{progressPercent}<small>%</small></strong>
                </div>
                <div className="fire-meter" aria-label={`烧制进度 ${progressPercent}%`}>
                  <span style={{ width: `${progressPercent}%` }} />
                </div>
              </div>

              {!cooling && (
                <>
                  <div className={`mic-card mic-${micStatus}`}>
                    <div className="mic-copy">
                      <span className="mic-icon" aria-hidden="true" />
                      <span>
                        <strong>
                          {micStatus === "ready"
                            ? "气息感应已开启"
                            : micStatus === "calibrating"
                              ? "感应环境气息…"
                              : micStatus === "requesting"
                                ? "正在连接麦克风…"
                                : micStatus === "denied" || micStatus === "unsupported"
                                  ? "麦克风暂不可用"
                                  : "用嘴吹旺窑火"}
                        </strong>
                        <small>
                          {micStatus === "ready"
                            ? `当前风力 ${Math.round(firePower * 100)}% · 声音不会被保存`
                            : micStatus === "calibrating"
                              ? "请保持安静一秒，随后开始吹气"
                              : micStatus === "denied" || micStatus === "unsupported"
                                ? "仍可按住下方按钮完成烧制"
                                : "声音只在本机分析，不录音、不上传"}
                        </small>
                      </span>
                    </div>
                    {(micStatus === "idle" || micStatus === "denied" || micStatus === "unsupported") && (
                      <button type="button" onClick={startMicrophone}>
                        {micStatus === "idle" ? "开启" : "重试"}
                      </button>
                    )}
                    {(micStatus === "requesting" || micStatus === "calibrating") && (
                      <span className="listening-dots" aria-hidden="true"><i /><i /><i /></span>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`breath-button ${manualActive ? "is-active" : ""}`}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      beginManualFire();
                    }}
                    onPointerUp={endManualFire}
                    onPointerCancel={endManualFire}
                    onLostPointerCapture={endManualFire}
                    onKeyDown={handleBreathKeyDown}
                    onKeyUp={handleBreathKeyUp}
                  >
                    <span className="breath-rings" aria-hidden="true"><i /><i /><i /></span>
                    <span>
                      <strong>{manualActive ? "火正旺" : "按住鼓风"}</strong>
                      <small>麦克风的触控备用方式</small>
                    </span>
                  </button>
                  {fireProgress === 0 && (
                    <button type="button" className="back-link" onClick={leaveFire}>
                      返回上釉
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {stage === "reveal" && (
            <div className="control-panel reveal-controls">
              <div className="result-stats">
                <div><span>主釉色</span><strong>{dominantGlaze.name}</strong></div>
                <div><span>烧成温度</span><strong>1,280°C</strong></div>
                <div><span>器物编号</span><strong>NHJ · 001</strong></div>
              </div>
              <div className="dual-actions result-actions">
                <button type="button" className="secondary-button" onClick={restart}>
                  再做一件
                </button>
                <button type="button" className="primary-button" onClick={savePiece}>
                  保存成品 <span aria-hidden="true">↓</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="sr-only" aria-live="polite">
          当前步骤：{copy.eyebrow}。{cooling ? "作品正在冷却。" : ""}
        </p>
      </section>
    </main>
  );
}
