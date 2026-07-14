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

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : "status";
}

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

/* ── mb-kit config block ──────────────────────────────────────────── */

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

function readMbkitConfig() {
  return {
    near_threshold_mm: readNumberField("near_threshold_mm", "Near threshold", 0, 65535),
    light_threshold: readNumberField("light_threshold", "Light threshold", 0, 65535),
    wet_threshold: readNumberField("wet_threshold", "Wet threshold", 0, 255),
    ring_brightness: readNumberField("ring_brightness", "Ring brightness", 0, 255),
    rainbow_step_ms: readNumberField("rainbow_step_ms", "Animation step", 1, 65535),
    soil_high_is_wet: document.getElementById("soil_high_is_wet").checked ? 1 : 0,
    motor_swap: document.getElementById("motor_swap").checked ? 1 : 0,
    motor0_invert: document.getElementById("motor0_invert").checked ? 1 : 0,
    motor1_invert: document.getElementById("motor1_invert").checked ? 1 : 0,
    motor_default_speed: readNumberField("motor_default_speed", "Motor speed", 1, 255),
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

/* ── Download flow ────────────────────────────────────────────────── */

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
}

async function generateFirmware(event) {
  event.preventDefault();
  downloadButton.disabled = true;
  setStatus("Preparing firmware...");

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
    setStatus(`Firmware generated: ${filename}`, "success");
  } catch (error) {
    setStatus(error.message || "Could not generate the firmware.", "error");
  } finally {
    downloadButton.disabled = false;
  }
}

variantRadios.forEach((radio) => radio.addEventListener("change", updateVariantUI));
form.addEventListener("submit", generateFirmware);
updateVariantUI();
