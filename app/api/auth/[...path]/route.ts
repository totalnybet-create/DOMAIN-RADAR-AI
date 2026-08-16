import { auth } from "@/lib/auth/server";

export const runtime = "nodejs";
export const { GET, POST } = auth.handler();
