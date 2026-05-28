"use strict";

const BASE_HEX_URL = "./firmware/scratchjr-microbit-base.hex";
const DEFAULT_NAME_SLOT = "sjr-                ";
const NAME_SLOT_BYTES = 20;

const form = document.getElementById("firmware-form");
const nameInput = document.getElementById("bluetooth-name");
const statusEl = document.getElementById("status");
const downloadButton = document.getElementById("download-button");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : "status";
}

function parseHexByte(text, offset) {
  const value = Number.parseInt(text.slice(offset, offset + 2), 16);
  if (!Number.isFinite(value) || value < 0 || value > 255) {
    throw new Error(`HEX invalido cerca de la posicion ${offset}.`);
  }
  return value;
}

function checksum(bytes) {
  const sum = bytes.reduce((acc, value) => (acc + value) & 0xff, 0);
  return ((~sum + 1) & 0xff);
}

function parseIntelHexLine(line, index) {
  if (!line.startsWith(":")) {
    throw new Error(`Linea ${index + 1}: falta ':' inicial.`);
  }

  const byteCount = parseHexByte(line, 1);
  const address = (parseHexByte(line, 3) << 8) | parseHexByte(line, 5);
  const type = parseHexByte(line, 7);
  const expectedLength = 11 + byteCount * 2;
  if (line.length !== expectedLength) {
    throw new Error(`Linea ${index + 1}: longitud Intel HEX inesperada.`);
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
    throw new Error(`Linea ${index + 1}: checksum invalido.`);
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

function asciiBytes(text) {
  return Array.from(text, (char) => {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) {
      throw new Error("El nombre debe usar solo caracteres ASCII imprimibles.");
    }
    return code;
  });
}

function fixedNameBytes(name) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Ingresá un nombre Bluetooth.");
  }

  const bytes = asciiBytes(trimmedName);
  if (bytes.length > NAME_SLOT_BYTES) {
    throw new Error(`El nombre no puede superar ${NAME_SLOT_BYTES} caracteres.`);
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
    throw new Error("No se pudieron parchear todos los bytes del nombre.");
  }
}

function patchBluetoothName(hexText, bluetoothName) {
  const parsed = parseIntelHex(hexText);
  const marker = asciiBytes(DEFAULT_NAME_SLOT);
  const matches = findByteSequence(parsed.memory, marker);
  if (matches.length !== 1) {
    throw new Error(`Se esperaba encontrar 1 slot de nombre, encontrados: ${matches.length}.`);
  }

  patchRecords(parsed.records, matches[0], fixedNameBytes(bluetoothName));
  return parsed.records.map((record) => record.raw).join("\n") + "\n";
}

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

async function generateFirmware(event) {
  event.preventDefault();
  downloadButton.disabled = true;
  setStatus("Preparando firmware...");

  try {
    const response = await fetch(BASE_HEX_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`No se pudo cargar el firmware base (${response.status}).`);
    }

    const baseHex = await response.text();
    const bluetoothName = nameInput.value;
    const patchedHex = patchBluetoothName(baseHex, bluetoothName);
    const filename = `scratchjr-microbit-${safeFilenamePart(bluetoothName)}.hex`;
    downloadTextFile(filename, patchedHex);
    setStatus(`Firmware generado: ${filename}`, "success");
  } catch (error) {
    setStatus(error.message || "No se pudo generar el firmware.", "error");
  } finally {
    downloadButton.disabled = false;
  }
}

form.addEventListener("submit", generateFirmware);
