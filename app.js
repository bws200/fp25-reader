"use strict";

const connectButton = document.querySelector("#connect-button");
const disconnectButton = document.querySelector("#disconnect-button");
const pollReadingsButton = document.querySelector("#poll-readings");
const autoPollButton = document.querySelector("#auto-poll-button");
const statusMessage = document.querySelector("#status");
const responseStatus = document.querySelector("#response-status");
const responseOutput = document.querySelector("#response-output");
const notificationLog = document.querySelector("#notification-log");
const deviceName = document.querySelector("#device-name");
const serviceList = document.querySelector("#service-list");
const serviceCount = document.querySelector("#service-count");
const connectionIndicator = document.querySelector("#connection-indicator");
const frameRows = document.querySelector("#frame-rows");
const measurementTime = document.querySelector("#measurement-time");
const measurementSource = document.querySelector("#measurement-source");

const FP25_SERVICE_UUID = "c5e69884-105c-41a2-ab07-ecd590e24814";
const FP25_COMMAND_CHARACTERISTIC_UUID = "aeafdf8b-33bc-4920-a092-1a1e4840e200";
const FP25_POLL_REQUEST = "A";
const FRAME_FIELDS = [
  ["D01", "700", "Unit ID", "string", 0, "1", ""],
  ["D02", "801", "Measurement ID", "decimal", 1, "6/0", ""],
  ["D03", "400", "User Date", "date", 2, "4/0 002 02", "y-m-d"],
  ["D04", "392", "User Time", "time", 3, "4/0 002 02", "h:m:s"],
  ["D05", "002", "Abs Press", "s decimal", 4, "7/1 014 02", "mmHgA @ 0°C"],
  ["D06", "006", "Gage Press", "s decimal", 5, "7/1 014 02", "mmHgG @ 0°C"],
  ["D07", "015", "Baro Press", "s decimal", 6, "7/0 003 02", "hPaA"],
  ["D08", "020", "Temp", "s decimal", 7, "7/2 002 02", "°C"],
  ["D09", "021", "Temp Source", "string", 8, "1/1", ""],
  ["D10", "017", "Vol Flow", "s decimal", 9, "7/3 007 02", "LPM"],
  ["D11", "005", "Std Flow", "s decimal", 10, "7/3 007 02", "SLPM"],
  ["D12", "025", "Rel Hum", "decimal", 11, "3/0 003 02", "%"],
  ["D13", "703", "Gas", "string", 12, "7/7", ""],
];

let connectedDevice = null;
let fp25Characteristics = [];
const notificationReadings = new WeakMap();
const notificationListeners = new WeakSet();
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
  const [id, code, name, type, valueIndex, width, notes] = field;
  const row = document.createElement("tr");
  for (const value of [id, code, name, type]) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
  }
  const valueCell = document.createElement("td");
  valueCell.className = "frame-value";
  valueCell.dataset.fieldIndex = String(valueIndex);
  valueCell.textContent = "—";
  row.append(valueCell);
  const widthCell = document.createElement("td");
  widthCell.textContent = width;
  row.append(widthCell);
  const notesCell = document.createElement("td");
  notesCell.textContent = notes;
  row.append(notesCell);
  frameRows.append(row);
  return valueCell;
}

const frameValueCells = FRAME_FIELDS.map(renderFrameField);

function renderMeasurements(frame) {
  frameValueCells.forEach((cell, index) => {
    cell.textContent = frame.fields[index] || "—";
  });
  measurementTime.textContent = `${frame.date} ${frame.time}`;
  measurementSource.textContent = `Unit ${frame.unitId} · measurement ${frame.measurementId}`;
}

function handleCharacteristicValue(characteristic, dataView) {
  notificationCount += 1;
  const reading = notificationReadings.get(characteristic);
  if (reading) {
    showValue(reading, dataView);
  }

  const formatted = formatValue(dataView);
  const channel = characteristic.uuid;
  responseOutput.textContent = `Channel: ${channel}\nText: ${formatted.text}\nHex: ${formatted.hex}`;
  measurementTime.textContent = "Response received";
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
      responseOutput.textContent = `Measurement frame:\n${line}`;
      measurementTime.textContent = `${frame.date} ${frame.time}`;
      setStatus(`Updated readings at ${frame.date} ${frame.time}.`);
      setResponseStatus(autoPolling
        ? "Auto update running; next request follows this frame."
        : "Measurement frame received and decoded.");
      pendingFrameWaiter?.finish(true);
    }
  }

  const completeFrame = parseMeasurementFrame(notificationBuffer);
  if (completeFrame) {
    const line = notificationBuffer;
    notificationBuffer = "";
    measurementFrameCount += 1;
    renderMeasurements(completeFrame);
    responseOutput.textContent = `Measurement frame:\n${line}`;
    measurementTime.textContent = `${completeFrame.date} ${completeFrame.time}`;
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
  await characteristic.startNotifications();
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

  const subscriptionResults = await Promise.allSettled(notifyChannels.map(enableNotifications));
  const activeChannels = subscriptionResults
    .map((result, index) => result.status === "fulfilled" ? notifyChannels[index] : null)
    .filter((characteristic) => characteristic !== null);
  if (activeChannels.length === 0) {
    const errors = subscriptionResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    throw new Error(`Could not subscribe to FP-25 notifications: ${errors.join("; ")}`);
  }
}

async function pollFp25(request) {
  const commandChannel = getCommandChannel();
  await enableFp25Notifications();
  responseOutput.textContent = "Waiting for a response…";
  notificationLog.replaceChildren();
  notificationBuffer = "";
  const initialFrameCount = measurementFrameCount;
  const initialNotificationCount = notificationCount;
  const frameWaiter = waitForMeasurementFrame();
  setResponseStatus(`Sending one read request on ${commandChannel.uuid}…`);
  try {
    await writePollRequest(commandChannel, request);
  } catch (error) {
    frameWaiter.cancel();
    throw new Error(`Read request write failed on ${commandChannel.uuid}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (await frameWaiter.promise || measurementFrameCount > initialFrameCount) {
    setResponseStatus("Measurement frame received and decoded.");
    return;
  }

  const notificationsReceived = notificationCount - initialNotificationCount;
  if (notificationsReceived > 0) {
    setResponseStatus(
      `${notificationsReceived} notification${notificationsReceived === 1 ? "" : "s"} received from one read request, but none contained a complete measurement frame. Raw data is shown above and in the notification log.`,
      true,
    );
    return;
  }

  responseOutput.textContent = "No response notification received.";
  setResponseStatus(`No notification response to the read request on ${commandChannel.uuid}. No other channels were written.`, true);
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
    responseOutput.textContent = "Waiting for measurement frames…";
    autoPolling = true;
    autoPollButton.textContent = "Stop auto update";
    autoPollStarting = false;
    updatePollButtons();
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

function clearMeasurements(message) {
  frameValueCells.forEach((cell) => {
    cell.textContent = "—";
  });
  notificationBuffer = "";
  measurementFrameCount = 0;
  notificationCount = 0;
  responseOutput.textContent = "No data received yet.";
  notificationLog.replaceChildren();
  measurementTime.textContent = "Not received";
  measurementSource.textContent = message;
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
  deviceName.hidden = true;
  clearServices("Disconnected.");
  clearMeasurements("No measurement frame received.");
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
    deviceName.textContent = `Connected device: ${device.name || "Unnamed device"}`;
    deviceName.hidden = false;
    clearMeasurements("No measurement frame received.");
    await renderServices(server);
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
    deviceName.hidden = true;
    deviceName.textContent = "";
    clearServices("Could not inspect the selected device.");
  }
}

async function poll(request) {
  if (!canPollFp25() || autoPolling || autoPollStarting || manualPollInProgress) {
    return;
  }
  manualPollInProgress = true;
  updatePollButtons();
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
