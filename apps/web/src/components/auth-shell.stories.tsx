import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AuthShell } from "./auth-shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const meta = {
  title: "Components/AuthShell",
  component: AuthShell,
  args: {
    children: null,
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AuthShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LoginSurface: Story = {
  render: () => (
    <AuthShell>
      <div className="space-y-6 rounded-lg border border-border bg-card p-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Sign in to abadge</h1>
          <p className="text-sm text-muted-foreground">
            Manage credentials, policies, approvals, and audit events.
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="storybook-email">Email</Label>
            <Input id="storybook-email" type="email" placeholder="operator@company.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="storybook-password">Password</Label>
            <Input id="storybook-password" type="password" placeholder="••••••••••••" />
          </div>
        </div>
        <Button className="w-full">Sign in</Button>
      </div>
    </AuthShell>
  ),
};
