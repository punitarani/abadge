import { Button, Link, Text } from "@react-email/components";
import { EmailLayout } from "./layout";
import { type RenderedEmail, renderEmail } from "./render";
import { styles } from "./theme";

export function VerifyEmail({ url }: { url: string }) {
  return (
    <EmailLayout
      preview="Confirm your email to activate your abadge account"
      heading="Verify your email"
    >
      <Text style={styles.text}>
        Confirm this email address to activate your abadge account and start protecting your agents'
        credentials.
      </Text>
      <Button href={url} style={styles.button}>
        Verify email address
      </Button>
      <Text style={styles.fallbackLabel}>Or paste this link into your browser:</Text>
      <Link href={url} style={styles.fallbackLink}>
        {url}
      </Link>
    </EmailLayout>
  );
}

/** Render the verification email to the `{ html, text }` pair `sendEmail` expects. */
export function renderVerifyEmail(url: string): Promise<RenderedEmail> {
  return renderEmail(<VerifyEmail url={url} />);
}
