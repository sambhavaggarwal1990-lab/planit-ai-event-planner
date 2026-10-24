import http from "node:http";
import { createApp } from "./src/app.js";

const PORT = Number(process.env.PORT) || 3000;
const server = http.createServer(createApp());
server.requestTimeout = 15_000;
server.listen(PORT, () => console.log(`Plan·it running at http://localhost:${PORT}`));
