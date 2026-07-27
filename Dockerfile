FROM opencode-gate:latest
COPY gate.ts /app/gate.ts
COPY public/ /app/public/
CMD ["npx", "tsx", "gate.ts"]
