# FP-25 Bluetooth Reader

A small Web Bluetooth reader for FP-25 measurements, intended to run as a static GitHub Pages site on Android Chrome.

The app sends the observed FlowVision read request `A $$R16` to FP-25 GATT characteristics, with an option to include or omit the carriage-return terminator. It listens for notifications and decodes the data-frame fields identified by FlowVision's `A??D*` response. It has no arbitrary write controls and does not change setpoints or device settings.

## Use on Android

1. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. GitHub requires this one-time setting; the workflow cannot enable Pages without repository-admin permissions.
2. The included workflow deploys the site whenever `main` is updated. After its first successful run, use the Pages URL shown in the repository's **Settings → Pages**.
3. Open the published HTTPS Pages URL in Chrome on Android.
4. Choose the FP-25 and try one of the two **Poll readings** options in its measurement service: with or without a trailing carriage return. Both options subscribe to notification characteristics and send only the observed `A $$R16` read request on writable channels, stopping when a valid measurement frame arrives.
5. The app shows the FlowVision `A??D*` field layout in a table. Values and units appear as soon as a valid measurement frame arrives; raw bytes remain visible under each characteristic.

The app displays raw bytes as hexadecimal and best-effort UTF-8 text alongside decoded measurements. Device selection and BLE data remain in the browser; this site has no backend.

The footer shows the Git commit hash and subject used for the deployed build. On each visit, the page checks a cache-busted build manifest and automatically reloads if Pages is serving an older version. The deployment publishes the current `main` build at one Pages URL; it does not create separate public URLs for older builds.

## Requirements and limitations

- Web Bluetooth requires HTTPS and a supported browser. Android Chrome is a supported target; iOS browsers do not expose Web Bluetooth.
- This project is not affiliated with Alicat and does not replace Alicat Connect.
- BLE polling is based on the observed FlowVision command and frame from one FP-25. The two poll options test whether BLE expects a trailing carriage return. If your device firmware responds differently, stop polling and share the notification bytes before trying other commands.

## References

- [Alicat FP-25 product page](https://www.alicat.com/products/calibrators/fp-25-field-flow-calibrator-for-pm-air-samplers/)
- [Alicat Connect documentation](https://www.alicat.com/documentation/alicat-connect/)
- [Chrome Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth/)
