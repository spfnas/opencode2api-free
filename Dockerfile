FROM node:22-alpine
RUN apk add --no-cache ca-certificates
WORKDIR /app
RUN npm install -g tsx
COPY package.json .
RUN npm install
COPY gate.ts .
COPY public/ public/
CMD ["npx", "tsx", "gate.ts"]
