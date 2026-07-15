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

function makeInitialProfile() {
  return Array.from({ length: PROFILE_COUNT }, (_, index) => {
    const t = index / (PROFILE_COUNT - 1);
    return (
      48 +
      55 * Math.exp(-Math.pow((t - 0.5) / 0.3, 2)) -
      12 * Math.exp(-Math.pow((t - 0.08) / 0.12, 2)) -
      12 * Math.exp(-Math.pow((t - 0.9) / 0.12, 2)) +
      17 * t
    );
  });
}

const INITIAL_PROFILE = makeInitialProfile();

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
  const rimRadius = profile[0] * POT_VISUAL_SCALE;
  const rimHeight = clamp(rimRadius * 0.18, 3, 10.5);
  ctx.fillStyle = paper;
  ctx.fill(path);

  ctx.strokeStyle = "rgba(255, 255, 255, .94)";
  ctx.lineWidth = 2.8;
  ctx.stroke(path);

  ctx.beginPath();
  ctx.ellipse(
    POT_CENTER,
    POT_TOP + 1,
    rimRadius,
    rimHeight,
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
    Math.max(2.5, rimRadius * 0.82),
    clamp(rimRadius * 0.11, 1.8, 6.3),
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
  ctx.strokeStyle = "rgba(255, 255, 255, .52)";
  ctx.lineWidth = 2.4;
  ctx.stroke();

  drawFlames(ctx, time, power, false);
  drawPot(ctx, profile);
  drawFlames(ctx, time + 190, power, true);
}

function drawStudio(
  ctx: CanvasRenderingContext2D,
  time: number,
  profile: number[],
  pointer: PointerState,
) {
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

function drawReveal(ctx: CanvasRenderingContext2D, profile: number[]) {
  drawPot(ctx, profile);
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>("shape");
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [fireProgress, setFireProgress] = useState(0);
  const [manualActive, setManualActive] = useState(false);
  const [cooling, setCooling] = useState(false);

  const stageRef = useRef(stage);
  const profileRef = useRef<number[]>([...INITIAL_PROFILE]);
  const pointerRef = useRef<PointerState>({
    down: false,
    mode: null,
    x: POT_CENTER,
    y: 210,
  });
  const gestureRef = useRef<{
    lastX: number;
    side: 1 | -1;
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
        drawReveal(context, profileRef.current);
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
      const minimum = index < 4 ? 8 : 10;
      const maximum = index < 4 ? 98 : 126;
      return clamp(radius + delta * 0.72 * influence * baseLock, minimum, maximum);
    });
    const smoothed = [...next];
    for (let index = 1; index < PROFILE_COUNT - 3; index += 1) {
      smoothed[index] =
        next[index] * 0.72 + next[index - 1] * 0.14 + next[index + 1] * 0.14;
    }
    profileRef.current = smoothed;
  };

  const finishCanvasGesture = () => {
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

  const enterFire = () => {
    firePowerRef.current = 0;
    fireProgressRef.current = 0;
    micPowerRef.current = 0;
    manualPowerRef.current = 0;
    coolingRef.current = false;
    setFireProgress(0);
    setCooling(false);
    setMicStatus("idle");
    stageRef.current = "fire";
    setStage("fire");
    void startMicrophone();
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
    setMicStatus("idle");
    setFireProgress(0);
    setManualActive(false);
    setCooling(false);
    stageRef.current = "shape";
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

  const progressPercent = Math.round(fireProgress * 100);
  const canvasLabel =
    stage === "shape"
      ? "可触摸塑形的陶坯。沿器身左右拖动改变轮廓。"
      : stage === "fire"
        ? "窑火与陶器，火焰会随吹气强度变化。"
        : "已经烧制完成的陶艺作品。";
  const microphoneAnnouncement =
    micStatus === "ready"
      ? "麦克风已就绪，可以吹气；也可以按住按钮烧制。"
      : micStatus === "calibrating"
        ? "正在校准麦克风，请保持安静片刻。"
      : micStatus === "denied" || micStatus === "unsupported"
          ? "麦克风不可用，请按住按钮烧制。"
          : "正在开启麦克风。";
  const stageAnnouncement =
    stage === "shape"
      ? "塑形。左右拖动陶器轮廓。"
      : stage === "fire"
        ? cooling
          ? "烧制完成，陶器正在冷却。"
          : `烧制。${microphoneAnnouncement}`
        : "陶器已经完成。";

  return (
    <main className={`experience stage-${stage}`}>
      <section className="studio-shell" aria-label="泥火间陶艺工作室">
        <header className="topbar">
          <h1 className="poster-title">Pottery</h1>
        </header>

        <div className="stage-body">
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
            {cooling && (
              <div className="cooling-veil" role="status">
                <span>Cooling</span>
              </div>
            )}
          </div>

          {stage === "shape" && (
            <div className="control-panel">
              <button
                type="button"
                className="primary-button"
                onClick={enterFire}
                aria-label="完成塑形，入窑烧制"
              >
                <span className="action-word" aria-hidden="true">Finish</span>
              </button>
            </div>
          )}

          {stage === "fire" && (
            <div className="control-panel fire-controls">
              {!cooling && (
                <>
                  <div
                    className="fire-meter"
                    role="progressbar"
                    aria-label="烧制进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPercent}
                  >
                    <span style={{ width: `${progressPercent}%` }} />
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
                    aria-label="吹气或按住按钮烧制陶器"
                  >
                    <span className="action-word" aria-hidden="true">Blow</span>
                  </button>
                </>
              )}
            </div>
          )}

          {stage === "reveal" && (
            <div className="control-panel reveal-controls">
              <button type="button" className="primary-button" onClick={savePiece} aria-label="保存成品图片">
                <span className="action-word" aria-hidden="true">Save</span>
              </button>
              <button type="button" className="quiet-button" onClick={restart}>
                Again
              </button>
            </div>
          )}
        </div>

        <p className="sr-only" aria-live="polite">
          {stageAnnouncement}
        </p>
      </section>
    </main>
  );
}
