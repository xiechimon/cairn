FROM docker.io/library/archlinux@sha256:ece6c971fec3c532fd508bce299a446deaf469feecbfe7c353e995bc1a5e7bba AS base

ARG NODE_MAJOR
ARG CLAUDE_VERSION
ARG CODEX_VERSION
ARG PNPM_VERSION
ARG USER_UID=1000

RUN set -eu; \
    test -n "$NODE_MAJOR" -a -n "$CLAUDE_VERSION" -a -n "$CODEX_VERSION" -a -n "$PNPM_VERSION"; \
    pacman -Syu --noconfirm; \
    node_package=$(pacman -Ss '^nodejs(-lts-[a-z]+)?$' | awk -v major="$NODE_MAJOR" '$1 ~ /^extra\/nodejs/ { split($2, version, "."); if (version[1] == major) { sub("^extra/", "", $1); print $1; exit } }'); \
    test -n "$node_package" || { echo "No Arch package provides Node $NODE_MAJOR" >&2; exit 1; }; \
    pacman -S --noconfirm --needed base git "$node_package" npm openssh ca-certificates curl bubblewrap socat python sudo tmux; \
    rm -rf /var/cache/pacman/pkg/* /var/lib/pacman/sync/*

RUN set -eu; \
    useradd --uid "$USER_UID" --create-home --shell /bin/bash user; \
    printf '%s\n' 'user ALL=(ALL) NOPASSWD:ALL' 'Defaults env_keep += "HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY no_proxy"' > /etc/sudoers.d/user; \
    chmod 0440 /etc/sudoers.d/user; \
    visudo -cf /etc/sudoers.d/user

RUN set -eu; \
    node -e 'const [major, minor] = process.versions.node.split(".").map(Number); const expected = Number(process.argv[1]); if (major !== expected || major < 22 || (major === 22 && minor < 19)) { console.error(`Node ${process.versions.node} must match major ${expected} and be >=22.19`); process.exit(1); }' "$NODE_MAJOR"; \
    npm install --global --ignore-scripts --no-audit --no-fund "@anthropic-ai/claude-code@$CLAUDE_VERSION" "@openai/codex@$CODEX_VERSION" "pnpm@$PNPM_VERSION"; \
    claude_package="$(npm root --global)/@anthropic-ai/claude-code"; \
    test -f "$claude_package/install.cjs" || { echo 'Claude Code package has no install.cjs; cannot place its native binary' >&2; exit 1; }; \
    (cd "$claude_package" && node install.cjs); \
    rm -rf /root/.npm /root/.cache; \
    test "$(runuser -u user -- claude --version | awk 'NR == 1 {print $1}')" = "$CLAUDE_VERSION"; \
    test "$(runuser -u user -- codex --version | awk 'NR == 1 {print $NF}')" = "$CODEX_VERSION"; \
    test "$(cd /tmp && runuser -u user -- pnpm --version)" = "$PNPM_VERSION"; \
    runuser -u user -- bwrap --version > /dev/null; \
    runuser -u user -- socat -V > /dev/null; \
    runuser -u user -- python3 --version > /dev/null; \
    runuser -u user -- tmux -V > /dev/null

RUN set -eu; \
    install -d -o root -g root -m 755 /var/lib/cairn-claude; \
    install -d -o root -g user -m 1770 /var/lib/cairn-claude/config; \
    printf '%s\n' '{"sandbox": {"enableWeakerNestedSandbox": true}}' > /var/lib/cairn-claude/config/settings.json; \
    chown root:root /var/lib/cairn-claude/config/settings.json; \
    chmod 644 /var/lib/cairn-claude/config/settings.json

COPY --chmod=0755 entry.sh /usr/local/bin/cairn-orb-entry

ARG RECIPE_HASH
RUN test -n "$RECIPE_HASH" \
 && printf 'recipe=%s\nclaude=%s\ncodex=%s\npnpm=%s\nnode_major=%s\nagent_uid=%s\n' "$RECIPE_HASH" "$CLAUDE_VERSION" "$CODEX_VERSION" "$PNPM_VERSION" "$NODE_MAJOR" "$USER_UID" > /etc/cairn-orb-image

ENV CLAUDE_CONFIG_DIR=/var/lib/cairn-claude/config
USER user
WORKDIR /home/user
CMD ["/usr/local/bin/cairn-orb-entry"]
