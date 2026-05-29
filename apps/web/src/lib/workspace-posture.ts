/**
 * Personal-vs-custody copy for the dashboard, in one tested place.
 *
 * The product runs in two postures:
 *
 * - **Custody mode** (team organizations): the operator holds credentials on
 *   behalf of the org's users and agents. The dashboard never reveals
 *   plaintext — secrets flow only to authorized agents through the firewall.
 * - **Personal vault** (personal accounts): the user owns every secret. There
 *   is no "on behalf of" — they can reveal their own values, and the UI must
 *   not present the custody framing.
 *
 * Centralizing the copy here keeps the two postures from drifting apart across
 * the overview, profiles, items, and settings surfaces. Functional gates that
 * follow from the posture (owner-reveal on the item page, hiding member
 * management) read `isPersonal` directly at their call sites.
 */
export interface WorkspacePosture {
  /** Overview posture banner body. */
  banner: string;
  /** Overview "profiles" summary-card label. */
  profilesCardLabel: string;
  /** Profiles page subtitle. */
  profilesSubtitle: string;
  /** Settings noun, title case — section heading and field label. */
  accountNoun: string;
  /** Settings noun, lower case — sentence copy and buttons. */
  accountNounLower: string;
}

const PERSONAL: WorkspacePosture = {
  banner:
    "Your personal vault. These secrets are yours — they stay encrypted at rest, and only the agents you authorize can use them. You can reveal your own values anytime from an item’s page.",
  profilesCardLabel: "Profiles",
  profilesSubtitle: "Encryption boundaries that organize your own secrets.",
  accountNoun: "Account",
  accountNounLower: "personal account",
};

const CUSTODY: WorkspacePosture = {
  banner:
    "Custody mode active. You manage permissions and audit access on behalf of your users — you cannot view their secret values. Only authorized agents can access decrypted data.",
  profilesCardLabel: "Profiles under custody",
  profilesSubtitle: "Credential namespaces under your custody — one per user or entity.",
  accountNoun: "Organization",
  accountNounLower: "organization",
};

export function workspacePosture(isPersonal: boolean): WorkspacePosture {
  return isPersonal ? PERSONAL : CUSTODY;
}
