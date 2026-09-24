import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./src/store.js";
import { createApp } from "./src/wiring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, "data", "core-slices.json");
const port = Number(process.env.PORT || 3025);

const store = new Store(dbPath);
const { server } = createApp(store);

server.listen(port, () => console.log(`Core slice lab app listening on http://localhost:${port}`));
