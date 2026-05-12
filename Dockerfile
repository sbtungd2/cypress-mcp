FROM cypress/included:13.15.0

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# Default: run MCP server via stdio
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--transport", "stdio", "--browser", "chrome"]
