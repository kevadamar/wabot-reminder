# 4. Headless Link Inspection in a Separate Service

Links in user messages are opened by headless Chromium in a separate `link-inspector` service. The result is checked by local rules, Google Safe Browsing, and the LLM, and is sent to the user as a follow-up message.

## Context

The risk check (judol, scam, phishing, malware) only looked at the message text and the link's domain. A short link or a new domain says little about the page behind it. Users asked the bot to visit the page and judge it.

A plain `fetch` from the bot has two problems. First, it is an SSRF risk: a link (or a redirect, or page JavaScript) could reach internal services, the Docker network, or cloud metadata. Second, many phishing and gambling pages hide their content from non-browser clients and from obvious headless browsers, so a `fetch` would see a harmless page.

## Decision

- **Separate service.** `src/link-inspector/` runs Playwright Chromium in its own container (`Dockerfile.link-inspector`; `docker-compose.link-inspector.yml` deploys it alone on Dokploy). It has no public port, a bearer token on `POST /inspect`, non-root user, read-only filesystem, `cap_drop: ALL`, and memory/pid limits. Rendering untrusted pages never happens in the bot process.
- **Guard proxy for every request.** Each inspection starts a local forward proxy and points the browser context at it. The proxy resolves DNS, rejects the target if any address is non-public or the name is internal, then connects to the checked IP. This defeats DNS rebinding and also covers redirects and in-page requests. The browser's global proxy points at a dead port, so a context without the guard cannot reach anything.
- **Natural browser profile.** Real Chromium (new headless) with an Android Chrome profile: user agent, `Sec-CH-UA` client hints, `id-ID` language, Jakarta time zone, touch viewport, and `navigator.webdriver=false`. The server's datacenter IP remains visible; an optional upstream proxy (`LINK_CHECK_PROXY_URL`) can route traffic through a residential IP. The SSRF check runs before the upstream proxy.
- **Three judges.** Local page rules (brand impersonation with a login form, OTP/PIN/card forms, APK downloads, gambling titles, suspicious redirect targets, links that lead into the internal network, government/ISP block pages) and Google Safe Browsing flag on their own.
- **DNS.** By default the inspector uses the host resolver. Indonesian ISPs intercept plain DNS and answer blocked domains with an *Internet Positif* notice; that notice is flagged as `blocked` (the site is on the Komdigi/TrustPositif list) rather than judged as a normal page. `INSPECTOR_DNS=doh` resolves over DNS-over-HTTPS so the real page can be judged. It is opt-in because it bypasses the ISP's DNS filter. The `link_review` LLM operation sees page text and screenshot as untrusted data and can only raise the verdict.
- **Asynchronous follow-up.** The task is saved and confirmed first. When the check finds a dangerous link, the task moves to `pending_risk_confirmation` and the user replies *lanjut* or *batal*, reusing the existing risk flow.
- **Opt-in.** `LINK_CHECK_ENABLED=false` by default. Popular domains and `LINK_CHECK_ALLOWLIST` are skipped, except user-content hosts (Google Docs/Forms/Sites, etc.) and redirector URLs.

## Consequences

- One more container (Chromium image, about 1 GB RAM limit). Inspection takes 2–5 s plus 5–40 s for the LLM, which is why the check is asynchronous and has its own budget (`LLM_LINK_BUDGET_MS`).
- A task can be active for a short time before a late verdict puts it on hold.
- The Chromium sandbox is off by default because many hosts block user namespaces; isolation relies on the container. `INSPECTOR_CHROMIUM_SANDBOX=true` turns it on where supported.
- Google Safe Browsing Lookup API is free for non-commercial use only. Commercial deployments need Web Risk or should leave the key empty.
- Visiting a link can confirm to the sender that it was opened (tracking links). The inspector carries no cookies or user data, and the request comes from the server, not the user's phone.
