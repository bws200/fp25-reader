# FP-25 Bluetooth Reader

A small Web Bluetooth reader for FP-25 measurements, intended to run as a static GitHub Pages site on Android Chrome.

The app sends the observed FlowVision read request `A $$R16` (terminated with carriage return) to an FP-25 GATT characteristic, listens for notifications, and decodes the data-frame fields identified by FlowVision's `A??D*` response. It has no arbitrary write controls and does not change setpoints or device settings.

## Use on Android

1. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. GitHub requires this one-time setting; the workflow cannot enable Pages without repository-admin permissions.
2. The included workflow deploys the site whenever `main` is updated. After its first successful run, use the Pages URL shown in the repository's **Settings → Pages**.
3. Open the published HTTPS Pages URL in Chrome on Android.
4. Choose the FP-25 and tap **Poll readings** on a characteristic in the FP-25 measurement service. The app subscribes to notification characteristics and sends only `A $$R16` plus the carriage-return terminator.
5. The latest frame is decoded into volumetric/standard flow, pressure, temperature, humidity, and gas. Raw bytes remain visible under each characteristic.

The app displays raw bytes as hexadecimal and best-effort UTF-8 text alongside decoded measurements. Device selection and BLE data remain in the browser; this site has no backend.

The footer shows the Git commit hash and subject used for the deployed build. On each visit, the page checks a cache-busted build manifest and automatically reloads if Pages is serving an older version. The deployment publishes the current `main` build at one Pages URL; it does not create separate public URLs for older builds.

## Requirements and limitations

- Web Bluetooth requires HTTPS and a supported browser. Android Chrome is a supported target; iOS browsers do not expose Web Bluetooth.
- This project is not affiliated with Alicat and does not replace Alicat Connect.
- BLE polling is based on the observed FlowVision command and frame from one FP-25. If your device firmware responds differently, stop polling and share the notification bytes before trying other commands.

## References

- [Alicat FP-25 product page](https://www.alicat.com/products/calibrators/fp-25-field-flow-calibrator-for-pm-air-samplers/)
- [Alicat Connect documentation](https://www.alicat.com/documentation/alicat-connect/)
- [Chrome Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth/)
