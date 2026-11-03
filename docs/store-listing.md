# Chrome Web Store listing draft

This is a preparation draft, not a published privacy policy or a completed policy review. Verify the final public package, companion application and dashboard answers together before submission.

## Name

Fast Bridge

## Single purpose

Connect Chrome to the user's local FastGoTo application so that Fast can use browser context and perform user-enabled browser actions.

## Description

Fast Bridge connects Chrome to FastGoTo running on Windows. It lets Fast use the current page and tab information and perform browser actions. The matching FastGoTo Host and FastJS runtime are required; the extension alone does not provide the desktop features.

When the local connection is enabled, the extension can share page URLs, titles and tab information, as well as page content and ordinary input, with the local Fast application. It can also perform browser actions requested by that application. These controls are enabled initially and can be paused or changed in the extension popup. The built-in value reader rejects password, verification-code and payment-card inputs. Website-triggered messages require separate per-site grants. This public package does not include a temporary user-script executor. Local file access also requires Chrome's file access setting.

The extension stores its settings locally. It connects to an application-approved local native host, then exchanges authenticated encrypted messages with the local Fast runtime. The companion application may process or transmit information according to its own features and configuration; review its privacy practices too.

## Permission explanations for dashboard review

- `tabs` and content scripts on all URLs: obtain page and tab context and enable the browser actions described above on sites the user visits.
- `storage`: retain local settings, pause state and site grants.
- `nativeMessaging`: establish a local connection to the application-approved FastGoTo native host.
- `offscreen`: support the extension's offscreen document for image-related operations.

## Disclosure and submission checks

- Disclose browsing activity, website content and ordinary form input. The built-in reader rejects recognized sensitive inputs; review ordinary page content and companion data flows before making authentication/financial-data declarations. Do not mark data as absent merely because transfer is local.
- Publish an accurate privacy policy at a public URL and provide it in the dashboard. It must describe collection, use and recipients across both the extension and companion application, retention and user controls. Do not claim that data is never shared externally without verifying the companion application's actual behavior. Include the required Chrome Web Store Limited Use disclosure on an extension-owned website.
- Confirm the required pre-install disclosure and affirmative informed consent for the default-enabled sharing and automation behavior. The current popup controls alone have not been established as satisfying this requirement.
- Provide a public support contact or URL, the actual website if used, a 128×128 store icon and at least one truthful screenshot of the finished extension. Google also requires a 128×128 icon in the extension ZIP; the current manifest declares only a 48-pixel icon. Verify all required dashboard fields and publisher details.
- A first store item receives its own extension ID. Before presenting the extension as usable, verify that the matching Host/native-host registration admits that exact store ID without weakening its identity checks. Do not alter an existing installation's identity or settings as a workaround.
- Google requires [developer registration](https://developer.chrome.com/docs/webstore/register/), the [first-item dashboard workflow](https://developer.chrome.com/docs/webstore/publish/), and accurate [privacy disclosures](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/). Review the current [program policies](https://developer.chrome.com/docs/webstore/program-policies/policies) before submission.

## Public package 1.0.2

The public package no longer declares sidePanel, userScripts or optional host permissions, and has no user-script execution or consent UI. Its built-in reader rejects recognized password, verification-code and payment-card inputs even when legacy settings contained a sensitive-input grant.

Replace earlier store descriptions mentioning sensitive-input grants or temporary user scripts. For remote-code disclosure, this public package bundles its extension logic and does not include the previous user-script executor; do not reuse the old explanation about executing scripts supplied by the companion. The complete data disclosures must still reflect ordinary webpage content and companion processing.
