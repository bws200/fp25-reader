# FP-25 Bluetooth Inspector

A small, read-only Web Bluetooth inspector intended to run as a static GitHub Pages site on Android Chrome.

> **Prototype only:** The FP-25's GATT service UUIDs and measurement data format are not described in Alicat's public documentation. This app can inspect readable BLE characteristics that you authorize, but it does not yet decode FP-25 measurements or units.

## Use on Android

1. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. GitHub requires this one-time setting; the workflow cannot enable Pages without repository-admin permissions.
2. The included workflow deploys the site whenever `main` is updated. After its first successful run, use the Pages URL shown in the repository's **Settings → Pages**.
3. Open the published HTTPS Pages URL in Chrome on Android.
4. Enter any known service UUIDs before connecting. Chrome only permits access to the services listed in this field (along with services selected by its chooser).
5. Choose the device, then use **Read** or **Start notifications** on characteristics that expose those capabilities.

The inspector displays raw bytes as hexadecimal and best-effort UTF-8 text. It intentionally has no write operation. Device selection and BLE data remain in the browser; this site has no backend.

## Requirements and limitations

- Web Bluetooth requires HTTPS and a supported browser. Android Chrome is a supported target; iOS browsers do not expose Web Bluetooth.
- This project is not affiliated with Alicat and does not replace Alicat Connect.
- To turn this into an FP-25 values reader, obtain Alicat's BLE/GATT specification or confirmation of its service and characteristic UUIDs, security requirements, notification/read behavior, and measurement framing.

## References

- [Alicat FP-25 product page](https://www.alicat.com/products/calibrators/fp-25-field-flow-calibrator-for-pm-air-samplers/)
- [Alicat Connect documentation](https://www.alicat.com/documentation/alicat-connect/)
- [Chrome Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth/)
