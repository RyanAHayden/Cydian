# DONE: finished tasks, newest last

### Research (any time, parallel)
- [x] **R3** Answer the open questions in `docs/native.md` (the shape is decided: native shell + WKWebView running `web/app/`, rootless iOS 15+ up to the coming iOS 27 jailbreak). Main one: build both navigation spikes (one WKWebView with a JS stack and JS swipe-back, vs native UINavigationController/UITabBarController with pooled WKWebViews) and measure frame times on a ProMotion phone; also how to build on Linux, how the root helper works on rootless jailbreaks, and the JS-to-Swift bridge format. Write the answers into docs/native.md with the measurements. | files: docs/native.md, native/spike/**
