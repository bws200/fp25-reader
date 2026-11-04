"use strict";

const connectButton = document.querySelector("#connect-button");
const disconnectButton = document.querySelector("#disconnect-button");
const connectionPanel = document.querySelector("#connection-panel");
const connectionSummary = document.querySelector("#connection-summary");
const pollReadingsButton = document.querySelector("#poll-readings");
const autoPollButton = document.querySelector("#auto-poll-button");
const readControls = document.querySelector("#read-controls");
const readingControlSummary = document.querySelector("#reading-control-summary");
const statusMessage = document.querySelector("#status");
const responseStatus = document.querySelector("#response-status");
const notificationLog = document.querySelector("#notification-log");
const deviceName = document.querySelector("#device-name");
const serviceList = document.querySelector("#service-list");
const serviceCount = document.querySelector("#service-count");
const connectionIndicator = document.querySelector("#connection-indicator");
const frameRows = document.querySelector("#frame-rows");

const FP25_SERVICE_UUID = "c5e69884-105c-41a2-ab07-ecd590e24814";
const FP25_COMMAND_CHARACTERISTIC_UUID = "aeafdf8b-33bc-4920-a092-1a1e4840e200";
const FP25_POLL_REQUEST = "A";
const FRAME_FIELDS = [
  ["Unit ID", 0, ""],
  ["Measurement ID", 1, ""],
  ["Date", 2, ""],
  ["Time", 3, ""],
  ["Abs Press", 4, "mmHgA @ 0°C"],
  ["Gage Press", 5, "mmHgG @ 0°C"],
  ["Baro Press", 6, "hPaA"],
  ["Temp", 7, "°C"],
  ["Temp Source", 8, ""],
  ["Vol Flow", 9, "LPM"],
  ["Std Flow", 10, "SLPM"],
  ["Rel Hum", 11, "%"],
  ["Gas", 12, ""],
];

let connectedDevice = null;
let fp25Characteristics = [];
const notificationReadings = new WeakMap();
const notificationListeners = new WeakSet();
const notificationSubscriptions = new WeakSet();
let notificationBuffer = "";
let measurementFrameCount = 0;
let notificationCount = 0;
let autoPolling = false;
let autoPollStarting = false;
let autoPollTimer = null;
let autoPollWritePending = false;
let manualPollInProgress = false;
let pendingFrameWaiter = null;
let autoPollFrameWaiter = null;

function waitForMeasurementFrame(timeoutMs = 3000) {
  let timeoutId;
  let resolvePromise;
  let settled = false;
  const waiter = {
    finish(received) {
      if (settled) {
        return;
      }
      settled = true;
      if (pendingFrameWaiter === waiter) {
        pendingFrameWaiter = null;
      }
      clearTimeout(timeoutId);
      resolvePromise(received);
    },
  };
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  pendingFrameWaiter = waiter;
  timeoutId = setTimeout(() => waiter.finish(false), timeoutMs);

  return {
    promise,
    cancel: () => waiter.finish(false),
  };
}

function canPollFp25() {
  const canWrite = fp25Characteristics.some(
    (characteristic) => characteristic.uuid.toLowerCase() === FP25_COMMAND_CHARACTERISTIC_UUID &&
      (characteristic.properties.write || characteristic.properties.writeWithoutResponse),
  );
  const canNotify = fp25Characteristics.some(
    (characteristic) => characteristic.properties.notify || characteristic.properties.indicate,
  );

  return Boolean(connectedDevice?.gatt?.connected && canWrite && canNotify);
}

function updatePollButtons() {
  const canPoll = canPollFp25();

  pollReadingsButton.disabled = !canPoll ||
    autoPolling || autoPollStarting || autoPollWritePending || manualPollInProgress;
  autoPollButton.disabled = !canPoll || autoPollStarting || manualPollInProgress;
  readingControlSummary.textContent = autoPolling
    ? "Auto update is on"
    : manualPollInProgress
      ? "Request in progress"
      : canPoll
        ? "Ready"
        : "Connect to read";
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function setResponseStatus(message, isError = false) {
  responseStatus.textContent = message;
  responseStatus.classList.toggle("error", isError);
}

function formatValue(dataView) {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
  const text = new TextDecoder().decode(bytes).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "�").trim();

  return {
    hex: hex || "(empty)",
    text: text || "(no printable text)",
  };
}

function parseMeasurementFrame(frame) {
  const fields = frame.trim().split(/\s+/);
  if (
    fields.length < 13 ||
    !/^[A-Z]$/i.test(fields[0]) ||
    !/^\d+$/.test(fields[1]) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fields[2])
  ) {
    return null;
  }

  const numericFields = fields.slice(4, 8).concat(fields.slice(9, 12));
  if (!numericFields.every((field) => /^[+-]?\d+(?:\.\d+)?$/.test(field))) {
    return null;
  }

  return {
    unitId: fields[0],
    measurementId: fields[1],
    date: fields[2],
    time: fields[3],
    absolutePressure: fields[4],
    gaugePressure: fields[5],
    barometricPressure: fields[6],
    temperature: fields[7],
    temperatureSource: fields[8],
    volumetricFlow: fields[9],
    standardFlow: fields[10],
    relativeHumidity: fields[11],
    gas: fields[12],
    fields,
  };
}

function renderFrameField(field) {
  const [name, valueIndex, units] = field;
  const row = document.createElement("tr");
  const nameCell = document.createElement("th");
  nameCell.scope = "row";
  nameCell.textContent = name;
  row.append(nameCell);
  const valueCell = document.createElement("td");
  valueCell.className = "frame-value";
  valueCell.textContent = "—";
  row.append(valueCell);
  const unitsCell = document.createElement("td");
  unitsCell.className = "frame-units";
  unitsCell.textContent = units;
  row.append(unitsCell);
  frameRows.append(row);
  return valueCell;
}

const frameValueCells = FRAME_FIELDS.map(renderFrameField);

function renderMeasurements(frame) {
  frameValueCells.forEach((cell, index) => {
    cell.textContent = frame.fields[index] || "—";
  });
}

function handleCharacteristicValue(characteristic, dataView) {
  notificationCount += 1;
  const reading = notificationReadings.get(characteristic);
  if (reading) {
    showValue(reading, dataView);
  }

  const formatted = formatValue(dataView);
  const channel = characteristic.uuid;
  const entry = document.createElement("li");
  entry.textContent = `${channel} · TEXT ${formatted.text} · HEX ${formatted.hex}`;
  notificationLog.append(entry);
  while (notificationLog.children.length > 10) {
    notificationLog.firstElementChild.remove();
  }

  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  const chunk = new TextDecoder().decode(bytes);
  const combined = `${notificationBuffer}${chunk}`;
  const lines = combined.split(/[\r\n]+/);
  notificationBuffer = lines.pop() || "";

  for (const line of lines) {
    const frame = parseMeasurementFrame(line);
    if (frame) {
      measurementFrameCount += 1;
      renderMeasurements(frame);
      setStatus(`Updated readings at ${frame.date} ${frame.time}.`);
      setResponseStatus(autoPolling
        ? "Auto update running; next request follows this frame."
        : "Measurement frame received and decoded.");
      pendingFrameWaiter?.finish(true);
    }
  }

  const completeFrame = parseMeasurementFrame(notificationBuffer);
  if (completeFrame) {
    notificationBuffer = "";
    measurementFrameCount += 1;
    renderMeasurements(completeFrame);
    setStatus(`Updated readings at ${completeFrame.date} ${completeFrame.time}.`);
    setResponseStatus(autoPolling
      ? "Auto update running; next request follows this frame."
      : "Measurement frame received and decoded.");
    pendingFrameWaiter?.finish(true);
  }
}

function attachNotificationListener(characteristic, reading) {
  if (reading) {
    notificationReadings.set(characteristic, reading);
  }
  if (notificationListeners.has(characteristic)) {
    return;
  }

  characteristic.addEventListener("characteristicvaluechanged", (event) => {
    handleCharacteristicValue(characteristic, event.target.value);
  });
  notificationListeners.add(characteristic);
}

async function enableNotifications(characteristic) {
  if (!characteristic.properties.notify && !characteristic.properties.indicate) {
    return;
  }
  if (notificationSubscriptions.has(characteristic)) {
    return;
  }
  await characteristic.startNotifications();
  notificationSubscriptions.add(characteristic);
  attachNotificationListener(characteristic);
}

async function writePollRequest(characteristic, request) {
  const payload = new TextEncoder().encode(request);
  if (
    characteristic.properties.writeWithoutResponse &&
    characteristic.writeValueWithoutResponse
  ) {
    await characteristic.writeValueWithoutResponse(payload);
  } else if (characteristic.properties.write && characteristic.writeValueWithResponse) {
    await characteristic.writeValueWithResponse(payload);
  } else if (characteristic.writeValue) {
    await characteristic.writeValue(payload);
  } else {
    throw new Error(`Characteristic ${characteristic.uuid} cannot send a poll request.`);
  }
}

function getCommandChannel() {
  const commandChannel = fp25Characteristics.find(
    (characteristic) => characteristic.uuid.toLowerCase() === FP25_COMMAND_CHARACTERISTIC_UUID,
  );
  if (!commandChannel || (!commandChannel.properties.write && !commandChannel.properties.writeWithoutResponse)) {
    throw new Error(`The FP-25 command characteristic ${FP25_COMMAND_CHARACTERISTIC_UUID} is not available for writing.`);
  }
  return commandChannel;
}

async function enableFp25Notifications() {
  const notifyChannels = fp25Characteristics.filter(
    (characteristic) => characteristic.properties.notify || characteristic.properties.indicate,
  );
  if (notifyChannels.length === 0) {
    throw new Error("The FP-25 measurement service has no notification characteristics.");
  }

  const errors = [];
  let activeChannels = 0;
  for (const characteristic of notifyChannels) {
    try {
      await enableNotifications(characteristic);
      activeChannels += 1;
    } catch (error) {
      errors.push(`${characteristic.uuid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Could not subscribe to every FP-25 notification channel: ${errors.join("; ")}`);
  }
  if (activeChannels === 0) {
    throw new Error("Could not subscribe to FP-25 notifications: no channels were enabled.");
  }
}

async function pollFp25(request) {
  const commandChannel = getCommandChannel();
  await enableFp25Notifications();
  notificationLog.replaceChildren();
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    notificationBuffer = "";
    const frameWaiter = waitForMeasurementFrame(2000);
    setResponseStatus(attempt === 1
      ? "Requesting readings…"
      : `No complete frame yet; retrying (${attempt}/${maxAttempts})…`);
    try {
      await writePollRequest(commandChannel, request);
    } catch (error) {
      frameWaiter.cancel();
      throw new Error(`Read request write failed on ${commandChannel.uuid}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (await frameWaiter.promise) {
      setResponseStatus("Readings updated.");
      return;
    }
  }

  setResponseStatus("No complete reading received after five requests. Check the connection and try again.", true);
}

function stopAutoPolling(updateStatus = true) {
  autoPolling = false;
  if (autoPollTimer !== null) {
    clearTimeout(autoPollTimer);
    autoPollTimer = null;
  }
  autoPollFrameWaiter?.cancel();
  autoPollFrameWaiter = null;
  autoPollButton.textContent = "Start auto update (0.5 s)";
  updatePollButtons();
  const canPoll = canPollFp25();
  if (updateStatus && canPoll) {
    setResponseStatus("Auto update stopped.");
  }
}

async function sendAutoPollRequest() {
  if (!autoPolling || autoPollWritePending) {
    return;
  }

  autoPollWritePending = true;
  notificationBuffer = "";
  const initialNotificationCount = notificationCount;
  const frameWaiter = waitForMeasurementFrame();
  autoPollFrameWaiter = frameWaiter;
  try {
    await writePollRequest(getCommandChannel(), `${FP25_POLL_REQUEST}\r`);
  } catch (error) {
    frameWaiter.cancel();
    autoPollFrameWaiter = null;
    stopAutoPolling(false);
    setResponseStatus(`Auto update stopped: ${error.message}`, true);
    return;
  } finally {
    autoPollWritePending = false;
    updatePollButtons();
  }

  const receivedFrame = await frameWaiter.promise;
  if (autoPollFrameWaiter === frameWaiter) {
    autoPollFrameWaiter = null;
  }
  if (autoPolling && !receivedFrame) {
    const notificationsReceived = notificationCount - initialNotificationCount;
    setResponseStatus(notificationsReceived > 0
      ? "Partial response received; retrying the read request."
      : "No response yet; retrying the read request.");
  }

  if (autoPolling) {
    autoPollTimer = setTimeout(sendAutoPollRequest, 500);
  }
}

async function toggleAutoPolling() {
  if (autoPolling) {
    stopAutoPolling();
    return;
  }

  autoPollStarting = true;
  updatePollButtons();
  try {
    getCommandChannel();
    await enableFp25Notifications();
    notificationBuffer = "";
    notificationLog.replaceChildren();
    autoPolling = true;
    autoPollButton.textContent = "Stop auto update";
    autoPollStarting = false;
    updatePollButtons();
    readControls.open = false;
    setResponseStatus("Auto update waits for each complete frame before requesting again.");
    await sendAutoPollRequest();
  } catch (error) {
    autoPolling = false;
    autoPollButton.textContent = "Start auto update (0.5 s)";
    setResponseStatus(`Could not start auto update: ${error.message}`, true);
  } finally {
    autoPollStarting = false;
    updatePollButtons();
  }
}

function showValue(valueElement, dataView) {
  const formatted = formatValue(dataView);
  valueElement.replaceChildren();

  const hex = document.createElement("span");
  hex.className = "reading-label";
  hex.textContent = "RAW BYTES";
  const hexValue = document.createElement("div");
  hexValue.textContent = formatted.hex;

  const text = document.createElement("span");
  text.className = "reading-label";
  text.textContent = "TEXT";
  const textValue = document.createElement("div");
  textValue.textContent = formatted.text;

  valueElement.append(hex, hexValue, text, textValue);
}

function clearServices(message) {
  stopAutoPolling(false);
  serviceList.replaceChildren();
  fp25Characteristics = [];
  pollReadingsButton.disabled = true;
  autoPollButton.disabled = true;
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = message;
  serviceList.append(empty);
  serviceCount.textContent = "0 services";
}

function clearMeasurements() {
  frameValueCells.forEach((cell) => {
    cell.textContent = "—";
  });
  notificationBuffer = "";
  measurementFrameCount = 0;
  notificationCount = 0;
  notificationLog.replaceChildren();
  setResponseStatus("Connect to the FP-25, then request readings.");
}

function handleDisconnected(device) {
  if (connectedDevice !== device) {
    return;
  }

  connectedDevice = null;
  connectButton.disabled = false;
  disconnectButton.disabled = true;
  connectionIndicator.classList.remove("connected");
  connectionSummary.textContent = "Not connected";
  connectionPanel.open = true;
  readControls.open = true;
  clearServices("Disconnected.");
  clearMeasurements();
  setStatus("Device disconnected.");
}

async function renderServices(server) {
  setStatus("Discovering authorized services…");
  const services = await server.getPrimaryServices();
  serviceList.replaceChildren();
  serviceCount.textContent = `${services.length} ${services.length === 1 ? "service" : "services"}`;

  if (services.length === 0) {
    clearServices("No Bluetooth services were found.");
    setStatus("Connected.");
    return;
  }

  for (const service of services) {
    const card = document.createElement("article");
    card.className = "service-card";

    const title = document.createElement("h3");
    title.className = "service-title";
    title.textContent = `Service · ${service.uuid}`;
    card.append(title);
    serviceList.append(card);

    let characteristics;
    try {
      characteristics = await service.getCharacteristics();
    } catch (error) {
      const message = document.createElement("p");
      message.className = "empty-state";
      message.textContent = `Could not inspect this service: ${error.message}`;
      card.append(message);
      continue;
    }

    if (service.uuid.toLowerCase() === FP25_SERVICE_UUID) {
      fp25Characteristics = characteristics;
    }

    if (characteristics.length === 0) {
      const message = document.createElement("p");
      message.className = "empty-state";
      message.textContent = "This service has no characteristics.";
      card.append(message);
      continue;
    }

    for (const characteristic of characteristics) {
      renderCharacteristic(card, characteristic);
    }

  }

  const canWrite = fp25Characteristics.some(
    (characteristic) => characteristic.uuid.toLowerCase() === FP25_COMMAND_CHARACTERISTIC_UUID &&
      (characteristic.properties.write || characteristic.properties.writeWithoutResponse),
  );
  const canNotify = fp25Characteristics.some(
    (characteristic) => characteristic.properties.notify || characteristic.properties.indicate,
  );
  updatePollButtons();
  setStatus("Connected.");
  setResponseStatus(canWrite && canNotify
    ? "Ready. Request readings to send the observed read-only command."
    : "The FP-25 measurement service does not expose both writable and notification channels.", !canWrite || !canNotify);
}

function renderCharacteristic(serviceCard, characteristic) {
  const section = document.createElement("section");
  section.className = "characteristic";

  const heading = document.createElement("div");
  heading.className = "characteristic-heading";
  const name = document.createElement("span");
  name.className = "characteristic-name";
  name.textContent = "Characteristic";
  const uuid = document.createElement("span");
  uuid.className = "characteristic-uuid";
  uuid.textContent = characteristic.uuid;
  heading.append(name, uuid);

  const supportedProperties = ["read", "write", "writeWithoutResponse", "notify", "indicate"]
    .filter((property) => characteristic.properties[property]);
  const properties = document.createElement("p");
  properties.className = "properties";
  properties.textContent = `Available: ${supportedProperties.join(", ") || "no read/notification properties"}`;

  const reading = document.createElement("div");
  reading.className = "reading";
  reading.textContent = characteristic.properties.read
    ? "Not read yet."
    : "This characteristic does not allow reads.";
  if (characteristic.properties.notify || characteristic.properties.indicate) {
    notificationReadings.set(characteristic, reading);
  }

  const actions = document.createElement("div");
  actions.className = "characteristic-actions";

  if (characteristic.properties.read) {
    const readButton = document.createElement("button");
    readButton.className = "small-button";
    readButton.type = "button";
    readButton.textContent = "Read";
    readButton.addEventListener("click", async () => {
      readButton.disabled = true;
      try {
        showValue(reading, await characteristic.readValue());
      } catch (error) {
        reading.textContent = `Read failed: ${error.message}`;
      } finally {
        readButton.disabled = false;
      }
    });
    actions.append(readButton);
  }

  if (characteristic.properties.notify || characteristic.properties.indicate) {
    const notifyButton = document.createElement("button");
    notifyButton.className = "small-button";
    notifyButton.type = "button";
    notifyButton.textContent = "Start notifications";
    notifyButton.addEventListener("click", async () => {
      notifyButton.disabled = true;
      try {
        await enableNotifications(characteristic);
        attachNotificationListener(characteristic, reading);
        notifyButton.textContent = "Notifications on";
        setStatus(`Receiving notifications from ${characteristic.uuid}.`);
      } catch (error) {
        notifyButton.disabled = false;
        setStatus(`Could not start notifications: ${error.message}`, true);
      }
    });
    actions.append(notifyButton);
  }

  section.append(heading, properties, reading, actions);
  serviceCard.append(section);
}

async function connect() {
  if (!("bluetooth" in navigator) || !navigator.bluetooth) {
    setStatus("Web Bluetooth is unavailable here. Open this HTTPS page in Chrome on Android.", true);
    return;
  }

  connectButton.disabled = true;
  setStatus("Choose a device in the Bluetooth prompt…");

  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ["generic_access", "device_information", FP25_SERVICE_UUID],
    });
    if (!device.gatt) {
      throw new Error("The selected device does not expose a GATT server.");
    }

    connectedDevice = device;
    device.addEventListener("gattserverdisconnected", () => handleDisconnected(device), { once: true });
    setStatus("Connecting…");
    const server = await device.gatt.connect();
    connectionIndicator.classList.add("connected");
    disconnectButton.disabled = false;
    connectionSummary.textContent = device.name || "Connected";
    clearMeasurements();
    await renderServices(server);
    connectionPanel.open = false;
    readControls.open = false;
  } catch (error) {
    if (error.name === "NotFoundError") {
      setStatus("No device was selected.", false);
    } else {
      setStatus(`Connection failed: ${error.message}`, true);
    }

    if (connectedDevice?.gatt?.connected) {
      connectedDevice.gatt.disconnect();
    }
    connectedDevice = null;
    connectButton.disabled = false;
    disconnectButton.disabled = true;
    connectionIndicator.classList.remove("connected");
    connectionSummary.textContent = "Not connected";
    connectionPanel.open = true;
    readControls.open = true;
    clearServices("Could not inspect the selected device.");
  }
}

async function poll(request) {
  if (!canPollFp25() || autoPolling || autoPollStarting || manualPollInProgress) {
    return;
  }
  manualPollInProgress = true;
  updatePollButtons();
  readControls.open = false;
  try {
    await pollFp25(request);
  } catch (error) {
    setResponseStatus(`Could not request readings: ${error.message}`, true);
  } finally {
    manualPollInProgress = false;
    updatePollButtons();
  }
}

connectButton.addEventListener("click", connect);
pollReadingsButton.addEventListener("click", () => poll(`${FP25_POLL_REQUEST}\r`));
autoPollButton.addEventListener("click", toggleAutoPolling);
disconnectButton.addEventListener("click", () => {
  if (connectedDevice?.gatt?.connected) {
    connectedDevice.gatt.disconnect();
  }
});

if (!("bluetooth" in navigator) || !navigator.bluetooth) {
  setStatus("Web Bluetooth is unavailable in this browser. Use Chrome on Android over HTTPS.", true);
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) {
      return;
    }
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch((error) => console.error("Could not register the FP-25 app service worker.", error));
}
