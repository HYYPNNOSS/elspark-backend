# backend/Dockerfile

FROM node:20.3.0


WORKDIR /backend


COPY package*.json ./
RUN npm install --include=dev

COPY . .


RUN npx prisma generate


EXPOSE 8080


CMD ["npx", "ts-node", "src/index.ts"]
