# This image is built in CI with network access. Runtime builds NEVER have
# network access; only official CLI + a pinned AVR platform are preinstalled.
FROM debian:bookworm-slim

ARG ARDUINO_CLI_VERSION=1.5.1
ARG ARDUINO_AVR_CORE_VERSION=1.8.6

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ENV ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_DOWNLOADS=/opt/arduino/downloads \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/user \
    HOME=/tmp

RUN curl --fail --location --show-error --silent --retry 3 \
      "https://github.com/arduino/arduino-cli/releases/download/v${ARDUINO_CLI_VERSION}/arduino-cli_${ARDUINO_CLI_VERSION}_Linux_64bit.tar.gz" \
      -o /tmp/arduino-cli.tar.gz \
    && tar -xz -C /usr/local/bin -f /tmp/arduino-cli.tar.gz arduino-cli \
    && rm /tmp/arduino-cli.tar.gz \
    && mkdir -p "$ARDUINO_DIRECTORIES_DATA" "$ARDUINO_DIRECTORIES_DOWNLOADS" "$ARDUINO_DIRECTORIES_USER" \
    && arduino-cli core update-index \
    && arduino-cli core install "arduino:avr@${ARDUINO_AVR_CORE_VERSION}" \
    && chmod -R a+rX /opt/arduino \
    && rm -rf "$ARDUINO_DIRECTORIES_DOWNLOADS"/*

# The host farm invokes this with a numeric, unprivileged UID and mounts only a
# private per-job /job directory. The Docker daemon must stay on a separate,
# operator-controlled host: never publish its socket to the web app.
ENTRYPOINT ["/usr/local/bin/arduino-cli"]
