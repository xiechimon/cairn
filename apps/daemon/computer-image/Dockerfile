FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS node

FROM node AS packages
ARG TARGETARCH
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    case "$TARGETARCH" in \
      arm64) agent=agent-browser-linux-arm64 ;; \
      amd64) agent=agent-browser-linux-x64 ;; \
      *) echo "unsupported architecture $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/agent-browser.tgz https://registry.npmjs.org/agent-browser/-/agent-browser-0.41.2.tgz; \
    [ "$(node -p "require('crypto').createHash('sha512').update(require('fs').readFileSync('/tmp/agent-browser.tgz')).digest('base64')")" = '/agCKB5rw1EEK8SKWo4zid7a5kOwlclqALC0P3c69buJvKdhrl/dJkKdfLqGGaiNIbWzRdqqT0PxZVkwVEf2fg==' ]; \
    mkdir -p /opt/agent-browser /opt/cloak; \
    tar -xzf /tmp/agent-browser.tgz -C /tmp "package/bin/$agent"; \
    install -m 755 "/tmp/package/bin/$agent" /opt/agent-browser/agent-browser; \
    cd /opt/cloak; \
    npm install --ignore-scripts --legacy-peer-deps --no-audit --no-fund --omit=dev cloakbrowser@0.7.2

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/home/agent/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PIP_USER=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    NPM_CONFIG_PREFIX=/home/agent/.local
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      xvfb x11vnc openbox picom hsetroot xdotool dbus-x11 libglib2.0-bin \
      chromium lxterminal fonts-noto-cjk fonts-noto-color-emoji \
      fonts-freefont-ttf fonts-unifont fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf \
      fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea \
      adwaita-icon-theme gnome-themes-extra \
      ca-certificates curl procps nftables util-linux earlyoom x11-apps netpbm \
      git python3 python3-pip python3-venv jq ripgrep fd-find unzip zip less; \
    case "$TARGETARCH" in \
      arm64) plank=bea8743bffbf924740240e4e59d578028b099cceba6b491f0689ccd24f689465 ;; \
      amd64) plank=aaa055faffda483b64f24e1f130fc039f99f18da87c6c3c30210c748e0c8d3e6 ;; \
      *) echo "unsupported architecture $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/plank-reloaded.deb "https://github.com/zquestz/plank-reloaded/releases/download/0.11.178/plank-reloaded-debian_0.11.178-1_${TARGETARCH}.deb"; \
    echo "$plank  /tmp/plank-reloaded.deb" | sha256sum -c -; \
    apt-get install -y --no-install-recommends /tmp/plank-reloaded.deb \
      libdbusmenu-glib4 libdbusmenu-gtk3-4 libgee-0.8-2 libbamf3-2 bamfdaemon libwnck-3-0 \
      libgnome-menu-3-0 libcanberra0 libcanberra-gtk3-0 libgtk-3-0 libxml2; \
    rm -rf /var/lib/apt/lists/* /tmp/plank-reloaded.deb /usr/share/applications/chromium.desktop; \
    ln -s /usr/bin/fdfind /usr/local/bin/fd; \
    mkdir -p /etc/skel/.local/bin; \
    useradd -m -u 1000 -s /bin/bash agent; \
    find / -xdev -type f -perm /6000 -exec chmod a-s {} +
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm; \
    ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=packages /opt/agent-browser /opt/agent-browser
COPY --from=packages /opt/cloak /opt/cloak
COPY guard.nft /etc/cairn/guard.nft
COPY agent-env.sh /etc/profile.d/cairn-agent.sh
COPY cloak.mjs /opt/cloak/cloak.mjs
COPY cairn-browser.desktop cairn-chromium.desktop /usr/share/applications/
COPY --chmod=755 entry.sh /usr/local/bin/cairn-entry
COPY --chmod=755 desktop.sh /usr/local/bin/cairn-desktop
COPY --chmod=755 browser.sh /usr/local/bin/cairn-browser
COPY --chmod=755 agent-browser.sh /usr/local/bin/agent-browser
WORKDIR /home/agent
CMD ["/usr/local/bin/cairn-entry"]
