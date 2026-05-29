import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";
import type { ReactNode } from "react";
import { styles } from "./theme";

export interface EmailLayoutProps {
  /** Inbox preview text (hidden in the body). */
  preview: string;
  /** Visible H1. */
  heading: string;
  children: ReactNode;
  /** Closing reassurance line; defaults to the generic ignore-if-unexpected note. */
  footerNote?: string;
}

/**
 * Shared chrome for every transactional email: the abadge wordmark, a heading,
 * the per-email body, and a muted footer. Keeps the templates to just their
 * unique content.
 */
export function EmailLayout({ preview, heading, children, footerNote }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Text style={styles.brand}>abadge</Text>
          <Heading as="h1" style={styles.heading}>
            {heading}
          </Heading>
          {children}
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            {footerNote ??
              "If you didn't request this, you can safely ignore this email — no action is taken until the link above is used."}
          </Text>
          <Text style={styles.footer}>abadge — the credential control plane for AI agents.</Text>
        </Container>
      </Body>
    </Html>
  );
}
