import { createNotificationBackend } from "./backend.ts";
import { createNotificationHandler } from "./handler.ts";

Deno.serve(createNotificationHandler(createNotificationBackend()));
