"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Stage = "shape" | "fire" | "reveal";
type MicStatus =
  | "idle"
  | "requesting"
  | "calibrating"
  | "ready"
  | "denied"
  | "unsupported";

type PointerState = {
  down: boolean;
  mode: "shape" | null;
  x: number;
  y: number;
};

type AudioState = {
  context: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
  frame: number;
};

const CANVAS_WIDTH = 360;
const CANVAS_HEIGHT = 440;
const POT_CENTER = 180;
const POT_TOP = 58;
const POT_BOTTOM = 344;
const PROFILE_COUNT = 32;
const POT_VISUAL_SCALE = 1.32;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

function edgeNoise(index: number, salt: number) {
  const value =
    Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function buildPotPath(profile: number[]) {
  const samplesPerSegment = 4;
  const sampleCount = (profile.length - 1) * samplesPerSegment;
  const pointsForSide = (side: -1 | 1, salt: number) =>
    Array.from({ length: sampleCount + 1 }, (_, sample) => {
      const position = sample / samplesPerSegment;
      const index = Math.min(Math.floor(position), profile.length - 2);
      const progress = sample === sampleCount ? 1 : position - index;
      const radius =
        profile[index] + (profile[index + 1] - profile[index]) * progress;
      const y = POT_TOP + (sample / sampleCount) * (POT_BOTTOM - POT_TOP);
      return {
        x:
          POT_CENTER +
          side * (radius * POT_VISUAL_SCALE + edgeNoise(sample, salt) * 1.55),
        y: y + edgeNoise(sample, salt + 17) * 0.68,
      };
    });

  const left = pointsForSide(-1, 3);
  const right = pointsForSide(1, 9).reverse();
  const path = new Path2D();
  path.moveTo(left[0].x, left[0].y);
  [...left.slice(1), ...right].forEach((point) => path.lineTo(point.x, point.y));
  path.closePath();
  return path;
}

function drawPot(ctx: CanvasRenderingContext2D, profile: number[]) {
  const path = buildPotPath(profile);
  const paper = "#f8f8f4";
  ctx.fillStyle = paper;
  ctx.fill(path);

  ctx.strokeStyle = "rgba(255, 255, 255, .94)";
  ctx.lineWidth = 2.8;
  ctx.stroke(path);

  ctx.beginPath();
  ctx.ellipse(
    POT_CENTER,
    POT_TOP + 1,
    profile[0] * POT_VISUAL_SCALE,
    10.5,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = paper;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, .95)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(
    POT_CENTER,
    POT_TOP + 1,
    Math.max(12, profile[0] * POT_VISUAL_SCALE - 8),
    6.3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = "#050505";
  ctx.fill();
}

function drawFlames(
  ctx: CanvasRenderingContext2D,
  time: number,
  power: number,
  foreground: boolean,
) {
  const baseY = foreground ? 395 : 380;
  const count = foreground ? 5 : 4;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let index = 0; index < count; index += 1) {
    const center = 60 + index * (foreground ? 62 : 78) + (foreground ? 0 : 14);
    const sway = Math.sin(time * 0.004 + index * 1.7) * (4 + power * 8);
    const height =
      (foreground ? 28 : 42) +
      power * (foreground ? 150 : 180) +
      Math.sin(time * 0.006 + index) * 14;
    const width = foreground ? 32 : 42;
    const flame = ctx.createLinearGradient(0, baseY, 0, baseY - height);
    flame.addColorStop(0, foreground ? "rgba(255, 59, 18, .92)" : "rgba(255, 59, 18, .62)");
    flame.addColorStop(0.5, foreground ? "rgba(255, 149, 0, .96)" : "rgba(255, 116, 18, .72)");
    flame.addColorStop(1, "rgba(255, 244, 207, .06)");
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
  ctx.restore();
}

function drawKiln(
  ctx: CanvasRenderingContext2D,
  time: number,
  profile: number[],
  power: number,
) {
  const glow = ctx.createRadialGradient(
    POT_CENTER,
    245,
    20,
    POT_CENTER,
    245,
    225,
  );
  glow.addColorStop(0, `rgba(255, 95, 22, ${0.1 + power * 0.28})`);
  glow.addColorStop(0.48, "rgba(255, 59, 18, .06)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.beginPath();
  ctx.moveTo(34, 415);
  ctx.lineTo(34, 184);
  ctx.bezierCurveTo(34, 66, 92, 18, POT_CENTER, 18);
  ctx.bezierCurveTo(268, 18, 326, 66, 326, 184);
  ctx.lineTo(326, 415);
  ctx.closePath();
  ctx.fillStyle = "#050505";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, .62)";
  ctx.lineWidth = 2.4;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(57, 408);
  ctx.lineTo(57, 191);
  ctx.bezierCurveTo(57, 88, 105, 45, POT_CENTER, 45);
  ctx.bezierCurveTo(255, 45, 303, 88, 303, 191);
  ctx.lineTo(303, 408);
  ctx.closePath();
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, .15)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, .08)";
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
  drawPot(ctx, profile);
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
  pointer: PointerState,
) {
  ctx.save();
  ctx.setLineDash([3, 8]);
  ctx.strokeStyle = "rgba(255, 255, 255, .08)";
  ctx.beginPath();
  ctx.moveTo(POT_CENTER, 33);
  ctx.lineTo(POT_CENTER, POT_BOTTOM + 8);
  ctx.stroke();
  ctx.restore();

  drawPot(ctx, profile);

  if (pointer.down) {
    const radius = 14;
    const pulse = 2 + Math.sin(time * 0.01) * 2;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius + pulse, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, .88)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "#050505";
    ctx.fill();
  }
}

function drawReveal(
  ctx: CanvasRenderingContext2D,
  time: number,
  profile: number[],
) {
  const aura = ctx.createRadialGradient(
    POT_CENTER,
    210,
    35,
    POT_CENTER,
    210,
    205,
  );
  aura.addColorStop(0, "rgba(255, 255, 255, .1)");
  aura.addColorStop(0.56, "rgba(255, 255, 255, .025)");
  aura.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.save();
  ctx.translate(POT_CENTER, 204);
  ctx.rotate(time * 0.00003);
  ctx.strokeStyle = "rgba(255, 255, 255, .09)";
  for (let index = 0; index < 18; index += 1) {
    ctx.rotate((Math.PI * 2) / 18);
    ctx.beginPath();
    ctx.moveTo(126, 0);
    ctx.lineTo(174, 0);
    ctx.stroke();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.ellipse(POT_CENTER, 387, 110, 25, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#030303";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, .24)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  drawPot(ctx, profile);

  for (let index = 0; index < 9; index += 1) {
    const x = 38 + ((index * 83) % 290);
    const y = 55 + ((index * 47 + time * 0.006) % 265);
    ctx.beginPath();
    ctx.arc(x, y, index % 2 ? 1.2 : 1.7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, .2)";
    ctx.fill();
  }
}

const STAGE_COPY: Record<Stage, { eyebrow: string; title: string; description: string }> = {
  shape: {
    eyebrow: "STEP 01 · 塑形",
    title: "用手指，给泥土一个轮廓",
    description: "贴近器身左右推拉，收口或撑起器腹。",
  },
  fire: {
    eyebrow: "STEP 02 · 烧制",
    title: "吹气，让火变得更旺",
    description: "对着麦克风吹气；气息越强，窑火越高。",
  },
  reveal: {
    eyebrow: "FINISHED · 开窑",
    title: "你的陶器完成了",
    description: "泥、手指、火与气息，留下了独一无二的痕迹。",
  },
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>("shape");
  const [profile, setProfile] = useState<number[]>(() => [...INITIAL_PROFILE]);
  const [history, setHistory] = useState<number[][]>([]);
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [firePower, setFirePower] = useState(0);
  const [fireProgress, setFireProgress] = useState(0);
  const [manualActive, setManualActive] = useState(false);
  const [cooling, setCooling] = useState(false);

  const stageRef = useRef(stage);
  const profileRef = useRef(profile);
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
      context.fillStyle = "#000000";
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      if (stageRef.current === "fire") {
        drawKiln(
          context,
          time,
          profileRef.current,
          firePowerRef.current,
        );
      } else if (stageRef.current === "reveal") {
        drawReveal(context, time, profileRef.current);
      } else {
        drawStudio(
          context,
          time,
          profileRef.current,
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
    return (
      Math.abs(x - POT_CENTER) <=
      profileRef.current[index] * POT_VISUAL_SCALE + 22
    );
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
    if (stage !== "shape") return;
    const point = canvasPoint(event);
    if (!isInsidePot(point.x, point.y)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { down: true, mode: "shape", ...point };
    gestureRef.current = {
      lastX: point.x,
      side: point.x >= POT_CENTER ? 1 : -1,
      snapshot: [...profileRef.current],
      changed: false,
    };
  };

  const handleCanvasPointerMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (!pointerRef.current.down) return;
    const point = canvasPoint(event);
    pointerRef.current = { ...pointerRef.current, ...point };
    if (pointerRef.current.mode === "shape") shapeAtPoint(point.x, point.y);
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
    setStage("shape");
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
    profileRef.current = nextProfile;
    fireProgressRef.current = 0;
    firePowerRef.current = 0;
    micPowerRef.current = 0;
    manualPowerRef.current = 0;
    coolingRef.current = false;
    setProfile(nextProfile);
    setHistory([]);
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
    link.download = "泥火间-手塑陶器.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const temperature = Math.min(
    1280,
    Math.round(24 + 1210 * Math.pow(fireProgress, 0.72) + firePower * 46),
  );
  const progressPercent = Math.round(fireProgress * 100);
  const stepIndex = stage === "shape" ? 0 : 1;
  const copy = STAGE_COPY[stage];
  const canvasLabel =
    stage === "shape"
      ? "可触摸塑形的陶坯。沿器身左右拖动改变轮廓。"
      : stage === "fire"
        ? "窑火与陶器，火焰会随吹气强度变化。"
        : "已经烧制完成的陶艺作品。";

  return (
    <main className={`experience stage-${stage}`}>
      <section className="studio-shell" aria-label="泥火间陶艺工作室">
        <header className="topbar">
          <div className="brand-lockup">
            <strong className="poster-title">Pottery</strong>
          </div>
          <span className="piece-number" aria-label={`第 ${stepIndex + 1} 步`}>
            0{stepIndex + 1} / 02
          </span>
        </header>

        <nav className="process" aria-label="制作进度">
          {["塑形", "烧制"].map((label, index) => {
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
            <h1>{cooling ? "嘘，陶器正在冷却" : copy.title}</h1>
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
                onClick={enterFire}
                aria-label="完成塑形，入窑烧制"
              >
                <span className="action-word" aria-hidden="true">Finish</span>
                <small>完成塑形 · 入窑烧制</small>
              </button>
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
                      <strong className="action-word">{manualActive ? "Burn" : "Blow"}</strong>
                      <small>{manualActive ? "火正旺" : "按住鼓风 · 触控备用"}</small>
                    </span>
                  </button>
                  {fireProgress === 0 && (
                    <button type="button" className="back-link" onClick={leaveFire}>
                      返回塑形
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {stage === "reveal" && (
            <div className="control-panel reveal-controls">
              <div className="result-stats">
                <div><span>成型方式</span><strong>手指塑形</strong></div>
                <div><span>烧成温度</span><strong>1,280°C</strong></div>
                <div><span>器物编号</span><strong>NHJ · 001</strong></div>
              </div>
              <div className="dual-actions result-actions">
                <button type="button" className="secondary-button" onClick={restart}>
                  <span className="action-word">Again</span>
                  <small>再做一件</small>
                </button>
                <button type="button" className="primary-button" onClick={savePiece} aria-label="保存成品图片">
                  <span className="action-word" aria-hidden="true">Save</span>
                  <small>保存成品图片</small>
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
