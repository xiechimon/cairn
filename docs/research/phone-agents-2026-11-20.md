# Phone agents on real Android and iPhone devices

Status: research, 2026-11-20. No product code changed. Question (owner): Cairn agents already drive the runner Mac through `computer_observe`/`computer_act` and `user_computer_observe`/`user_computer_act`. How do the phone agents in the wild drive a phone? The owner wants his real phones, not simulators: `为什么要用模拟器，我有真的机器`. The target devices are a Google Pixel 8a and an iPhone 15 Pro. The runner is a MacBook Air M2 (Mac14,2) with Xcode installed.

Evidence labels: `实测` means read or run first-hand in this session (source code, official docs, commands on the runner Mac). `推断` means it follows from `实测` facts. `猜测` means everything else. Links were read on 2026-11-20 unless a date says otherwise.

Builds on: [`user-computer-model-2026-11-08.md`](user-computer-model-2026-11-08.md), [`agent-computer-cross-platform-2026-11-17.md`](agent-computer-cross-platform-2026-11-17.md) and [`../design/own-mac-computer.md`](../design/own-mac-computer.md).

## 1. Facts measured on the runner Mac

| Fact | Label |
|---|---|
| macOS 27.2, Xcode 27.2 (27B52), model `Mac14,2`. `/System/Applications/iPhone Mirroring.app` is present. | `实测` |
| `xcrun devicectl list devices` lists the owner's iPhone 15 Pro (`iPhone16,1`) as `available (paired)`, physical. | `实测` |
| `devicectl device info details` reports iOS **27.2.1**, Developer Mode **Enabled**, transport `localNetwork` (Wi-Fi, no cable), and a CoreDevice tunnel. It also reports the capabilities `Capture Screenshot`, `View Device Screen`, `HID Digitizer`, `HID Keyboard`, `HID Button`, `HID Scroll` and `UniversalHIDService`. | `实测` |
| `xcrun devicectl device capture screenshot --device <udid>` over Wi-Fi returned a 1179×2556 PNG in **1.94 s** wall time. Nothing was installed on the phone. The phone showed Control Center at the time (it was probably locked), and the frame still came back. | `实测` |
| `devicectl` 27.2 has `capture screenshot` and `capture screen-record`, but no public touch or typing subcommand. Its `device` subcommands are appResize, capture, copy, info, install, notification, orientation, pairings, pasteboard, process, profile, reboot, rename, settings, simulate, sysdiagnose and uninstall. | `实测` |
| `adb` is installed (`/opt/homebrew/bin/adb`). No Android device was attached during this session, so the Pixel was not measured. | `实测` |

## 2. Comparison

"Reach" means how the agent reaches a real device. "Observe" means what the model gets each step. "Act" means how input is injected.

| Source | Reach (real device) | Observe | Act | User setup | Breaks / limits | Safety model | License | Link |
|---|---|---|---|---|---|---|---|---|
| **Mika** (wangzan101, 9.2k★, pushed 2026-11-20) | The agent runs **on the Android phone**. The app pairs with the phone's own Wireless debugging and starts a helper as the `shell` user through `app_process` (`CLASSPATH=<apk> app_process … HelperMain`), so no computer is needed. Fallbacks are Shizuku, root (`su 2000`) or a one-time USB script (`实测`, `HelperProcess.kt`, `HelperHandoff.kt`) | Accessibility tree first, with refs, parent context and a `treeQuality` flag. On-device OCR lines (`visibleText`) fill gaps. Screenshots only when the tree is missing or ambiguous (`实测`, `prompts/capabilities/phone.md`) | Element refs from the tree. Normalized 0–999 coordinates as a fallback. Typing goes through paste. Has composite tools (`phone_collect`, `phone_find`, `phone_run`) and intent tools (alarm, calendar, share) (`实测`, `PhoneAutomationTools.kt`, `prompts/tools/phone_*.md`) | Android 12+ (14+ recommended). Turn on Developer options, USB debugging and Wireless debugging, pair once with the 6-digit code. Mika then enables its own accessibility service, which gets around the "restricted setting" block on sideloaded APKs (`实测`, `docs/setup-guide.en.md`) | Acts on a **separate virtual display** (`AgentDisplay.kt`, an `ImageReader`-backed VirtualDisplay), so the owner keeps using the phone. Wireless debugging switches off after a reboot or Wi-Fi change; Mika turns it back on when allowed. Payment and password screens block capture, so Mika hands those to the user (`实测`, README FAQ) | "Ask" mode confirms only the steps that spend money. Logins, codes and payment passwords are always handed to the user. Scheduled runs skip money-spending steps (`实测`, `docs/modes.en.md`) | Apache-2.0 | [repo](https://github.com/wangzan101/Mika) |
| Mika as an **MCP server** for a computer | `adb shell sh …/connect-computer.sh`, then `adb forward tcp:8765 tcp:8765`, then Streamable HTTP with a Bearer token. Also works over LAN or VPN (`实测`, `docs/mcp.en.md`) | Goal level only: `mika_run_task`, `mika_wait_task`, `mika_answer`, `mika_steer_task` | The phone decides every step | Mika setup plus adb | The computer cannot approve payments or takeovers; only the phone can (`实测`) | Same as above | Apache-2.0 | [mcp.en.md](https://github.com/wangzan101/Mika/blob/main/docs/mcp.en.md) |
| **Open-AutoGLM** (Zhipu, 26.6k★) | Android: adb over USB, or `adb connect ip:5555` after `adb tcpip`. HarmonyOS: `hdc`. iPhone: **WebDriverAgent** built in Xcode, with `iproxy 8100` or the WDA URL over Wi-Fi (`实测`, README, `docs/ios_setup/ios_setup.md`) | Screenshot only, read by the VLM `autoglm-phone-9b` | Coordinates: Tap, Swipe, Long Press, Double Tap, Type, Launch, Back, Home, Wait, plus `Take_over` (`实测`) | Android: Developer options, USB debugging, **ADB Keyboard** IME for text, and on some phones "USB debugging (security settings)". iPhone: Xcode signing (a free account works), trusting the developer app, Settings → Developer → UI Automation (`实测`) | A black screenshot on payment, password or bank screens makes it request a takeover. TCP/IP mode is lost on reboot (`实测`, FAQ) | `confirmation_callback` for sensitive actions, `takeover_callback` for login and captcha (`实测`) | Apache-2.0 code | [repo](https://github.com/zai-org/Open-AutoGLM) |
| **Mobile-Agent v3 / v3.5** (Alibaba, GUI-Owl) | adb over USB on Android, hdc on HarmonyOS. The README says **iOS is not supported** (`实测`, `Mobile-Agent-v3/README.md`). v3.5 is also offered on Wuying cloud phones (`实测`) | Screenshot, with a multi-agent planner, reflector and memory | Coordinates from GUI-Owl | ADB Keyboard as the default IME, plus "USB debugging (security settings)" on HyperOS | No iPhone | none documented | MIT | [repo](https://github.com/X-PLUG/MobileAgent), [arXiv 2508.15144](https://arxiv.org/abs/2508.15144) |
| **UI-TARS** / UI-TARS-desktop (ByteDance) | The `@gui-agent/operator-adb` package talks to the device over adb (`实测`) | Screenshot. The model emits `click(start_box=…)` on a 0–1000 grid; the `MOBILE_USE` template adds `long_press`, `open_app`, `press_home` and `press_back` (`实测`, README) | Taps and swipes go through adb `input`. Unicode text and a screenshot fallback go through **yadb**, a 12 kB `app_process` jar pushed to `/data/local/tmp`, so no IME install is needed (`实测`, `AdbOperator.ts`) | adb only | No iPhone operator | none in the operator | Apache-2.0 | [UI-TARS](https://github.com/bytedance/UI-TARS), [operator-adb](https://github.com/bytedance/UI-TARS-desktop/tree/main/multimodal/gui-agent/operator-adb) |
| **AppAgent** (Tencent, last push 2025-03) | adb (USB) or an emulator | Screenshot with numeric labels drawn from the XML hierarchy, or a grid overlay | Labelled element taps, grid taps | adb | Research code, unmaintained | none | MIT | [repo](https://github.com/TencentQQGYLab/AppAgent) |
| **Mobilerun** (formerly DroidRun, 10k★) | Android: adb plus the **Portal** app (an accessibility service reached through a ContentProvider over `adb shell content query`, or HTTP on device port 8080 via `adb forward`), or adb-only with UIAutomator. iPhone: the closed-source `mobilerun-ios` CLI over USB (`实测`, [device setup](https://docs.mobilerun.ai/framework/guides/device-setup)) | Accessibility tree plus screenshot; `--vision-only` for apps without a tree (`实测`) | Tree-indexed taps, gestures, Unicode text through the Portal keyboard (adb-only text is ASCII) (`实测`) | `mobilerun setup` installs Portal and enables its accessibility service. iPhone: Developer Mode, DDI mount, WDA signed with the user's Apple account; **iOS 27+ can use "native control" with nothing installed** (`实测`, [mobilerun-ios overview](https://docs.mobilerun.ai/mobilerun-ios/overview)) | WDA with a free Apple account: the profile expires in **7 days**; a paid team gets 1 year (`实测`, [WDA signing](https://docs.mobilerun.ai/mobilerun-ios/wda-signing)). Native mode does not yet cover deep links without an app or the on-device proxy | Bearer token on the local Portal API | MIT (framework); iOS CLI closed | [repo](https://github.com/droidrun/mobilerun) |
| **mobile-mcp** (Mobile Next, 10.7k★) | Android: adb. iPhone: **go-ios tunnel + WebDriverAgent on :8100** (`实测`, `src/ios.ts`) | Accessibility first (`uiautomator dump` on Android, the WDA source on iOS), screenshot fallback (`实测`, `src/android.ts`, README) | Element refs or coordinates. `adb shell input` is ASCII-only; the code notes this (`实测`) | adb plus USB debugging; iPhone trusted plus WDA | iOS needs the tunnel, the port forward and a running WDA; each failure has its own error (`实测`) | none in the server | Apache-2.0 | [repo](https://github.com/mobile-next/mobile-mcp) |
| **minitap mobile-use** | adb (USB or Wi-Fi). iOS simulators via `idb`; **physical iOS is not supported** (`实测`, README) | Accessibility tree plus screenshot | Tree-based | adb | Weak on games, which have no tree | none | Apache-2.0 | [repo](https://github.com/minitap-ai/mobile-use) |
| **Appium MCP** | Embedded UiAutomator2 (Android) and XCUITest (iOS) drivers. `appium_prepare_ios_real_device` signs WDA (`实测`, README) | Page source plus screenshot; an optional `appium_ai` vision locator | Locators (id, xpath, accessibility id) | Developer Mode, Apple ID in Xcode | Same WDA signing as above | none | Apache-2.0 | [repo](https://github.com/appium/appium-mcp) |
| **scrcpy** | adb over USB or TCP. `--new-display` creates a **virtual display** that apps can run on (`实测`, `doc/virtual-display.md`) | H.264 video stream, 35–70 ms latency (`实测`, README) | Injects touch and keys as the shell user; UHID keyboard | USB debugging | FLAG_SECURE windows render black (Android docs below) | n/a | Apache-2.0 | [repo](https://github.com/Genymobile/scrcpy) |
| **pymobiledevice3** | iOS 17+ RemoteXPC tunnel without root. Screenshots and the accessibility audit service through the DDI. **Screen mirroring with touch, keys and clipboard only on iOS 27+**, using "the same live video stream Xcode's device window uses" (`实测`, `docs/guides/screen-mirroring.md`). The touch HID report formats were decoded by sniffing Xcode mirror sessions (`实测`, `remote/core_device/hid_service.py`) | Video or screenshot; accessibility tree via `accessibilityaudit` | HID digitizer reports (private, reverse-engineered) | Developer Mode plus a mounted DDI; nothing installed on the phone | Private protocol, so it can break on an Xcode or iOS update (`推断`) | n/a | **GPL-3.0** | [repo](https://github.com/doronz88/pymobiledevice3) |
| **Apple Device Hub** (Xcode 27) | Select the physical device, then **View Screen**: an interactive live canvas. Quit apps that use the camera or mic first (`实测`, [Device Hub](https://developer.apple.com/documentation/xcode/device-hub)) | Video | Mouse and trackpad | Pairing plus Developer Mode | Reported as iOS 27+ only for physical screens (`猜测`, blog report [mjtsai](https://mjtsai.com/blog/2026/06/25/xcode-27s-device-hub/)). Not scriptable: devicectl 27.2 has no input command (`实测`) | human UI | Apple | [Device Hub](https://developer.apple.com/documentation/xcode/device-hub) |
| **macOS iPhone Mirroring** | Built into macOS 15+ (present on this Mac, `实测`). Needs the same Apple Account with 2FA, Bluetooth and Wi-Fi on, and **the iPhone locked and near the Mac**. One Mac and one iPhone. Unavailable in the EU (`实测`, [Apple support 120421](https://support.apple.com/en-us/120421)) | A Mac window, so Cairn's existing `user_computer_observe` screenshot could read it (`推断`) | Mac mouse and keyboard; Cmd-1 Home, Cmd-2 App Switcher, Cmd-3 Spotlight (`实测`) | Open the app once and unlock the phone once | "Automatically pauses the connection after periods of inactivity". Unlocking the phone stops mirroring. The phone shows that it is in use and logs the Mac that used it (`实测`) | Apple's own disclosure on the phone | Apple | [support](https://support.apple.com/en-us/120421) |
| **Claude Code iOS Simulator pane** | **Simulator only**: "'device' refers to a simulated iPhone or iPad … not physical hardware". The CLI uses computer use on the Simulator window instead. No Android emulator pane is documented (`实测`, [docs](https://code.claude.com/docs/en/desktop-ios-simulator.md)) | Live stream plus screenshots | Direct simulator control | Xcode | Not a real device | One consent per device; the docs warn not to sign in to real accounts because screenshots go to Anthropic (`实测`) | proprietary | [docs](https://code.claude.com/docs/en/desktop-ios-simulator.md) |
| **Amp** (`orb simulator serve`) | No `orb simulator serve` command exists in Amp's docs or `llms.txt` (`实测`). The documented pattern: orbs "cannot run the Android emulator" and point you to a **runner** Mac with an emulator **or a connected Android device**. A `darwin` service such as `./scripts/serve-ios-simulator` is exposed as a portal. The runner's Desktop tab streams the Mac desktop (`实测`, [portals](https://ampcode.com/docs/orbs/portals), [runners](https://ampcode.com/docs/cli/runners)). A time capsule shows a runner Mac building onto a connected iPhone (`实测`, [time capsule 2](https://ampcode.com/time-capsules/2)) | Desktop video | Desktop computer use | Runner with `--desktop` | No phone-specific tools | Anyone who can write to the thread can control the desktop (`实测`) | proprietary | as linked |
| **Doubao phone assistant** (ByteDance × nubia, Dec 2025) | Ships as a **system app with `INJECT_EVENTS`**, a signature-level permission granted by the OEM. Doubao said other assistants use this permission or accessibility (`猜测`: press reports only, no first-party technical doc found; [The Paper](https://www.thepaper.cn/newsDetail_forward_32094236), [ITHome](https://www.ithome.com/0/902/267.htm)) | Screen (VLM) | System-level input injection | Buy the phone | **WeChat stopped working** under its "operate the phone" feature; WeChat cited existing risk controls (`猜测`, press) | User authorization and visible progress (`猜测`, press) | proprietary | press links |
| **Google Gemini UI automation / AppFunctions** | Platform level. AppFunctions are app-declared functions (on-device "MCP"). The "intelligent UI automation" preview runs on Galaxy S26 and **select Pixel 10** devices, for curated food, grocery and rideshare apps in the US and Korea (`实测`, [Android blog 2026-02-25](https://developer.android.com/blog/posts/the-intelligent-os-making-ai-agents-more-helpful-for-android-apps)) | OS-internal | OS-internal | none | Not on the Pixel 8a. Not open to third-party agents yet ("share more details later this year") (`实测`) | Live view, take over any time, alert before purchases (`实测`) | proprietary | as linked |

Platform constraints that every row inherits:

- Android `FLAG_SECURE`: a window with this flag is kept "from appearing in screenshots or from being viewed on non-secure displays" (`实测`, [WindowManager.LayoutParams](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE)). Banking apps, payment pages and password fields come back black, which is why Mika and Open-AutoGLM both hand off there (`实测`).
- iOS Developer Mode is needed for any developer service, including WDA, DDI services and devicectl capture (`实测`, [Apple docs](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)).
- Apps can detect or ban automation. The Doubao case shows WeChat doing it (`猜测`, press). Mika's disclaimer says automating third-party apps "may break their terms of service" (`实测`).

## 3. Patterns

1. **Phone-resident agent** (Mika, Doubao, Gemini). The loop runs on the phone, input arrives through a privileged helper (shell via wireless adb, or a system permission), and the agent often works on a virtual display so the user keeps the phone. This gives the best UX on the phone. But Cairn's agent and approvals live on the server, and it is Android-only.
2. **Host-driven via a debug bridge** (Open-AutoGLM, Mobile-Agent, UI-TARS, AppAgent, mobile-mcp, Mobilerun, Appium). A computer holds the loop and talks adb (Android) or XCUITest/WDA (iPhone). Observation is a screenshot, or a tree plus a screenshot. Every product that supports a real iPhone takes this route, mostly through WDA (`实测`, rows above).
3. **Mirror and drive the mirror** (iPhone Mirroring, Device Hub, scrcpy window). The phone becomes a window on the Mac, and the existing desktop computer-use tools drive that window.

Cairn's runner Mac is the host in pattern 2. That matches "a phone attached to the runner Mac, exposed as another computer behind the existing tools and approval rules" (`推断`). The best tree-first products (Mika, mobile-mcp, Mobilerun) all read the accessibility tree first and screenshot second. Cairn's `user_computer_observe` already works that way: numbered accessibility elements, plus a screenshot when permitted (`实测`, `packages/shared/src/protocol/own-computer.ts`).

## 4. Recommendation

### 4.1 Android: Pixel 8a over adb from the runner Mac

**Path:** the daemon on the runner Mac drives the Pixel over adb (Wireless debugging, with USB as a fallback):

- Observe: an accessibility tree plus a screenshot. Screenshots use `adb exec-out screencap -p`. The tree uses `uiautomator dump`, and later an `app_process` helper that streams the tree faster.
- Act: element-indexed taps, with coordinates as a fallback, through `adb shell input tap|swipe|keyevent`. Unicode and Chinese text go through an `app_process` helper pushed to `/data/local/tmp`, as UI-TARS does with yadb, so the owner never has to switch IME.
- Virtual display: once the basic path works, add a dedicated virtual display (Mika's `AgentDisplay` idea, or the scrcpy `--new-display` mechanism) so the agent stops taking over the owner's screen.

This keeps the loop, the approvals and the log on Cairn's side, and needs no app installed on the phone for the first version (`推断` from the operator-adb, mobile-mcp and Open-AutoGLM rows).

Owner setup on a stock Pixel (paths follow stock Android, `实测` in Mika's setup guide and the [adb docs](https://developer.android.com/tools/adb)):

1. Settings → About phone → tap **Build number** 7 times.
2. Settings → System → Developer options → turn on **USB debugging**.
3. Developer options → **Wireless debugging** → on, and tick "Always allow on this network".
4. On the Mac, Cairn runs `adb pair <ip>:<port>` and asks for the 6-digit code shown under "Pair device with pairing code". After that, adb finds the phone through mDNS (`adb mdns services`). A cable plus "Allow USB debugging" is the fallback.
5. Keep the phone unlocked while the agent works, or turn on Developer options → **Stay awake** while charging. adb cannot enter the lock-screen PIN for you (`推断`).

Honest limits on the Pixel:

- Wireless debugging turns off after a reboot or a Wi-Fi change, so a re-pair or a cable is needed (`实测`, Mika FAQ; Open-AutoGLM FAQ for `tcpip`).
- `FLAG_SECURE` screens (bank, payment, password) come back black. The agent must call `request_takeover` there (`实测`).
- Gemini's own UI automation and the Android 17 agent APIs are not available to Cairn, and not on the 8a (`实测`, Android blog).
- Some apps may detect automation and restrict it (`猜测`, Doubao/WeChat press).
- Latency was not measured. scrcpy streams at 35–70 ms (`实测`); a screencap round trip is probably 0.3–1 s (`猜测`, measure when the Pixel is attached).

Alternative considered: install Mika and call it as an MCP server. It is fast to try, but it works at task level: Mika's own model decides every step, the approvals run on the phone and not in Cairn, and the step log lives on the phone. Keep it as a reference implementation for the virtual display and the tree-plus-OCR observation, not as Cairn's path.

### 4.2 iPhone: iPhone 15 Pro over WebDriverAgent from the runner Mac

**Path:** XCUITest through **WebDriverAgent**, built and signed with `xcodebuild … test` on the runner Mac and reached over the existing Wi-Fi CoreDevice pairing:

- Observe: the WDA `/source` accessibility tree plus a screenshot. Use `devicectl device capture screenshot` (1.94 s over Wi-Fi, `实测`) when WDA is down, as a health check.
- Act: element taps, coordinate taps, swipes, `sendKeys` text, Home and other buttons.

Why WDA: it is the one documented, public automation surface on a real iPhone, it is BSD-licensed, and every product with real-iPhone support uses it (Open-AutoGLM, mobile-mcp, Appium, Mobilerun below iOS 27) (`实测`). It also gives the accessibility tree that Cairn's tools are built around.

Owner setup on this iPhone 15 Pro (iOS 27.2.1; Developer Mode is **already on** and the phone is **already paired** over Wi-Fi, `实测`):

1. In Xcode → Settings → Accounts, sign in with an Apple Account. Cairn needs to know whether it is a free or a paid team: a free team re-signs every **7 days**, a paid team every year (`实测`, Mobilerun WDA signing).
2. Cairn builds WDA with `xcodebuild -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination 'platform=iOS,id=<udid>' test`. The first run asks the owner to do two things on the phone: Settings → General → VPN & Device Management → trust the developer app, and Settings → Developer → turn on **UI Automation** (`实测`, Open-AutoGLM iOS guide).
3. Keep the phone unlocked while the agent works. WDA shows "Automation Running" on the phone (`实测`, same guide).

Honest limits on the iPhone:

- No background or virtual screen. The agent uses the real screen while the owner watches, unlike Mika on Android (`推断`: iOS has no virtual display API for third parties).
- WDA needs the phone unlocked. Face ID, the passcode and Apple Pay always stay with the owner (`推断`).
- Screens that iOS protects from capture (the passcode entry, some DRM video) cannot be read; anything else, including banking apps, usually can (`猜测`, verify on device).
- A free-team signature expires after 7 days and must be re-signed (`实测`).
- Apps without accessibility labels (games, canvas UIs) need screenshot-and-coordinate fallback (`实测`, minitap note on games).
- No Shortcuts or Siri path gives an outside agent generic UI control (`猜测`: none of the sources offers one).

Alternatives considered for the iPhone:

- **Native CoreDevice control (iOS 27+, nothing installed).** This phone already exposes `HID Digitizer` and `UniversalHIDService` (`实测`), and Mobilerun makes this its default on iOS 27 (`实测`). But the only open implementation of the touch path is pymobiledevice3 (**GPL-3.0**, private reverse-engineered protocol), and `devicectl` 27.2 has no public input command (`实测`). Revisit when Apple ships `devicectl` input, or as a fallback that needs no signing. It is the best option to watch.
- **iPhone Mirroring plus the existing `user_computer_*` tools.** No new tool surface is needed (`推断`), but the phone must stay **locked** and near the Mac, mirroring pauses after inactivity (`实测`), and the mirrored window is probably one opaque view with no element tree (`猜测`), so the agent works by screenshot and coordinates on the owner's own Mac screen. Good for a zero-setup demo, not for the main path.
- **Simulators and emulators** stay CI-only (owner direction).

### 4.3 How it fits Cairn

- **Tool surface.** Add a phone as another computer kind next to the VM computer and the own Mac. Mirror `user_computer_observe`/`user_computer_act`, which take numbered elements plus a screenshot, rather than adding a third action language. Areas touched: `packages/shared/src/protocol/own-computer.ts` and `computer-tools.ts` (definitions), `apps/daemon/src/computer/` (a new adb and WDA backend beside `desktop-accessibility.ts` and `host-screen.ts`), `apps/server/src/services/machine-computer.ts` and `own-computer.ts` (routing and ownership), and the Computers settings panel `apps/web/src/resources/own-computer-panel.tsx`.
- **Approvals.** Reuse the own-Mac rule: every call is logged and shown, the user is asked before irreversible actions or anything that reaches other people, and the agent takes over at a login, a payment or a black secure screen through `request_takeover`. Mika's split is a tested default worth copying: ask only before spending money, and always hand off logins and codes (`实测`).
- **Privacy.** Phone screenshots go to the model provider, as Claude Code's simulator page warns (`实测`). This is the owner's real phone, so the consent screen must say so.
- **Seams.** Spawning `adb`, `xcodebuild` and `devicectl` belongs in the daemon. `apps/daemon/src/computer/` is listed under the `machineAndCommandBoundary` gate only for `command-gate.ts` (`实测`, CLAUDE.md), so a design doc and `/security-review` come before code.

## 5. Open questions for the owner

1. Is the Apple Account in Xcode a paid developer team or a free one? Recommended: use it as it is; a free team means a re-sign every 7 days, which Cairn automates.
2. Which Android version is on the Pixel 8a? It launched with Android 14 (`猜测`). Mika's virtual display wants 12+ and recommends 14+ (`实测`). Recommended: whatever it runs now; any version from 12 up works.
