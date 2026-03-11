FROM denoland/deno:1.41.0

WORKDIR /app

COPY index.ts .
COPY .env.example .

RUN apt-get update && apt-get install -y \
    wireguard-tools \
    iproute2 \
    && rm -rf /var/lib/apt/lists/*

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-run", "--allow-read", "--allow-write", "index.ts"]
