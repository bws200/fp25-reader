# FP-25 Bluetooth Reader

A small Web Bluetooth reader for FP-25 measurements, intended to run as a static GitHub Pages site on Android Chrome.

The app sends the observed FlowVision read request `A $$R16` with a carriage-return terminator, which produced a BLE notification on the user's FP-25. It listens for notifications and decodes the data-frame fields identified by FlowVision's `A??D*` response. It has no arbitrary write controls and does not change setpoints or device settings.

## Use on Android

1. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. GitHub requires this one-time setting; the workflow cannot enable Pages without repository-admin permissions.
2. The included workflow deploys the site whenever `main` is updated. After its first successful run, use the Pages URL shown in the repository's **Settings → Pages**.
3. Open the published HTTPS Pages URL in Chrome on Android.
4. Choose the FP-25 and tap **Request readings**. The app subscribes to notifications and sends the observed `A $$R16` request with a trailing carriage return, using BLE write-without-response when available. It checks writable channels until a complete measurement frame arrives or all channels are tried. The no-carriage-return variant is under **Alternative request format**.
5. Notifications are shown as text and hex, even if they are not complete measurement frames. The app keeps checking other writable channels after a non-frame notification such as `A 016 = 199`; when a measurement frame arrives, it decodes the values in **Decoded data frame fields**. Open **Bluetooth services** only for channel-level details.

Device selection and BLE data remain in the browser; this site has no backend.

The footer shows the Git commit hash and subject used for the deployed build. On each visit, the page checks a cache-busted build manifest and automatically reloads if Pages is serving an older version. The deployment publishes the current `main` build at one Pages URL; it does not create separate public URLs for older builds.

## Requirements and limitations

- Web Bluetooth requires HTTPS and a supported browser. Android Chrome is a supported target; iOS browsers do not expose Web Bluetooth.
- This project is not affiliated with Alicat and does not replace Alicat Connect.
- BLE polling is based on the observed FlowVision command and frame from one FP-25. The CR-terminated request has produced a raw response notification on this meter; the current observed response is not yet a complete measurement frame. Write-without-response is preferred because it is supported by the measurement characteristics. The alternate no-CR option remains available for testing. If your device firmware responds differently, stop polling and share the notification bytes before trying other commands.

## References

- [Alicat FP-25 product page](https://www.alicat.com/products/calibrators/fp-25-field-flow-calibrator-for-pm-air-samplers/)
- [Alicat Connect documentation](https://www.alicat.com/documentation/alicat-connect/)
- [Chrome Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth/)
