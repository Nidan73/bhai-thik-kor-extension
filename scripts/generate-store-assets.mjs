import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const assetsDir = path.join(rootDir, "public", "store_assets");

if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// ─── 1. Screenshot 1 (1280x800): "Turn Rough Ideas into Expert Prompts" ────────
const ss1Svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800" width="1280" height="800">
  <defs>
    <linearGradient id="bg1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0c14" />
      <stop offset="50%" stop-color="#111422" />
      <stop offset="100%" stop-color="#07080d" />
    </linearGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="24" stdDeviation="30" flood-color="#000000" flood-opacity="0.8" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1280" height="800" fill="url(#bg1)" />

  <!-- Ambient Glows -->
  <circle cx="200" cy="200" r="300" fill="#059669" opacity="0.12" filter="blur(80px)" />
  <circle cx="1080" cy="600" r="350" fill="#E11D48" opacity="0.1" filter="blur(90px)" />

  <!-- Headline & Subtitle -->
  <g transform="translate(640, 110)" text-anchor="middle">
    <text font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, sans-serif" font-size="44" font-weight="800" fill="#FFFFFF" letter-spacing="-1">
      Turn Rough Ideas Into Expert AI Prompts
    </text>
    <text y="45" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, sans-serif" font-size="20" font-weight="400" fill="#94A3B8">
      One click to optimize prompts anywhere you type — with model recommendations
    </text>
  </g>

  <!-- Central Extension Popup Card Mockup -->
  <g transform="translate(420, 200)" filter="url(#cardShadow)">
    <!-- Container -->
    <rect width="440" height="540" rx="20" fill="#13151f" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />
    
    <!-- Popup Header -->
    <g transform="translate(24, 24)">
      <!-- Watermelon Icon -->
      <g transform="translate(0, 4) scale(0.65)">
        <path d="M 0 30 A 24 24 0 0 0 48 30 L 42 30 A 18 18 0 0 1 6 30 Z" fill="#007A3D" />
        <path d="M 6 30 A 18 18 0 0 0 42 30 Z" fill="#E4312B" />
        <circle cx="24" cy="38" r="1.5" fill="#000000" />
      </g>
      <text x="42" y="24" font-family="sans-serif" font-size="17" font-weight="700" fill="#FFFFFF">Bhai Thik Kor</text>
      
      <!-- Guide Me Pill -->
      <rect x="290" y="4" width="96" height="28" rx="8" fill="#1c1f2e" stroke="rgba(255,255,255,0.1)" />
      <text x="338" y="22" font-family="sans-serif" font-size="11" font-weight="600" fill="#94A3B8" text-anchor="middle">Guide Me</text>
    </g>

    <!-- Optimized Prompt Card -->
    <g transform="translate(24, 85)">
      <rect width="392" height="240" rx="12" fill="#1c1f2e" stroke="rgba(255,255,255,0.08)" />
      <text x="16" y="28" font-family="sans-serif" font-size="11" font-weight="700" fill="#34D399" text-transform="uppercase" letter-spacing="1">Optimized Prompt</text>
      
      <text x="16" y="58" font-family="sans-serif" font-size="12.5" font-weight="400" fill="#E2E8F0" width="360">
        <tspan x="16" dy="0">Act as a Senior Next.js Architect. Build a production-grade</tspan>
        <tspan x="16" dy="20">authentication workflow with JWT cookies, rate-limiting, and</tspan>
        <tspan x="16" dy="20">TypeScript strict mode.</tspan>
        <tspan x="16" dy="28" fill="#94A3B8">### Requirements:</tspan>
        <tspan x="16" dy="20" fill="#CBD5E1">1. Server Actions with Zod validation</tspan>
        <tspan x="16" dy="20" fill="#CBD5E1">2. Secure httpOnly SameSite cookie handling</tspan>
        <tspan x="16" dy="20" fill="#CBD5E1">3. Fully typed error states &amp; unit tests</tspan>
      </text>

      <!-- Action Buttons -->
      <g transform="translate(16, 195)">
        <rect width="70" height="28" rx="6" fill="#10B981" />
        <text x="35" y="18" font-family="sans-serif" font-size="11" font-weight="700" fill="#090a0f" text-anchor="middle">Copy</text>

        <rect x="80" width="80" height="28" rx="6" fill="#25293d" stroke="rgba(255,255,255,0.1)" />
        <text x="120" y="18" font-family="sans-serif" font-size="11" font-weight="600" fill="#FFFFFF" text-anchor="middle">Replace</text>

        <rect x="170" width="70" height="28" rx="6" fill="#25293d" stroke="rgba(255,255,255,0.1)" />
        <text x="205" y="18" font-family="sans-serif" font-size="11" font-weight="600" fill="#FFFFFF" text-anchor="middle">Insert</text>
      </g>
    </g>

    <!-- Model Recommendations Section -->
    <g transform="translate(24, 345)">
      <text x="0" y="16" font-family="sans-serif" font-size="11" font-weight="700" fill="#94A3B8" text-transform="uppercase" letter-spacing="0.5">Recommended Models</text>

      <!-- Model Card 1 -->
      <g transform="translate(0, 26)">
        <rect width="392" height="38" rx="8" fill="#181a27" stroke="rgba(255,255,255,0.06)" />
        <circle cx="20" cy="19" r="4" fill="#10B981" />
        <text x="34" y="23" font-family="sans-serif" font-size="11.5" font-weight="600" fill="#FFFFFF">Free Tier · Groq Llama 3.3 70B</text>
        <text x="375" y="23" font-family="sans-serif" font-size="10.5" font-weight="600" fill="#34D399" text-anchor="end">Fastest (~800 t/s)</text>
      </g>

      <!-- Model Card 2 -->
      <g transform="translate(0, 70)">
        <rect width="392" height="38" rx="8" fill="#181a27" stroke="rgba(255,255,255,0.06)" />
        <circle cx="20" cy="19" r="4" fill="#38BDF8" />
        <text x="34" y="23" font-family="sans-serif" font-size="11.5" font-weight="600" fill="#FFFFFF">Freemium · Claude 3.5 Sonnet</text>
        <text x="375" y="23" font-family="sans-serif" font-size="10.5" font-weight="600" fill="#38BDF8" text-anchor="end">Best for Code</text>
      </g>

      <!-- Model Card 3 -->
      <g transform="translate(0, 114)">
        <rect width="392" height="38" rx="8" fill="#181a27" stroke="rgba(255,255,255,0.06)" />
        <circle cx="20" cy="19" r="4" fill="#FBBF24" />
        <text x="34" y="23" font-family="sans-serif" font-size="11.5" font-weight="600" fill="#FFFFFF">Deep Reasoning · OpenAI o3-mini</text>
        <text x="375" y="23" font-family="sans-serif" font-size="10.5" font-weight="600" fill="#FBBF24" text-anchor="end">Complex Logic</text>
      </g>
    </g>
  </g>
</svg>`;

// ─── 2. Small Promo Tile (440x280): High-Impact Web Store Banner ───────────────
const promoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 280" width="440" height="280">
  <defs>
    <linearGradient id="promoBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090a10" />
      <stop offset="50%" stop-color="#121524" />
      <stop offset="100%" stop-color="#06070a" />
    </linearGradient>
    <filter id="pGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#007A3D" flood-opacity="0.35" />
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#E4312B" flood-opacity="0.4" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="440" height="280" fill="url(#promoBg)" />

  <!-- Ambient Light -->
  <circle cx="220" cy="100" r="140" fill="#E4312B" opacity="0.15" filter="blur(50px)" />
  <circle cx="220" cy="180" r="140" fill="#007A3D" opacity="0.15" filter="blur(50px)" />

  <!-- Watermelon Crescent Icon (Centered above text) -->
  <g transform="translate(220, 85) scale(0.48) translate(-256, -256)" filter="url(#pGlow)">
    <path d="M 64 256 A 192 192 0 0 0 448 256 L 404 256 A 148 148 0 0 1 108 256 Z" fill="#007A3D" />
    <path d="M 108 256 A 148 148 0 0 0 404 256 L 382 256 A 126 126 0 0 1 130 256 Z" fill="#FFFFFF" />
    <path d="M 130 256 A 126 126 0 0 0 382 256 Z" fill="#E4312B" />
    <circle cx="210" cy="300" r="11" fill="#000000" />
    <circle cx="256" cy="324" r="11" fill="#000000" />
    <circle cx="302" cy="300" r="11" fill="#000000" />
  </g>

  <!-- Title & Tagline -->
  <text x="220" y="195" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, sans-serif" font-size="26" font-weight="800" fill="#FFFFFF" text-anchor="middle" letter-spacing="-0.5">
    Bhai Thik Kor
  </text>
  <text x="220" y="228" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, sans-serif" font-size="13" font-weight="500" fill="#34D399" text-anchor="middle" letter-spacing="0.2">
    Better AI Prompts — Wherever You Write
  </text>
</svg>`;

// Write SVGs and Render PNGs without alpha
const ss1SvgPath = path.join(assetsDir, "screenshot-1.svg");
const ss1PngPath = path.join(assetsDir, "screenshot-1.png");
fs.writeFileSync(ss1SvgPath, ss1Svg);
execSync(`rsvg-convert -w 1280 -h 800 "${ss1SvgPath}" -o "${ss1PngPath}"`);
execSync(`convert "${ss1PngPath}" -background "#0a0c14" -flatten -alpha off "${ss1PngPath}"`);

const promoSvgPath = path.join(assetsDir, "promo-small.svg");
const promoPngPath = path.join(assetsDir, "promo-small.png");
fs.writeFileSync(promoSvgPath, promoSvg);
execSync(`rsvg-convert -w 440 -h 280 "${promoSvgPath}" -o "${promoPngPath}"`);
execSync(`convert "${promoPngPath}" -background "#090a10" -flatten -alpha off "${promoPngPath}"`);

console.log("Successfully generated Chrome Web Store graphic assets!");
