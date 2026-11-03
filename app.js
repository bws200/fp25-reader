"use strict";

const connectButton = document.querySelector("#connect-button");
const disconnectButton = document.querySelector("#disconnect-button");
const nameFilter = document.querySelector("#name-filter");
const serviceUuidsInput = document.querySelector("#service-uuids");
const statusMessage = document.querySelector("#status");
const deviceName = document.querySelector("#device-name");
const serviceList = document.querySelector("#service-list");
const serviceCount = document.querySelector("#service-count");
const connectionIndicator = document.querySelector("#connection-indicator");

let connectedDevice = null;

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function parseServiceUuids(value) {
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const services = [];

  for (const entry of entries) {
    try {
      services.push(BluetoothUUID.getService(entry));
    } catch {
      throw new Error(`"${entry}" is not a recognized service name or UUID.`);
    }
  }

  return [...new Set(services)];
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
  serviceList.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = message;
  serviceList.append(empty);
  serviceCount.textContent = "0 services";
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
  clearServices("Disconnected. Connect again to inspect the device.");
  setStatus("Device disconnected.");
}

async function renderServices(server) {
  setStatus("Discovering authorized services…");
  const services = await server.getPrimaryServices();
  serviceList.replaceChildren();
  serviceCount.textContent = `${services.length} ${services.length === 1 ? "service" : "services"}`;

  if (services.length === 0) {
    clearServices("No authorized services were found. Add the device's service UUID above and reconnect.");
    setStatus("Connected, but no authorized services were found.", true);
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

  setStatus("Connected. Read values or subscribe to notifications where supported.");
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

  const supportedProperties = ["read", "notify", "indicate"]
    .filter((property) => characteristic.properties[property]);
  const properties = document.createElement("p");
  properties.className = "properties";
  properties.textContent = `Available: ${supportedProperties.join(", ") || "no read/notification properties"}`;

  const reading = document.createElement("div");
  reading.className = "reading";
  reading.textContent = characteristic.properties.read
    ? "Not read yet."
    : "This characteristic does not allow reads.";

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
        await characteristic.startNotifications();
        characteristic.addEventListener("characteristicvaluechanged", (event) => {
          showValue(reading, event.target.value);
        });
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

  let optionalServices;
  try {
    optionalServices = parseServiceUuids(serviceUuidsInput.value);
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  const prefix = nameFilter.value.trim();
  const requestOptions = prefix
    ? { filters: [{ namePrefix: prefix }], optionalServices }
    : { acceptAllDevices: true, optionalServices };

  connectButton.disabled = true;
  setStatus("Choose a device in the Bluetooth prompt…");

  try {
    const device = await navigator.bluetooth.requestDevice(requestOptions);
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
    clearServices("Could not inspect the selected device. Check its service UUIDs and reconnect.");
  }
}

connectButton.addEventListener("click", connect);
disconnectButton.addEventListener("click", () => {
  if (connectedDevice?.gatt?.connected) {
    connectedDevice.gatt.disconnect();
  }
});

if (!("bluetooth" in navigator) || !navigator.bluetooth) {
  setStatus("Web Bluetooth is unavailable in this browser. Use Chrome on Android over HTTPS.", true);
}
