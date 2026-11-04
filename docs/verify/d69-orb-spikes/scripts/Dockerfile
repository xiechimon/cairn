FROM docker.io/library/archlinux:latest
RUN pacman -Syu --noconfirm sudo bubblewrap socat curl \
 && pacman -Scc --noconfirm \
 && useradd -m -u 1000 -s /bin/bash user \
 && install -d -m 0750 /etc/sudoers.d \
 && echo 'user ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/user \
 && chmod 0440 /etc/sudoers.d/user
USER user
WORKDIR /home/user
