# FP-25 Bluetooth Reader

A small Web Bluetooth reader for FP-25 measurements, intended to run as a static GitHub Pages site on Android Chrome.

The app sends the FlowVision BLE terminal's observed live-read request `A` with a carriage-return terminator. It listens for notifications and decodes the data-frame fields identified by FlowVision's `A??D*` response. It has no arbitrary write controls and does not change setpoints or device settings.

## Use on Android

1. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. GitHub requires this one-time setting; the workflow cannot enable Pages without repository-admin permissions.
2. The included workflow deploys the site whenever `main` is updated. After its first successful run, use the Pages URL shown in the repository's **Settings → Pages**.
3. Open the published HTTPS Pages URL in Chrome on Android.
4. Choose the FP-25 and tap **Request readings** for one update, or **Start auto update (0.5 s)** to keep requesting readings. Each request waits up to three seconds for a complete measurement frame; auto update retries if none arrives and waits 500 ms after each complete frame before requesting again. It stops if the device disconnects or a write fails. Tap **Stop auto update** to return to one-shot mode; **Request readings** is enabled again.
5. Notifications are shown as text and hex, even if they are not complete measurement frames. The FP-25 may split one measurement line across several notification characteristics; the app joins incoming text chunks in arrival order, then decodes the completed frame in **Decoded data frame fields**. Open **Bluetooth services** only for channel-level details.

Device selection and BLE data remain in the browser; this site has no backend.

The footer shows the Git commit hash and subject used for the deployed build. On each visit, the page checks a cache-busted build manifest and automatically reloads if Pages is serving an older version. The deployment publishes the current `main` build at one Pages URL; it does not create separate public URLs for older builds.

## Requirements and limitations

- Web Bluetooth requires HTTPS and a supported browser. Android Chrome is a supported target; iOS browsers do not expose Web Bluetooth.
- This project is not affiliated with Alicat and does not replace Alicat Connect.
- BLE polling uses the `A` command shown in FlowVision's BLE Device terminal, which returned full live measurement frames. A carriage return terminates the request. The app writes to the observed `...e200` command channel and subscribes to notification characteristics; it does not guess the command channel from service enumeration order. Write-without-response is preferred because it is supported by the measurement characteristic. If your device firmware responds differently, stop polling and share the notification bytes before trying other commands.

## References

- [Alicat FP-25 product page](https://www.alicat.com/products/calibrators/fp-25-field-flow-calibrator-for-pm-air-samplers/)
- [Alicat Connect documentation](https://www.alicat.com/documentation/alicat-connect/)
- [Chrome Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth/)
