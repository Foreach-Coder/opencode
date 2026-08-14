FROM alpine AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++ ripgrep

FROM base AS build-amd64
# brand:start
COPY dist/__PRODUCT_SLUG__-linux-x64-baseline-musl/bin/__PRODUCT_CLI__ /usr/local/bin/__PRODUCT_CLI__

FROM base AS build-arm64
COPY dist/__PRODUCT_SLUG__-linux-arm64-musl/bin/__PRODUCT_CLI__ /usr/local/bin/__PRODUCT_CLI__

ARG TARGETARCH
FROM build-${TARGETARCH}
RUN __PRODUCT_CLI__ --version
ENTRYPOINT ["__PRODUCT_CLI__"]
# brand:end
