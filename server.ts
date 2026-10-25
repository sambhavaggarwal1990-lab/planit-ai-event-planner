import { existsSync } from "node:fs";
import http from "node:http";
import { createApp } from "./src/app.ts";

// Node 22+ can read a local .env file itself, so no extra package or flag is needed.
if (existsSync(".env")) process.loadEnvFile();

const port = Number(process.env.PORT) || 3000;
const server = http.createServer(createApp());
server.requestTimeout = 15_000;
server.listen(port, () => console.log(`Plan·it running at http://localhost:${port}`));
