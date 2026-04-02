import { createBetterAuthClient } from "@abadge/auth/client";
import { clientEnv } from "@abadge/env/client";

export type { SocialProvider } from "@abadge/auth/client";
export { SOCIAL_PROVIDERS } from "@abadge/auth/client";

export const authClient = createBetterAuthClient(clientEnv.NEXT_PUBLIC_API_URL);
