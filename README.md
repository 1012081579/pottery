# Clay & Fire

A mobile-first, immersive digital pottery simulator. Shape the clay directly with touch, add expressive black brush marks, then blow into the microphone to intensify the kiln and finish a unique piece.

## Experience

1. **Shape**: Drag the vessel's sides to sculpt its rim, shoulders, and body.
2. **Write**: Draw directly on the clay with your finger to create black, ink-like brush marks.
3. **Fire**: Blow into the microphone to raise the flames. If microphone access is unavailable, press and hold the Blow button.
4. **Reveal**: Rotate the finished 3D piece and save it as a PNG.

Microphone input is used only in the browser to measure volume. Audio is never recorded or uploaded. Microphone access requires `localhost` or HTTPS.

## Local development

Node.js `>=22.13.0` is required.

```bash
npm install
npm run dev
```

Common validation commands:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build:vercel
```

The project uses Next.js App Router, React, TypeScript, Tailwind CSS, Canvas, and Three.js. The default build keeps the vinext output required by Sites, while `build:vercel` produces the standard Next.js output required by Vercel.
