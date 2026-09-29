import { createHmac } from "node:crypto";

export const signPayload = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
