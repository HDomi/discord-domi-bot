# Node.js의 공식 이미지를 기반으로 합니다.
FROM node:20-alpine AS deps

# 작업 디렉토리를 설정합니다.
WORKDIR /usr/src/app

# package.json과 package-lock.json을 복사합니다.
COPY package*.json ./

# 의존성을 설치합니다.
RUN npm install

# 애플리케이션 소스 코드를 복사합니다.
COPY . .

# 환경 변수를 설정합니다. (필요에 따라 수정)
ENV NODE_ENV=production
ENV DISCORD_TOKEN=$DISCORD_TOKEN
ENV CLIENT_ID=$CLIENT_ID
ENV PORT=5539

# 애플리케이션을 실행합니다.
CMD ["node", "index.js"]