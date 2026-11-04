# Fallback settings copy verification

Main 101877c8d supports chief backups within the same runtime. The settings copy still said chief turns never switch. The updated browser expectation first failed against that copy; red-context.md records the expected and actual text.

The Chinese source, English translation and model fallback spec now describe the same behavior: plan and build can switch; chief backups stay within the runtime; review, verify and merge never switch. Model execution behavior is unchanged by this follow-up.

All 12 fallback settings browser cases passed against the isolated live server with test-configured model sources. All 25 chief queue/stop server cases passed, including a regression that records the effective provider when capacity parks a chief with no backup. Model/provider execution is simulated; no real-provider or production deployment claim is made.

The screenshot is the actual isolated server settings page. No omarchy process, service or in-flight branch was changed for this follow-up.
