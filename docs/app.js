"use strict";

const DEFAULT_NAME_SLOT = "sjr-                ";
const NAME_SLOT_BYTES = 20;
const REQUIRED_PREFIX = "sjr-";

const VARIANTS = {
  microbit: {
    baseHexUrl: "./firmware/scratchjr-microbit-base.hex",
    filePrefix: "scratchjr-microbit",
  },
  mbkit: {
    baseHexUrl: "./firmware/scratchjr-mbkit-base.hex",
    filePrefix: "scratchjr-mbkit",
  },
};

/* mb-kit config block: keep in sync with mbkit_config_block.h / MBKIT-GUIDE §6.1 */
const MBKIT_MAGIC = "SJRMBK01";
const MBKIT_BLOCK_SIZE = 32;
const MBKIT_LAYOUT_VERSION = 1;

const form = document.getElementById("firmware-form");
const nameInput = document.getElementById("bluetooth-name");
const statusEl = document.getElementById("status");
const downloadButton = document.getElementById("download-button");
const mbkitPanel = document.getElementById("mbkit-panel");
const variantRadios = Array.from(document.querySelectorAll('input[name="variant"]'));

/* ── i18n (EN / ES) ───────────────────────────────────────── */

const STRINGS = {
  en: {
    brandSub: "Download &amp; configure",
    themeDark: "Dark", themeLight: "Light",
    title: "Download firmware",
    intro: "Pick your board, set its Bluetooth name and tune the kit. Everything is patched locally in your browser — nothing is uploaded.",
    board: "Board",
    microbitDesc: "Built-in sensors and LED matrix.",
    mbkitDesc: "External IIC modules, configurable sensors.",
    btName: "Bluetooth name",
    btHint: 'Up to 16 ASCII characters. The <code>sjr-</code> prefix stays embedded in the advertised name but is hidden on the device.',
    presets: "Quick presets",
    presetClassroom: "Classroom", presetHome: "Home", presetReset: "↺ Reset to defaults",
    grpSensors: "Sensors", grpSensorsSub: "wait thresholds · I2C 0x10–0x23",
    pNear: "“Near” distance", pWet: "Moisture threshold",
    pSoil: "Higher reading = wetter", pSoilSub: "Flip this if the sensor reads inverted.",
    pLight: "Light threshold",
    grpMotors: "Motors", grpMotorsSub: "movement &amp; speed · I2C 0x25",
    pMotor: "Motor speed",
    pWaitUnit: 'Time unit <span class="sub">· movement/display</span>',
    advCal: "Advanced motor calibration",
    pSwap: "Swap motors (left/right)", pSwapSub: "If turns come out mirrored.",
    pInv0: "Invert motor 0", pInv1: "Invert motor 1",
    grpRings: "LED rings", grpRingsSub: "brightness &amp; rainbow · I2C 0x24/0x26",
    pBright: "Ring brightness", pRainbow: "Rainbow speed",
    blockTitle: "Configuration block written to the device",
    download: "Download .hex",
    statusReady: "Ready to generate firmware.",
    howTitle: "How to use",
    how1: "Choose your board and enter the Bluetooth name you want to see when scanning.",
    how2: "Tune the mb-kit settings if you are using that board (optional).",
    how3: "Download the <code>.hex</code> file, connect the board via USB and copy the file onto it.",
    /* dynamic */
    preparing: "Preparing firmware…",
    generated: (f) => `Firmware generated: ${f}`,
    presetApplied: (n) => `Preset “${n}” applied.`,
    defaultsRestored: "Defaults restored.",
    downloadFail: "Could not generate the firmware.",
  },
  es: {
    brandSub: "Descargar y configurar",
    themeDark: "Oscuro", themeLight: "Claro",
    title: "Descargá el firmware",
    intro: "Elegí la placa, ponele nombre Bluetooth y ajustá el kit. Todo se parchea localmente en tu navegador — no se sube nada.",
    board: "Placa",
    microbitDesc: "Sensores y matriz LED integrados.",
    mbkitDesc: "Módulos IIC externos, sensores configurables.",
    btName: "Nombre Bluetooth",
    btHint: 'Hasta 16 caracteres ASCII. El prefijo <code>sjr-</code> queda embebido en el nombre anunciado pero no se muestra en la placa.',
    presets: "Ajustes rápidos",
    presetClassroom: "Aula", presetHome: "Casa", presetReset: "↺ Restaurar valores",
    grpSensors: "Sensores", grpSensorsSub: "umbrales de espera · I2C 0x10–0x23",
    pNear: "Distancia «cerca»", pWet: "Umbral de humedad",
    pSoil: "Lectura alta = más húmedo", pSoilSub: "Invertí esto si el sensor mide al revés.",
    pLight: "Umbral de luz",
    grpMotors: "Motores", grpMotorsSub: "movimiento y velocidad · I2C 0x25",
    pMotor: "Velocidad del motor",
    pWaitUnit: 'Unidad de tiempo <span class="sub">· movimiento/display</span>',
    advCal: "Calibración avanzada de motor",
    pSwap: "Intercambiar motores (izq./der.)", pSwapSub: "Si los giros salen espejados.",
    pInv0: "Invertir motor 0", pInv1: "Invertir motor 1",
    grpRings: "Anillos LED", grpRingsSub: "brillo y arcoíris · I2C 0x24/0x26",
    pBright: "Brillo del anillo", pRainbow: "Velocidad del arcoíris",
    blockTitle: "Bloque de configuración que se escribe",
    download: "Descargar .hex",
    statusReady: "Listo para generar el firmware.",
    howTitle: "Cómo usar",
    how1: "Elegí la placa y el nombre Bluetooth que querés ver al escanear.",
    how2: "Ajustá los parámetros del mb-kit si usás esa placa (opcional).",
    how3: "Descargá el <code>.hex</code>, conectá la placa por USB y copiá el archivo en ella.",
    /* dynamic */
    preparing: "Preparando firmware…",
    generated: (f) => `Firmware generado: ${f}`,
    presetApplied: (n) => `Preset «${n}» aplicado.`,
    defaultsRestored: "Valores por defecto restaurados.",
    downloadFail: "No se pudo generar el firmware.",
  },
};

let lang = (() => {
  try { const s = localStorage.getItem("sjr-lang"); if (s === "en" || s === "es") return s; } catch (e) {}
  return "en"; /* default English; a saved choice (incl. ES) still wins */
})();
const t = (key) => STRINGS[lang][key];

function applyLang(next) {
  lang = next;
  try { localStorage.setItem("sjr-lang", lang); } catch (e) {}
  document.documentElement.setAttribute("lang", lang);
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const val = STRINGS[lang][el.dataset.i18n];
    if (typeof val === "string") el.innerHTML = val;
  });
  document.getElementById("lang-text").textContent = lang === "en" ? "ES" : "EN";
  updateThemeLabel();
  renderAllDerived();
}

/* ── theme ────────────────────────────────────────────────── */

const root = document.documentElement;
function isDark() {
  const a = root.getAttribute("data-theme");
  if (a === "dark") return true;
  if (a === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}
function updateThemeLabel() {
  document.getElementById("theme-icon").textContent = isDark() ? "☀" : "☾";
  document.getElementById("theme-text").textContent = isDark() ? t("themeLight") : t("themeDark");
}
document.getElementById("theme-button").addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("sjr-theme", next); } catch (e) {}
  updateThemeLabel();
});
document.getElementById("lang-button").addEventListener("click", () => applyLang(lang === "en" ? "es" : "en"));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateThemeLabel);

/* ── status ───────────────────────────────────────────────── */

function setStatus(message, type = "") {
  statusEl.removeAttribute("data-i18n"); /* stop applyLang from overwriting a live message */
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : "status";
}

/* ── Intel HEX parsing / patching (unchanged core logic) ──── */

function parseHexByte(text, offset) {
  const value = Number.parseInt(text.slice(offset, offset + 2), 16);
  if (!Number.isFinite(value) || value < 0 || value > 255) {
    throw new Error(`Invalid HEX near position ${offset}.`);
  }
  return value;
}

function checksum(bytes) {
  const sum = bytes.reduce((acc, value) => (acc + value) & 0xff, 0);
  return ((~sum + 1) & 0xff);
}

function parseIntelHexLine(line, index) {
  if (!line.startsWith(":")) {
    throw new Error(`Line ${index + 1}: missing leading ':'.`);
  }

  const byteCount = parseHexByte(line, 1);
  const address = (parseHexByte(line, 3) << 8) | parseHexByte(line, 5);
  const type = parseHexByte(line, 7);
  const expectedLength = 11 + byteCount * 2;
  if (line.length !== expectedLength) {
    throw new Error(`Line ${index + 1}: unexpected Intel HEX length.`);
  }

  const data = [];
  for (let i = 0; i < byteCount; i += 1) {
    data.push(parseHexByte(line, 9 + i * 2));
  }
  const actualChecksum = parseHexByte(line, 9 + byteCount * 2);
  const bytesForChecksum = [
    byteCount,
    (address >> 8) & 0xff,
    address & 0xff,
    type,
    ...data,
  ];
  const expectedChecksum = checksum(bytesForChecksum);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Line ${index + 1}: invalid checksum.`);
  }

  return { byteCount, address, type, data, raw: line };
}

function formatIntelHexLine(record) {
  const bytes = [
    record.data.length,
    (record.address >> 8) & 0xff,
    record.address & 0xff,
    record.type,
    ...record.data,
  ];
  const allBytes = [...bytes, checksum(bytes)];
  return `:${allBytes.map((value) => value.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

function parseIntelHex(hexText) {
  const lines = hexText.trim().split(/\r?\n/);
  const records = lines.map((line, index) => parseIntelHexLine(line.trim(), index));
  const memory = new Map();
  let upperLinearAddress = 0;
  let upperSegmentAddress = 0;

  for (const record of records) {
    if (record.type === 0x00) {
      const base = upperLinearAddress + upperSegmentAddress + record.address;
      record.absoluteBase = base;
      for (let i = 0; i < record.data.length; i += 1) {
        memory.set(base + i, record.data[i]);
      }
    } else if (record.type === 0x02) {
      upperSegmentAddress = (((record.data[0] << 8) | record.data[1]) << 4) >>> 0;
      upperLinearAddress = 0;
    } else if (record.type === 0x04) {
      upperLinearAddress = (((record.data[0] << 8) | record.data[1]) << 16) >>> 0;
      upperSegmentAddress = 0;
    }
  }

  return { records, memory };
}

function serializeRecords(records) {
  return records.map((record) => record.raw).join("\n") + "\n";
}

function asciiBytes(text) {
  return Array.from(text, (char) => {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) {
      throw new Error("The name must use only printable ASCII characters.");
    }
    return code;
  });
}

function fixedNameBytes(name) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Enter a Bluetooth name.");
  }
  if (!trimmedName.startsWith(REQUIRED_PREFIX)) {
    throw new Error(`The name must start with "${REQUIRED_PREFIX}".`);
  }

  const bytes = asciiBytes(trimmedName);
  if (bytes.length > NAME_SLOT_BYTES) {
    throw new Error(`The name cannot exceed ${NAME_SLOT_BYTES} characters.`);
  }
  while (bytes.length < NAME_SLOT_BYTES) {
    bytes.push(0x20);
  }
  return bytes;
}

function findByteSequence(memory, sequence) {
  const starts = [];
  const addresses = Array.from(memory.keys()).sort((a, b) => a - b);

  for (const address of addresses) {
    let matches = true;
    for (let i = 0; i < sequence.length; i += 1) {
      if (memory.get(address + i) !== sequence[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      starts.push(address);
    }
  }

  return starts;
}

function patchRecords(records, startAddress, replacementBytes) {
  let patchedCount = 0;
  const patchMap = new Map();
  replacementBytes.forEach((value, index) => patchMap.set(startAddress + index, value));

  for (const record of records) {
    if (record.type !== 0x00 || typeof record.absoluteBase !== "number") {
      continue;
    }

    let changed = false;
    for (let i = 0; i < record.data.length; i += 1) {
      const absoluteAddress = record.absoluteBase + i;
      if (patchMap.has(absoluteAddress)) {
        record.data[i] = patchMap.get(absoluteAddress);
        patchedCount += 1;
        changed = true;
      }
    }
    if (changed) {
      record.raw = formatIntelHexLine(record);
    }
  }

  if (patchedCount !== replacementBytes.length) {
    throw new Error("Could not patch all target bytes (block may span a record boundary gap).");
  }
}

function patchBluetoothName(records, memory, bluetoothName) {
  const marker = asciiBytes(DEFAULT_NAME_SLOT);
  const matches = findByteSequence(memory, marker);
  if (matches.length !== 1) {
    throw new Error(`Expected to find 1 name slot, found: ${matches.length}.`);
  }
  patchRecords(records, matches[0], fixedNameBytes(bluetoothName));
}

/* ── mb-kit config block ──────────────────────────────────── */

function crc32Ieee(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16le(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function writeU32le(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function readNumberField(id, label, min, max) {
  const el = document.getElementById(id);
  const value = Number.parseInt(el.value, 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`"${label}" must be an integer between ${min} and ${max}.`);
  }
  return value;
}

/* Motor speed is entered as 0–100 % and mapped onto the PWM byte (0–255).
 * Clamped to a minimum of 1 so the field never writes 0, which the firmware
 * would read as "use the compile-time default". */
function motorPwmFromPercent() {
  const pct = readNumberField("motor_speed_pct", "Motor speed", 0, 100);
  return Math.max(1, Math.round((pct / 100) * 255));
}

function readMbkitConfig() {
  return {
    near_threshold_mm: readNumberField("near_threshold_mm", "Near threshold", 0, 65535),
    light_threshold: readNumberField("light_threshold", "Light threshold", 0, 65535),
    wet_threshold: readNumberField("wet_threshold", "Wet threshold", 0, 255),
    ring_brightness: readNumberField("ring_brightness", "Ring brightness", 0, 255),
    rainbow_step_ms: readNumberField("rainbow_step_ms", "Rainbow speed", 1, 65535),
    soil_high_is_wet: document.getElementById("soil_high_is_wet").checked ? 1 : 0,
    motor_swap: document.getElementById("motor_swap").checked ? 1 : 0,
    motor0_invert: document.getElementById("motor0_invert").checked ? 1 : 0,
    motor1_invert: document.getElementById("motor1_invert").checked ? 1 : 0,
    motor_default_speed: motorPwmFromPercent(),
    wait_unit_ms: readNumberField("wait_unit_ms", "Time unit", 1, 65535),
  };
}

function buildMbkitConfigBlock(cfg) {
  const bytes = new Array(MBKIT_BLOCK_SIZE).fill(0);
  asciiBytes(MBKIT_MAGIC).forEach((value, index) => {
    bytes[index] = value;
  });
  bytes[8] = 1; /* patched */
  bytes[9] = MBKIT_LAYOUT_VERSION;
  writeU16le(bytes, 10, cfg.near_threshold_mm);
  writeU16le(bytes, 12, cfg.light_threshold);
  bytes[14] = cfg.wet_threshold & 0xff;
  bytes[15] = cfg.soil_high_is_wet;
  bytes[16] = cfg.ring_brightness & 0xff;
  writeU16le(bytes, 17, cfg.rainbow_step_ms);
  bytes[19] = cfg.motor_swap;
  bytes[20] = cfg.motor0_invert;
  bytes[21] = cfg.motor1_invert;
  bytes[22] = cfg.motor_default_speed & 0xff;
  writeU16le(bytes, 23, cfg.wait_unit_ms);
  /* bytes[25..27] reserved, already zero */
  writeU32le(bytes, 28, crc32Ieee(bytes.slice(0, 28)));
  return bytes;
}

function patchMbkitConfig(records, memory, cfg) {
  const matches = findByteSequence(memory, asciiBytes(MBKIT_MAGIC));
  if (matches.length !== 1) {
    throw new Error(`Expected to find 1 mb-kit config block, found: ${matches.length}.`);
  }
  patchRecords(records, matches[0], buildMbkitConfigBlock(cfg));
}

/* Re-parse the generated hex to confirm the patches landed correctly. */
function verifyPatchedHex(hexText, variant, bluetoothName) {
  const parsed = parseIntelHex(hexText);

  const nameMatches = findByteSequence(parsed.memory, fixedNameBytes(bluetoothName));
  if (nameMatches.length < 1) {
    throw new Error("Verification failed: patched name not found.");
  }

  if (variant !== "mbkit") {
    return;
  }

  const magicMatches = findByteSequence(parsed.memory, asciiBytes(MBKIT_MAGIC));
  if (magicMatches.length !== 1) {
    throw new Error("Verification failed: config block not found.");
  }

  const start = magicMatches[0];
  const block = [];
  for (let i = 0; i < MBKIT_BLOCK_SIZE; i += 1) {
    block.push(parsed.memory.get(start + i));
  }
  if (block.some((value) => value === undefined)) {
    throw new Error("Verification failed: incomplete config block.");
  }
  if (block[8] !== 1) {
    throw new Error("Verification failed: config not marked as patched.");
  }
  const storedCrc =
    (block[28] | (block[29] << 8) | (block[30] << 16) | (block[31] << 24)) >>> 0;
  if (crc32Ieee(block.slice(0, 28)) !== storedCrc) {
    throw new Error("Verification failed: config CRC mismatch.");
  }
}

/* ── UI: sliders, derived values, presets, live block ─────── */

const SLIDER_IDS = ["near_threshold_mm", "wet_threshold", "motor_speed_pct", "wait_unit_ms", "ring_brightness", "rainbow_step_ms"];
const NUMERIC_IDS = SLIDER_IDS.concat("light_threshold");
const numVal = (id) => Number.parseInt(document.getElementById(id).value, 10) || 0;

/* palette matching the firmware RING_PALETTE_RGB (rainbow = first 7) */
const RAINBOW = [[255,0,0],[255,128,0],[255,255,0],[0,255,0],[0,255,255],[0,0,255],[128,0,255]];

function derivedHTML(id) {
  const v = numVal(id);
  const es = lang === "es";
  switch (id) {
    case "near_threshold_mm": {
      const cm = (v / 10).toFixed(v < 100 ? 1 : 0);
      return es
        ? `<span class="em">≈ ${cm} cm</span> <span class="note">— dispara cuando algo está más cerca</span>`
        : `<span class="em">≈ ${cm} cm</span> <span class="note">— triggers when something is closer</span>`;
    }
    case "wet_threshold":
      return es
        ? `<span class="note">dispara con humedad</span> <span class="em">≥ ${v}</span>`
        : `<span class="note">triggers at moisture</span> <span class="em">≥ ${v}</span>`;
    case "light_threshold":
      return es
        ? `<span class="note">cuenta cruda 0–65535 · sin referencia de vendor,</span> <span class="em">calibrá con el sensor real</span>`
        : `<span class="note">raw count 0–65535 · no vendor reference,</span> <span class="em">calibrate with the real sensor</span>`;
    case "motor_speed_pct": {
      const pwm = Math.max(1, Math.round((v / 100) * 255));
      return es
        ? `<span class="note">PWM que se escribe:</span> <span class="em">${pwm} / 255</span>`
        : `<span class="note">PWM written:</span> <span class="em">${pwm} / 255</span>`;
    }
    case "wait_unit_ms":
      return es
        ? `<span class="note">Forward 1 =</span> <span class="em">${v} ms</span> <span class="note">· el bloque Esperar usa 1 s fijo (no depende de esto)</span>`
        : `<span class="note">Forward 1 =</span> <span class="em">${v} ms</span> <span class="note">· the Wait block uses a fixed 1 s (independent of this)</span>`;
    case "ring_brightness": {
      const pct = Math.round((v / 255) * 100);
      const dots = RAINBOW.map(([r, g, b]) =>
        `<i style="background:rgb(${Math.round(r*v/255)},${Math.round(g*v/255)},${Math.round(b*v/255)})"></i>`).join("");
      return `<span class="ringdots" aria-hidden="true">${dots}</span> <span class="em">${pct}%</span>`;
    }
    case "rainbow_step_ms":
      return es
        ? `<span class="note">vuelta completa</span> <span class="em">≈ ${(7*v/1000).toFixed(1)} s</span> <span class="note">(7 posiciones)</span>`
        : `<span class="note">full lap</span> <span class="em">≈ ${(7*v/1000).toFixed(1)} s</span> <span class="note">(7 positions)</span>`;
    default:
      return "";
  }
}

function renderDerived(id) {
  const el = document.querySelector(`[data-derive-for="${id}"]`);
  if (el) el.innerHTML = derivedHTML(id);
}
function renderAllDerived() { NUMERIC_IDS.forEach(renderDerived); }

SLIDER_IDS.forEach((id) => {
  const num = document.getElementById(id);
  const sld = document.querySelector(`[data-for="${id}"]`);
  sld.addEventListener("input", () => { num.value = sld.value; renderDerived(id); renderBlock(); });
  num.addEventListener("input", () => { renderDerived(id); renderBlock(); });
  num.addEventListener("change", () => {
    let v = Number.parseInt(num.value, 10);
    if (!Number.isFinite(v)) v = Number.parseInt(sld.value, 10);
    v = Math.min(+num.max, Math.max(+num.min, v));
    num.value = v;
    sld.value = Math.min(+sld.max, Math.max(+sld.min, v));
    renderDerived(id); renderBlock();
  });
});
document.getElementById("light_threshold").addEventListener("input", () => { renderDerived("light_threshold"); renderBlock(); });
document.querySelectorAll(".switch input").forEach((tgl) => tgl.addEventListener("change", renderBlock));

/* Presets — illustrative bundles */
const PRESETS = {
  default:   { near_threshold_mm:200, wet_threshold:128, soil_high_is_wet:1, light_threshold:500, motor_speed_pct:40, wait_unit_ms:500, motor_swap:0, motor0_invert:0, motor1_invert:0, ring_brightness:128, rainbow_step_ms:400 },
  classroom: { near_threshold_mm:250, wet_threshold:120, soil_high_is_wet:1, light_threshold:800, motor_speed_pct:55, wait_unit_ms:450, motor_swap:0, motor0_invert:0, motor1_invert:0, ring_brightness:205, rainbow_step_ms:300 },
  home:      { near_threshold_mm:180, wet_threshold:135, soil_high_is_wet:1, light_threshold:350, motor_speed_pct:45, wait_unit_ms:600, motor_swap:0, motor0_invert:0, motor1_invert:0, ring_brightness:95,  rainbow_step_ms:550 },
};
function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  for (const [id, val] of Object.entries(p)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!val;
    else {
      el.value = val;
      const s = document.querySelector(`[data-for="${id}"]`);
      if (s) s.value = val;
    }
  }
  renderAllDerived();
  renderBlock();
  const label = name === "default" ? t("defaultsRestored") : t("presetApplied")(t("preset" + name.charAt(0).toUpperCase() + name.slice(1)));
  setStatus(label);
}
document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => applyPreset(c.dataset.preset)));

/* Live 32-byte block preview (reuses buildMbkitConfigBlock) */
const hexToStr = (v) => v.toString(16).padStart(2, "0").toUpperCase();
function renderBlock() {
  const el = document.getElementById("block-hex");
  if (!el) return;
  let block;
  try { block = buildMbkitConfigBlock(readMbkitConfig()); }
  catch (e) { el.innerHTML = '<span class="meta">—</span>'; return; }
  el.innerHTML = block.map((v, i) => {
    let cls = "b";
    if (i < 8) cls += " magic"; else if (i >= 28) cls += " crc"; else if (i === 8 || i === 9) cls += " meta";
    return `<span class="${cls}">${hexToStr(v)}</span>`;
  }).join(" ");
}

/* ── Download flow ────────────────────────────────────────── */

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function safeFilenamePart(text) {
  return text.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "robot";
}

function getVariant() {
  const checked = variantRadios.find((radio) => radio.checked);
  return checked ? checked.value : "microbit";
}

function updateVariantUI() {
  mbkitPanel.hidden = getVariant() !== "mbkit";
  if (!mbkitPanel.hidden) renderBlock();
}

async function generateFirmware(event) {
  event.preventDefault();
  downloadButton.disabled = true;
  setStatus(t("preparing"));

  try {
    const variant = getVariant();
    const spec = VARIANTS[variant];
    if (!spec) {
      throw new Error("Unknown board variant.");
    }

    const response = await fetch(spec.baseHexUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load the base firmware (${response.status}).`);
    }
    const baseHex = await response.text();
    const parsed = parseIntelHex(baseHex);

    /* The BLE name keeps the hidden "sjr-" prefix so the app can filter devices. */
    const bluetoothName = REQUIRED_PREFIX + nameInput.value.trim();
    patchBluetoothName(parsed.records, parsed.memory, bluetoothName);

    if (variant === "mbkit") {
      patchMbkitConfig(parsed.records, parsed.memory, readMbkitConfig());
    }

    const patchedHex = serializeRecords(parsed.records);
    verifyPatchedHex(patchedHex, variant, bluetoothName);

    const filename = `${spec.filePrefix}-${safeFilenamePart(nameInput.value)}.hex`;
    downloadTextFile(filename, patchedHex);
    setStatus(t("generated")(filename), "success");
  } catch (error) {
    setStatus(error.message || t("downloadFail"), "error");
  } finally {
    downloadButton.disabled = false;
  }
}

variantRadios.forEach((radio) => radio.addEventListener("change", updateVariantUI));
form.addEventListener("submit", generateFirmware);

/* init */
applyLang(lang);
updateThemeLabel();
updateVariantUI();
renderAllDerived();
renderBlock();
