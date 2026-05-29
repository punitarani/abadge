import { Button, Link, Text } from "@react-email/components";
import { EmailLayout } from "./layout";
import { type RenderedEmail, renderEmail } from "./render";
import { styles } from "./theme";

export function ResetPasswordEmail({ url }: { url: string }) {
  return (
    <EmailLayout
      preview="Reset your abadge password"
      heading="Reset your password"
      footerNote="If you didn't request a password reset, you can safely ignore this email — your password is unchanged."
    >
      <Text style={styles.text}>
        We received a request to reset your abadge password. Click below to choose a new one. This
        link expires in 1 hour.
      </Text>
      <Button href={url} style={styles.button}>
        Reset password
      </Button>
      <Text style={styles.fallbackLabel}>Or paste this link into your browser:</Text>
      <Link href={url} style={styles.fallbackLink}>
        {url}
      </Link>
    </EmailLayout>
  );
}

/** Render the password-reset email to the `{ html, text }` pair `sendEmail` expects. */
export function renderResetPasswordEmail(url: string): Promise<RenderedEmail> {
  return renderEmail(<ResetPasswordEmail url={url} />);
}
