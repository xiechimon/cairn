ARG COMPUTER_BASE_IMAGE
FROM ${COMPUTER_BASE_IMAGE}

USER root
RUN set -eu; \
    expected_node_major=$(sed -n 's/^node_major=\([0-9][0-9]*\)$/\1/p' /etc/cairn-orb-image); \
    test -n "$expected_node_major"; \
    test "$(id -u user)" = 1000; \
    pacman -Syu --noconfirm --needed xorg-server-xvfb x11vnc fluxbox xdotool chromium imagemagick; \
    node -e 'if (process.versions.node.split(".")[0] !== process.argv[1]) process.exit(1)' "$expected_node_major"; \
    rm -f /etc/sudoers.d/user; \
    rm -rf /var/cache/pacman/pkg/* /var/lib/pacman/sync/*; \
    install -d -o root -g root -m 755 /etc/chromium/policies/managed; \
    install -d -o user -g user -m 700 /run/cairn-computer

COPY --chmod=0644 chromium-policy.json /etc/chromium/policies/managed/cairn.json
COPY --chmod=0755 entry.sh /usr/local/bin/cairn-computer-entry
COPY --chmod=0755 desktop.sh /usr/local/bin/cairn-computer-desktop

ARG RECIPE_HASH
RUN test -n "$RECIPE_HASH" \
 && printf 'recipe=%s\nuser=user\nhome=/home/user\n' "$RECIPE_HASH" > /etc/cairn-orb-computer-image

ENV CAIRN_ORB=1
ENV DISPLAY=:1
USER user
WORKDIR /home/user
CMD ["/usr/local/bin/cairn-computer-entry"]
