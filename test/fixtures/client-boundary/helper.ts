// Fixture: módulo intermedio "inocente" que arrastra código de servidor.
import { getEnv } from "@/lib/env";

export const leak = () => getEnv().SESSION_SECRET.length;
